const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
    this.receiveDirectory = options.receiveDirectory || path.join(os.homedir(), 'Downloads', 'OpenX_Received');
    this.tempDirectory = options.tempDirectory || path.join(os.tmpdir(), 'OpenX', 'phone-transfer');
    this.sendToDevice = options.sendToDevice || (async () => false);
    this.logger = options.logger || { info() {}, error() {} };
    this.now = options.now || (() => Date.now());
    this.reservedPaths = new Set();
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

  async zipFolder(folderPath) {
    const resolvedFolder = path.resolve(String(folderPath || ''));
    const stats = await fs.promises.stat(resolvedFolder);
    if (!stats.isDirectory()) throw new TypeError('Folder transfer source must be a directory');
    await fs.promises.mkdir(this.tempDirectory, { recursive: true });
    const baseName = this.protocol.validateFileName(path.basename(resolvedFolder));
    const zipPath = path.join(this.tempDirectory, `${baseName}-${crypto.randomUUID()}.zip`);
    const { ZipArchive } = await import('archiver');

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
}

module.exports = FileTransferManager;
