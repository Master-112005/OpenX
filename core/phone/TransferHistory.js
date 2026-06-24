const crypto = require('crypto');
const { buildDataPaths, readJsonFile, writeJsonAtomic } = require('../assistant/Data');

const MAX_HISTORY_RECORDS = 1000;
const DIRECTIONS = new Set(['phone-to-desktop', 'desktop-to-phone']);
const STATUSES = new Set(['completed', 'failed']);

class TransferHistory {
  constructor(options = {}) {
    this.filePath = options.filePath || buildDataPaths(options.config).phoneTransferHistoryPath;
    this.createId = options.createId || (() => crypto.randomUUID());
    this.records = [];
    this.load();
  }

  add(record) {
    const normalized = this._normalizeRecord({ id: record.id || this.createId(), ...record });
    this.records.push(normalized);
    if (this.records.length > MAX_HISTORY_RECORDS) {
      this.records.splice(0, this.records.length - MAX_HISTORY_RECORDS);
    }
    this.save();
    return { ...normalized };
  }

  list() {
    return this.records.map(record => ({ ...record }));
  }

  save() {
    writeJsonAtomic(this.filePath, this.records);
    return this.records.length;
  }

  load() {
    const stored = readJsonFile(this.filePath, [], { validate: value => Array.isArray(value) });
    this.records = [];
    for (const record of stored) {
      try {
        this.records.push(this._normalizeRecord(record));
      } catch (_) {}
    }
    return this.records.length;
  }

  _normalizeRecord(record) {
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    const deviceId = typeof record?.deviceId === 'string' ? record.deviceId.trim() : '';
    const fileName = typeof record?.fileName === 'string' ? record.fileName.trim() : '';
    const size = Number(record?.size);
    const timestamp = Number(record?.timestamp);
    if (
      !id || !deviceId || !fileName ||
      !DIRECTIONS.has(record.direction) ||
      !Number.isSafeInteger(size) || size < 0 ||
      !Number.isFinite(timestamp) ||
      !STATUSES.has(record.status)
    ) {
      throw new TypeError('Invalid transfer history record');
    }
    return {
      id,
      deviceId,
      fileName,
      direction: record.direction,
      size,
      timestamp,
      status: record.status
    };
  }
}

module.exports = TransferHistory;
