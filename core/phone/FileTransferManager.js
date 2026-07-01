const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildDataPaths } = require('../assistant/Data');
const FileTransferProtocol = require('./FileTransferProtocol');
const TransferHistory = require('./TransferHistory');
const TransferIntegrity = require('./TransferIntegrity');

const ZIP_MIN_DATE_MS = Date.UTC(1980, 0, 1);
const ZIP_CRC32_TABLE = createCrc32Table();

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = ZIP_CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(dateValue) {
  const date = new Date(Math.max(new Date(dateValue || Date.now()).getTime(), ZIP_MIN_DATE_MS));
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

class FileTransferManager {
  constructor(options = {}) {
    if (!options.deviceRegistry || typeof options.deviceRegistry.isTrusted !== 'function') {
      throw new TypeError('FileTransferManager requires a device registry');
    }
    this.deviceRegistry = options.deviceRegistry;
    this.protocol = options.protocol || new FileTransferProtocol();
    this.integrity = options.integrity || new TransferIntegrity();
    this.history = options.history || new TransferHistory({ config: options.config });
    const dataPaths = options.dataPaths || buildDataPaths(options.config);
    this.receiveDirectory = options.receiveDirectory || dataPaths.phoneReceivedDir;
    this.tempDirectory = options.tempDirectory || dataPaths.phoneTempDir;
    this.sendToDevice = options.sendToDevice || (async () => false);
    this.connectedDevicesProvider = options.connectedDevicesProvider || (() => []);
    this.logger = options.logger || { info() {}, error() {} };
    this.now = options.now || (() => Date.now());
    this.reservedPaths = new Set();
    this.incomingTransfers = new Map();
    fs.mkdirSync(this.receiveDirectory, { recursive: true });
    fs.mkdirSync(this.tempDirectory, { recursive: true });
  }

  async receiveFile(payload) {
    let metadata = null;
    try {
      const deviceId = this.protocol.getDeviceId(payload);
      this._assertTrusted(deviceId);
      this._assertPermission(deviceId, 'fileTransfer', 'File transfer disabled.');
      this._assertPermission(deviceId, 'receiveFiles', 'Receiving files disabled.');
      metadata = this.protocol.validateIncoming(payload);
      if (!this.integrity.verify(metadata.data, metadata.sha256)) {
        throw new FileTransferProtocol.Error('File integrity verification failed.', 'hash_mismatch');
      }
      this.logger.info('[PHONE] Transfer started', {
        deviceId,
        fileName: metadata.fileName,
        direction: 'phone-to-desktop'
      });
      const destination = this._reserveDestination(metadata.fileName);
      try {
        await this._writeFileAtomic(destination, metadata.data);
      } finally {
        this.reservedPaths.delete(destination);
      }
      const record = this._record(metadata, 'phone-to-desktop', 'completed');
      this.deviceRegistry.updateLastSeen(deviceId);
      this.logger.info('[PHONE] Transfer completed', {
        deviceId,
        fileName: metadata.fileName,
        direction: 'phone-to-desktop'
      });
      return { record, filePath: destination };
    } catch (error) {
      if (metadata) this._record(metadata, 'phone-to-desktop', 'failed');
      if (error.code === 'hash_invalid' || error.code === 'hash_mismatch') {
        this.logger.error('[PHONE] Hash failure', {
          deviceId: metadata?.deviceId || payload?.deviceId || null,
          fileName: metadata?.fileName || payload?.fileName || null,
          reason: error.code
        });
      }
      this.logger.error('[PHONE] Transfer failed', {
        deviceId: metadata?.deviceId || payload?.deviceId || null,
        fileName: metadata?.fileName || payload?.fileName || null,
        direction: 'phone-to-desktop',
        error: error.message
      });
      throw error;
    }
  }

  async sendFileToDevice(deviceId, sourcePath) {
    const sourceValue = String(sourcePath || '').trim();
    const resolvedSource = sourceValue ? path.resolve(sourceValue) : '';
    let transferPath = resolvedSource;
    let temporaryZip = null;
    let metadata = null;
    let outgoingFileName = path.basename(resolvedSource);

    try {
      this._assertTrusted(deviceId);
      this._assertPermission(deviceId, 'fileTransfer', 'File transfer disabled.');
      this._assertPermission(deviceId, 'sendFiles', 'Sending files disabled.');
      if (!sourceValue) throw new TypeError('Transfer source path is required');
      const stats = await fs.promises.stat(resolvedSource);
      if (stats.isDirectory()) {
        temporaryZip = await this.zipFolder(resolvedSource);
        transferPath = temporaryZip;
        outgoingFileName = `${path.basename(resolvedSource)}.zip`;
      } else if (!stats.isFile()) {
        throw new FileTransferProtocol.Error('Transfer source must be a file or folder.');
      }

      const transferStats = await fs.promises.stat(transferPath);
      this.protocol.validateFileSize(transferStats.size);
      const fileName = this.protocol.validateFileName(outgoingFileName);
      metadata = { deviceId, fileName, fileSize: transferStats.size };
      this.logger.info('[PHONE] Transfer started', {
        deviceId,
        fileName,
        direction: 'desktop-to-phone'
      });
      const data = await fs.promises.readFile(transferPath);
      const outgoing = this.protocol.createOutgoing(deviceId, fileName, data);
      const sent = await this.sendToDevice(deviceId, outgoing);
      if (!sent) throw new FileTransferProtocol.Error('Trusted device is not connected.', 'device_offline');

      const record = this._record(metadata, 'desktop-to-phone', 'completed');
      this.deviceRegistry.updateLastSeen(deviceId);
      this.logger.info('[PHONE] Transfer completed', {
        deviceId,
        fileName,
        direction: 'desktop-to-phone'
      });
      return { record };
    } catch (error) {
      if (metadata) this._record(metadata, 'desktop-to-phone', 'failed');
      this.logger.error('[PHONE] Transfer failed', {
        deviceId,
        fileName: metadata?.fileName || path.basename(resolvedSource),
        direction: 'desktop-to-phone',
        error: error.message
      });
      throw error;
    } finally {
      if (temporaryZip) await fs.promises.rm(temporaryZip, { force: true });
    }
  }

  getConnectedDevices() {
    const devices = typeof this.connectedDevicesProvider === 'function'
      ? this.connectedDevicesProvider()
      : [];
    return Array.isArray(devices)
      ? devices
          .map(device => ({
            deviceId: String(device?.deviceId || '').trim(),
            deviceName: String(device?.deviceName || 'Unknown phone').trim() || 'Unknown phone',
            connectedAt: device?.connectedAt || null,
            lastSeen: device?.lastSeen || null
          }))
          .filter(device => device.deviceId && this.deviceRegistry.isTrusted(device.deviceId))
      : [];
  }

  async startIncomingTransfer(payload) {
    let metadata = null;
    let reservedDestination = null;
    let tempPath = null;
    try {
      const deviceId = this.protocol.getDeviceId(payload);
      this._assertTrusted(deviceId);
      this._assertPermission(deviceId, 'fileTransfer', 'File transfer disabled.');
      this._assertPermission(deviceId, 'receiveFiles', 'Receiving files disabled.');
      const transferId = this.protocol.validateTransferId(payload.transferId || payload.requestId);
      if (this.incomingTransfers.has(transferId)) {
        throw new FileTransferProtocol.Error('Transfer already exists.', 'duplicate_transfer');
      }
      const fileName = this.protocol.validateFileName(payload.fileName);
      const fileSize = this.protocol.validateFileSize(payload.fileSize);
      const sha256 = this.protocol.validateHash(payload.sha256 || payload.hash);
      const chunkCount = this.protocol.validateChunkCount(payload.chunkCount);
      const destination = this._reserveDestination(fileName);
      reservedDestination = destination;
      tempPath = this._temporaryTransferPath(destination, transferId);
      metadata = { deviceId, fileName, fileSize, sha256 };

      await fs.promises.mkdir(this.tempDirectory, { recursive: true });
      await fs.promises.writeFile(tempPath, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      this.incomingTransfers.set(transferId, {
        transferId,
        deviceId,
        fileName,
        fileSize,
        sha256,
        chunkCount,
        destination,
        tempPath,
        receivedBytes: 0,
        nextChunkIndex: 0,
        hash: crypto.createHash('sha256'),
        writePromise: Promise.resolve(),
        startedAt: this.now()
      });

      this.logger.info('[PHONE] Chunked transfer started', {
        deviceId,
        fileName,
        fileSize,
        chunkCount,
        direction: 'phone-to-desktop'
      });
      return { transferId, fileName, fileSize, chunkCount };
    } catch (error) {
      if (reservedDestination) this.reservedPaths.delete(reservedDestination);
      if (tempPath) await fs.promises.rm(tempPath, { force: true });
      if (metadata) this._record(metadata, 'phone-to-desktop', 'failed');
      this.logger.error('[PHONE] Chunked transfer failed to start', {
        deviceId: metadata?.deviceId || payload?.deviceId || null,
        fileName: metadata?.fileName || payload?.fileName || null,
        error: error.message
      });
      throw error;
    }
  }

  async receiveFileChunk(payload) {
    const transferId = this.protocol.validateTransferId(payload.transferId);
    const state = this.incomingTransfers.get(transferId);
    if (!state) throw new FileTransferProtocol.Error('Transfer was not started.', 'transfer_not_found');

    try {
      const deviceId = this.protocol.getDeviceId(payload);
      if (deviceId !== state.deviceId) {
        throw new FileTransferProtocol.Error('Transfer device mismatch.', 'device_mismatch');
      }
      const chunkIndex = this.protocol.validateChunkIndex(payload.chunkIndex);
      if (chunkIndex !== state.nextChunkIndex) {
        throw new FileTransferProtocol.Error('File chunks arrived out of order.', 'invalid_chunk_order');
      }
      const chunk = this.protocol.decodeChunk(payload.data);
      if (state.receivedBytes + chunk.length > state.fileSize) {
        throw new FileTransferProtocol.Error('File chunk exceeds declared file size.', 'file_size_mismatch');
      }

      state.writePromise = state.writePromise.then(async () => {
        await fs.promises.appendFile(state.tempPath, chunk);
        state.hash.update(chunk);
      });
      await state.writePromise;
      state.receivedBytes += chunk.length;
      state.nextChunkIndex += 1;

      return {
        transferId,
        receivedBytes: state.receivedBytes,
        fileSize: state.fileSize,
        complete: state.receivedBytes === state.fileSize
      };
    } catch (error) {
      await this._failIncomingTransfer(transferId, state, error);
      throw error;
    }
  }

  async completeIncomingTransfer(payload) {
    const transferId = this.protocol.validateTransferId(payload.transferId);
    const state = this.incomingTransfers.get(transferId);
    if (!state) throw new FileTransferProtocol.Error('Transfer was not started.', 'transfer_not_found');

    try {
      const deviceId = this.protocol.getDeviceId(payload);
      if (deviceId !== state.deviceId) {
        throw new FileTransferProtocol.Error('Transfer device mismatch.', 'device_mismatch');
      }
      await state.writePromise;
      if (state.nextChunkIndex !== state.chunkCount || state.receivedBytes !== state.fileSize) {
        throw new FileTransferProtocol.Error('Incomplete file transfer.', 'incomplete_transfer');
      }
      const actualHash = state.hash.digest('hex');
      if (actualHash !== state.sha256) {
        throw new FileTransferProtocol.Error('File integrity verification failed.', 'hash_mismatch');
      }
      await fs.promises.rename(state.tempPath, state.destination);
      this.incomingTransfers.delete(transferId);
      this.reservedPaths.delete(state.destination);
      const metadata = {
        deviceId: state.deviceId,
        fileName: state.fileName,
        fileSize: state.fileSize
      };
      const record = this._record(metadata, 'phone-to-desktop', 'completed');
      this.deviceRegistry.updateLastSeen(state.deviceId);
      this.logger.info('[PHONE] Chunked transfer completed', {
        deviceId: state.deviceId,
        fileName: state.fileName,
        fileSize: state.fileSize,
        direction: 'phone-to-desktop'
      });
      return { record, filePath: state.destination };
    } catch (error) {
      await this._failIncomingTransfer(transferId, state, error);
      throw error;
    }
  }

  async abortIncomingTransfer(transferId, reason = 'transfer_aborted') {
    const normalizedTransferId = this.protocol.validateTransferId(transferId);
    const state = this.incomingTransfers.get(normalizedTransferId);
    if (!state) return false;
    await this._failIncomingTransfer(normalizedTransferId, state, new FileTransferProtocol.Error('Transfer aborted.', reason));
    return true;
  }

  async zipFolder(folderPath) {
    const resolvedFolder = path.resolve(String(folderPath || ''));
    const stats = await fs.promises.stat(resolvedFolder);
    if (!stats.isDirectory()) throw new TypeError('Folder transfer source must be a directory');
    await fs.promises.mkdir(this.tempDirectory, { recursive: true });
    const baseName = this.protocol.validateFileName(path.basename(resolvedFolder));
    const zipPath = path.join(this.tempDirectory, `${baseName}-${crypto.randomUUID()}.zip`);

    try {
      const zipBuffer = await this._createStoredZipBuffer(resolvedFolder);
      await fs.promises.writeFile(zipPath, zipBuffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      await fs.promises.rm(zipPath, { force: true });
      throw error;
    }

    const zipStats = await fs.promises.stat(zipPath);
    try {
      this.protocol.validateFileSize(zipStats.size);
    } catch (error) {
      await fs.promises.rm(zipPath, { force: true });
      throw error;
    }
    return zipPath;
  }

  async _createStoredZipBuffer(folderPath) {
    const entries = await this._collectZipEntries(folderPath);
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const data = entry.data || Buffer.alloc(0);
      const checksum = crc32(data);
      const { time, date } = toDosDateTime(entry.modifiedAt);
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(date, 12);
      localHeader.writeUInt32LE(checksum, 14);
      localHeader.writeUInt32LE(data.length, 18);
      localHeader.writeUInt32LE(data.length, 22);
      localHeader.writeUInt16LE(name.length, 26);
      localHeader.writeUInt16LE(0, 28);
      localParts.push(localHeader, name, data);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(time, 12);
      centralHeader.writeUInt16LE(date, 14);
      centralHeader.writeUInt32LE(checksum, 16);
      centralHeader.writeUInt32LE(data.length, 20);
      centralHeader.writeUInt32LE(data.length, 24);
      centralHeader.writeUInt16LE(name.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      centralParts.push(centralHeader, name);
      offset += localHeader.length + name.length + data.length;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, ...centralParts, end]);
  }

  async _collectZipEntries(rootFolder, currentFolder = rootFolder, context = { estimatedSize: 22 }) {
    const dirents = await fs.promises.readdir(currentFolder, { withFileTypes: true });
    const sorted = dirents.sort((left, right) => left.name.localeCompare(right.name));
    const entries = [];
    if (currentFolder !== rootFolder && sorted.length === 0) {
      const relative = path.relative(rootFolder, currentFolder).split(path.sep).join('/');
      this._addEstimatedZipEntrySize(context, relative, 0);
      entries.push({
        name: `${relative}/`,
        data: Buffer.alloc(0),
        directory: true,
        modifiedAt: Date.now()
      });
    }

    for (const dirent of sorted) {
      const absolutePath = path.join(currentFolder, dirent.name);
      if (dirent.isDirectory()) {
        entries.push(...await this._collectZipEntries(rootFolder, absolutePath, context));
      } else if (dirent.isFile()) {
        const stats = await fs.promises.stat(absolutePath);
        const relative = path.relative(rootFolder, absolutePath).split(path.sep).join('/');
        this._addEstimatedZipEntrySize(context, relative, stats.size);
        const data = await fs.promises.readFile(absolutePath);
        entries.push({
          name: relative,
          data,
          directory: false,
          modifiedAt: stats.mtime
        });
      }
    }
    return entries;
  }

  _addEstimatedZipEntrySize(context, entryName, size) {
    const nameLength = Buffer.byteLength(String(entryName || ''), 'utf8');
    context.estimatedSize += Number(size || 0) + 76 + (nameLength * 2);
    this.protocol.validateFileSize(context.estimatedSize);
  }

  _assertTrusted(deviceId) {
    if (!this.deviceRegistry.isTrusted(deviceId)) {
      throw new FileTransferProtocol.Error('Device not paired', 'device_not_paired');
    }
  }

  _assertPermission(deviceId, permission, message) {
    if (this.deviceRegistry.hasPermission(deviceId, permission)) return;
    this.logger.info('[PHONE] Permission denied', { deviceId, permission });
    throw new FileTransferProtocol.Error(message, 'permission_denied');
  }

  _record(metadata, direction, status) {
    return this.history.add({
      deviceId: metadata.deviceId,
      fileName: metadata.fileName,
      direction,
      size: metadata.fileSize,
      timestamp: this.now(),
      status
    });
  }

  _reserveDestination(fileName) {
    const parsed = path.parse(fileName);
    let counter = 0;
    let destination;
    do {
      const suffix = counter === 0 ? '' : ` (${counter})`;
      destination = path.join(this.receiveDirectory, `${parsed.name}${suffix}${parsed.ext}`);
      counter += 1;
    } while (fs.existsSync(destination) || this.reservedPaths.has(destination));
    this.reservedPaths.add(destination);
    return destination;
  }

  async _writeFileAtomic(destination, data) {
    const tempPath = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
    );
    try {
      await fs.promises.writeFile(tempPath, data, { flag: 'wx', mode: 0o600 });
      await fs.promises.rename(tempPath, destination);
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true });
      throw error;
    }
  }

  _temporaryTransferPath(destination, transferId) {
    const safeTransferId = String(transferId).replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(
      this.tempDirectory,
      `.${path.basename(destination)}.${process.pid}.${safeTransferId}.${crypto.randomBytes(8).toString('hex')}.part`
    );
  }

  async _failIncomingTransfer(transferId, state, error) {
    this.incomingTransfers.delete(transferId);
    this.reservedPaths.delete(state.destination);
    try {
      await state.writePromise;
    } catch (_) {}
    await fs.promises.rm(state.tempPath, { force: true });
    this._record({
      deviceId: state.deviceId,
      fileName: state.fileName,
      fileSize: state.fileSize
    }, 'phone-to-desktop', 'failed');
    this.logger.error('[PHONE] Chunked transfer failed', {
      deviceId: state.deviceId,
      fileName: state.fileName,
      transferId,
      error: error.message
    });
  }
}

module.exports = FileTransferManager;
