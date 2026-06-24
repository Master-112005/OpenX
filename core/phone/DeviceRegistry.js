const { buildDataPaths, readJsonFile, writeJsonAtomic } = require('../assistant/Data');

const MAX_DEVICE_ID_LENGTH = 128;
const MAX_DEVICE_NAME_LENGTH = 100;

class DeviceRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || buildDataPaths(options.config).phoneDevicesPath;
    this.now = options.now || (() => Date.now());
    this.devices = new Map();
    this.load();
  }

  registerDevice(deviceOrId, name) {
    const input = typeof deviceOrId === 'object' && deviceOrId !== null
      ? deviceOrId
      : { deviceId: deviceOrId, deviceName: name };
    const deviceId = this._normalizeDeviceId(input.deviceId);
    const deviceName = this._normalizeDeviceName(input.deviceName);
    const timestamp = this.now();
    const device = {
      deviceId,
      deviceName,
      pairedAt: timestamp,
      lastSeen: timestamp,
      trusted: true
    };
    this.devices.set(deviceId, device);
    this.save();
    return { ...device };
  }

  getDevice(deviceId) {
    const normalized = this._tryNormalizeDeviceId(deviceId);
    const device = normalized ? this.devices.get(normalized) : null;
    return device ? { ...device } : null;
  }

  isTrusted(deviceId) {
    return this.getDevice(deviceId)?.trusted === true;
  }

  updateLastSeen(deviceId) {
    const normalized = this._tryNormalizeDeviceId(deviceId);
    const device = normalized ? this.devices.get(normalized) : null;
    if (!device) return false;
    device.lastSeen = this.now();
    this.save();
    return true;
  }

  removeDevice(deviceId) {
    const normalized = this._tryNormalizeDeviceId(deviceId);
    if (!normalized || !this.devices.delete(normalized)) return false;
    this.save();
    return true;
  }

  save() {
    writeJsonAtomic(this.filePath, [...this.devices.values()]);
    return this.devices.size;
  }

  load() {
    const stored = readJsonFile(this.filePath, [], {
      validate: value => Array.isArray(value)
    });
    this.devices.clear();
    for (const candidate of stored) {
      const device = this._normalizeStoredDevice(candidate);
      if (device) this.devices.set(device.deviceId, device);
    }
    return this.devices.size;
  }

  _normalizeStoredDevice(candidate) {
    try {
      if (!candidate || typeof candidate !== 'object') return null;
      const pairedAt = Number(candidate.pairedAt);
      const lastSeen = Number(candidate.lastSeen);
      if (!Number.isFinite(pairedAt) || !Number.isFinite(lastSeen)) return null;
      return {
        deviceId: this._normalizeDeviceId(candidate.deviceId),
        deviceName: this._normalizeDeviceName(candidate.deviceName),
        pairedAt,
        lastSeen,
        trusted: candidate.trusted === true
      };
    } catch (_) {
      return null;
    }
  }

  _tryNormalizeDeviceId(deviceId) {
    try {
      return this._normalizeDeviceId(deviceId);
    } catch (_) {
      return '';
    }
  }

  _normalizeDeviceId(deviceId) {
    const normalized = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!normalized || normalized.length > MAX_DEVICE_ID_LENGTH || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
      throw new TypeError('Invalid device ID');
    }
    return normalized;
  }

  _normalizeDeviceName(deviceName) {
    const normalized = typeof deviceName === 'string' ? deviceName.trim() : '';
    if (!normalized || normalized.length > MAX_DEVICE_NAME_LENGTH) {
      throw new TypeError('Invalid device name');
    }
    return normalized;
  }
}

module.exports = DeviceRegistry;
