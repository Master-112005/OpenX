'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JSON_BACKUP_SUFFIX = '.bak';
const JSON_CORRUPT_PREFIX = '.corrupt-';
const DEFAULT_MAX_BYTES = 1024 * 1024;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeBackupPath(filePath) {
  return `${filePath}${JSON_BACKUP_SUFFIX}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIRECTORY_MODE });
  try {
    fs.chmodSync(dir, DIRECTORY_MODE);
  } catch (_) {
    // Windows may not implement POSIX modes; ACLs still apply.
  }
}

function assertSafeDestination(filePath) {
  if (!path.isAbsolute(filePath)) {
    throw new Error('Learning store path must be absolute');
  }
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error('Refusing to write learning data through a symbolic link');
  }
}

function writeFileAtomic(filePath, content) {
  assertSafeDestination(filePath);
  ensureDirectory(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  );

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'wx', FILE_MODE);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch (_) {
      // Best effort on platforms without POSIX mode support.
    }
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw err;
  }
}

function serializeJson(value, spacing) {
  const serialized = JSON.stringify(value, null, spacing);
  if (serialized === undefined) {
    throw new TypeError('Learning data is not JSON serializable');
  }
  return `${serialized}\n`;
}

function writeJsonAtomic(filePath, value, options = {}) {
  const spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
  const backup = options.backup !== false;
  const content = serializeJson(value, spacing);
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`Learning data exceeds the ${maxBytes} byte limit`);
  }

  ensureDirectory(path.dirname(filePath));
  if (backup && fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    // Only valid JSON becomes a recovery backup.
    JSON.parse(existing);
    writeFileAtomic(safeBackupPath(filePath), existing);
  }
  writeFileAtomic(filePath, content);
}

function readJsonFile(filePath, fallbackValue = {}, options = {}) {
  const makeFallback = () => clone(
    typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue
  );
  const backupPath = safeBackupPath(filePath);
  const preserveCorrupt = options.preserveCorrupt !== false;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
  const validate = typeof options.validate === 'function' ? options.validate : () => true;

  const parsePath = sourcePath => {
    const stats = fs.statSync(sourcePath);
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error('Learning file is invalid or exceeds its size limit');
    }
    const content = fs.readFileSync(sourcePath, 'utf8').trim();
    if (!content) throw new Error('Learning file is empty');
    const parsed = JSON.parse(content);
    if (!validate(parsed)) {
      throw new Error('Learning file failed schema validation');
    }
    return parsed;
  };

  if (!fs.existsSync(filePath)) {
    const fallback = makeFallback();
    if (options.createIfMissing !== false) {
      writeJsonAtomic(filePath, fallback, { backup: false, spacing: options.spacing, maxBytes });
    }
    return fallback;
  }

  try {
    return parsePath(filePath);
  } catch (_) {
    if (preserveCorrupt) {
      try {
        fs.renameSync(filePath, `${filePath}${JSON_CORRUPT_PREFIX}${timestampForFilename()}`);
      } catch (_) {}
    }
    if (fs.existsSync(backupPath)) {
      try {
        const recovered = parsePath(backupPath);
        writeJsonAtomic(filePath, recovered, { backup: false, spacing: options.spacing, maxBytes });
        return recovered;
      } catch (_) {}
    }
    const fallback = makeFallback();
    writeJsonAtomic(filePath, fallback, { backup: false, spacing: options.spacing, maxBytes });
    return fallback;
  }
}

class BaseStore {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(String(filePath || '.'));
    this.spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
    this.autoCreate = options.autoCreate !== false;
    this.maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
    this.lastError = null;
    this.data = this._load();
    this.lastPersistedData = clone(this.data);
  }

  _load() {
    return readJsonFile(this.filePath, () => this.getDefaultData(), {
      spacing: this.spacing,
      preserveCorrupt: true,
      createIfMissing: this.autoCreate,
      maxBytes: this.maxBytes,
      validate: value => this.validateData(value)
    });
  }

  _save(data = this.data) {
    try {
      if (!this.validateData(data)) {
        throw new Error('Refusing to save invalid learning data');
      }
      writeJsonAtomic(this.filePath, data, {
        spacing: this.spacing,
        backup: true,
        maxBytes: this.maxBytes
      });
      this.data = data;
      this.lastPersistedData = clone(data);
      this.lastError = null;
      return true;
    } catch (err) {
      this.data = clone(this.lastPersistedData);
      this.lastError = err;
      return false;
    }
  }

  validateData(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  getDefaultData() { return {}; }
  getAll() { return clone(this.data); }
  clear() { return this._setData(this.getDefaultData()); }
  _getData() { return this.data; }
  _setData(newData) { return this._save(newData); }

  reload() {
    this.data = this._load();
    this.lastPersistedData = clone(this.data);
    this.lastError = null;
    return this.getAll();
  }

  getFilePath() { return this.filePath; }
  exists() { return fs.existsSync(this.filePath); }
  getLastError() { return this.lastError; }

  getFileStats() {
    try {
      const stats = fs.statSync(this.filePath);
      return { size: stats.size, created: stats.birthtime, modified: stats.mtime, path: this.filePath };
    } catch (_) {
      return null;
    }
  }
}

module.exports = {
  BaseStore,
  DEFAULT_MAX_BYTES,
  readJsonFile,
  writeJsonAtomic,
  writeFileAtomic,
  ensureDirectory
};
