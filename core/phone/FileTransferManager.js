const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildDataPaths } = require('../assistant/Data');
const FileTransferProtocol = require('./FileTransferProtocol');
const TransferHistory = require('./TransferHistory');
const TransferIntegrity = require('./TransferIntegrity');

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
    const { ZipArchive } = require('archiver');

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath, { flags: 'wx', mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      output.once('close', resolve);
      output.once('error', reject);
      archive.once('error', reject);
      archive.on('warning', warning => {
        if (warning.code !== 'ENOENT') reject(warning);
      });
      archive.pipe(output);
      archive.directory(resolvedFolder, false);
      archive.finalize().catch(reject);
    }).catch(async error => {
      await fs.promises.rm(zipPath, { force: true });
      throw error;
    });

    const zipStats = await fs.promises.stat(zipPath);
    try {
      this.protocol.validateFileSize(zipStats.size);
    } catch (error) {
      await fs.promises.rm(zipPath, { force: true });
      throw error;
    }
    return zipPath;
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
