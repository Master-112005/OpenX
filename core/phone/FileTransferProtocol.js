const path = require('path');
const TransferIntegrity = require('./TransferIntegrity');

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 256 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_FILE_SIZE_BYTES / 3) * 4;
const MAX_WEBSOCKET_PAYLOAD_BYTES = MAX_BASE64_LENGTH + 64 * 1024;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const TRANSFER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

class FileTransferProtocolError extends Error {
  constructor(message, code = 'invalid_transfer') {
    super(message);
    this.name = 'FileTransferProtocolError';
    this.code = code;
    this.publicMessage = message;
  }
}

class FileTransferProtocol {
  constructor(options = {}) {
    this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE_BYTES;
    this.maxBase64Length = Math.ceil(this.maxFileSize / 3) * 4;
    this.integrity = options.integrity || new TransferIntegrity();
  }

  getDeviceId(payload) {
    const deviceId = typeof payload?.deviceId === 'string' ? payload.deviceId.trim() : '';
    if (!DEVICE_ID_PATTERN.test(deviceId)) {
      throw new FileTransferProtocolError('Malformed file transfer payload.');
    }
    return deviceId;
  }

  validateIncoming(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.type !== 'file-transfer') {
      throw new FileTransferProtocolError('Malformed file transfer payload.');
    }
    const deviceId = this.getDeviceId(payload);
    const fileName = this.validateFileName(payload.fileName);
    const fileSize = this.validateFileSize(payload.fileSize);
    const data = this.decodeBase64(payload.data, fileSize);
    let sha256;
    try {
      sha256 = this.validateHash(payload.sha256 || payload.hash);
    } catch (_) {
      throw new FileTransferProtocolError('Missing or invalid file hash.', 'hash_invalid');
    }
    return { deviceId, fileName, fileSize, data, sha256 };
  }

  createOutgoing(deviceId, fileName, data) {
    const normalizedDeviceId = this.getDeviceId({ deviceId });
    const normalizedFileName = this.validateFileName(fileName);
    if (!Buffer.isBuffer(data)) {
      throw new FileTransferProtocolError('File data must be a buffer.');
    }
    const fileSize = this.validateFileSize(data.length);
    const sha256 = this.integrity.createHash(data);
    return {
      type: 'file-transfer',
      deviceId: normalizedDeviceId,
      fileName: normalizedFileName,
      fileSize,
      sha256,
      hash: sha256,
      data: data.toString('base64')
    };
  }

  validateTransferId(transferId) {
    const normalized = typeof transferId === 'string' ? transferId.trim() : '';
    if (!TRANSFER_ID_PATTERN.test(normalized)) {
      throw new FileTransferProtocolError('Invalid transfer ID.');
    }
    return normalized;
  }

  validateHash(hash) {
    try {
      return this.integrity.validateHash(hash);
    } catch (_) {
      throw new FileTransferProtocolError('Missing or invalid file hash.', 'hash_invalid');
    }
  }

  validateChunkIndex(chunkIndex) {
    const normalized = Number(chunkIndex);
    if (!Number.isSafeInteger(normalized) || normalized < 0) {
      throw new FileTransferProtocolError('Invalid file chunk.', 'invalid_chunk');
    }
    return normalized;
  }

  validateChunkCount(chunkCount) {
    const normalized = Number(chunkCount);
    if (!Number.isSafeInteger(normalized) || normalized < 1) {
      throw new FileTransferProtocolError('Invalid file chunk count.', 'invalid_chunk');
    }
    return normalized;
  }

  decodeChunk(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > this.maxBase64Length) {
      throw new FileTransferProtocolError('Malformed file chunk.', 'invalid_chunk');
    }
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new FileTransferProtocolError('Malformed file chunk.', 'invalid_chunk');
    }
    return Buffer.from(value, 'base64');
  }

  validateFileName(fileName) {
    const normalized = typeof fileName === 'string' ? fileName.trim().normalize('NFC') : '';
    if (
      !normalized ||
      normalized.length > 255 ||
      normalized === '.' ||
      normalized === '..' ||
      path.basename(normalized) !== normalized ||
      path.win32.basename(normalized) !== normalized ||
      /[<>:"/\\|?*\x00-\x1f]/.test(normalized) ||
      /[. ]$/.test(normalized) ||
      RESERVED_WINDOWS_NAMES.test(normalized)
    ) {
      throw new FileTransferProtocolError('Invalid file name.');
    }
    return normalized;
  }

  validateFileSize(fileSize) {
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new FileTransferProtocolError('Invalid file size.');
    }
    if (fileSize > this.maxFileSize) {
      throw new FileTransferProtocolError('File exceeds the 100 MB transfer limit.', 'file_too_large');
    }
    return fileSize;
  }

  decodeBase64(value, expectedSize) {
    if (typeof value !== 'string' || value.length > this.maxBase64Length) {
      throw new FileTransferProtocolError('Malformed file transfer payload.');
    }
    if (value.length === 0 && expectedSize === 0) return Buffer.alloc(0);
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new FileTransferProtocolError('Malformed file transfer payload.');
    }
    if (Buffer.byteLength(value, 'base64') !== expectedSize) {
      throw new FileTransferProtocolError('File size does not match payload data.');
    }
    const data = Buffer.from(value, 'base64');
    if (data.length !== expectedSize) {
      throw new FileTransferProtocolError('File size does not match payload data.');
    }
    return data;
  }
}

FileTransferProtocol.MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;
FileTransferProtocol.DEFAULT_CHUNK_BYTES = DEFAULT_CHUNK_BYTES;
FileTransferProtocol.MAX_WEBSOCKET_PAYLOAD_BYTES = MAX_WEBSOCKET_PAYLOAD_BYTES;
FileTransferProtocol.Error = FileTransferProtocolError;

module.exports = FileTransferProtocol;
