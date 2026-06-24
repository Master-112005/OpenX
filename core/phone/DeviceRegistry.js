const { buildDataPaths, readJsonFile, writeJsonAtomic } = require('../assistant/Data');

const MAX_DEVICE_ID_LENGTH = 128;
const MAX_DEVICE_NAME_LENGTH = 100;
const PERMISSION_NAMES = Object.freeze([
  'remoteCommands',
  'fileTransfer',
  'receiveFiles',
  'sendFiles',
  'powerActions'
]);
const DEFAULT_PERMISSIONS = Object.freeze({
  remoteCommands: true,
  fileTransfer: true,
  receiveFiles: true,
  sendFiles: true,
  powerActions: false
});

class DeviceRegistry {
  constructor(options = {}) {
    this.filePath = options.filePath || buildDataPaths(options.config).phoneDevicesPath;
    this.now = options.now || (() => Date.now());
    this.logger = options.logger || { info() {} };
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
      trusted: true,
      permissions: this._normalizePermissions(input.permissions)
    };
    this.devices.set(deviceId, device);
    this.save();
    return { ...device, permissions: { ...device.permissions } };
  }

  getDevice(deviceId) {
    const normalized = this._tryNormalizeDeviceId(deviceId);
    const device = normalized ? this.devices.get(normalized) : null;
    return device ? { ...device, permissions: { ...device.permissions } } : null;
  }

  isTrusted(deviceId) {
    return this.getDevice(deviceId)?.trusted === true;
  }

  getPermissions(deviceId) {
    const device = this.getDevice(deviceId);
    return device ? { ...device.permissions } : null;
  }

  updatePermissions(deviceId, permissions) {
    const normalizedId = this._tryNormalizeDeviceId(deviceId);
    const device = normalizedId ? this.devices.get(normalizedId) : null;
    if (!device) return null;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      throw new TypeError('Invalid device permissions');
    }

    const unknown = Object.keys(permissions).filter(name => !PERMISSION_NAMES.includes(name));
    if (unknown.length > 0) throw new TypeError('Unknown device permission');
    const updated = { ...device.permissions };
    for (const [name, value] of Object.entries(permissions)) {
      if (typeof value !== 'boolean') throw new TypeError('Device permissions must be boolean');
      if (updated[name] === value) continue;
      updated[name] = value;
      this.logger.info('[PHONE] Permission changed', { deviceId: normalizedId, permission: name, enabled: value });
      if (value) {
        this.logger.info('[PHONE] Permission granted', { deviceId: normalizedId, permission: name });
      }
    }
    device.permissions = updated;
    this.save();
    return { ...updated };
  }

  hasPermission(deviceId, permission) {
    if (!PERMISSION_NAMES.includes(permission)) return false;
    const device = this.getDevice(deviceId);
    return device?.trusted === true && device.permissions?.[permission] === true;
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
    this.logger.info('[PHONE] Device removed', { deviceId: normalized });
    return true;
  }

  listDevices() {
    return [...this.devices.values()].map(device => ({
      ...device,
      permissions: { ...device.permissions }
    }));
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
    let needsMigration = false;
    for (const candidate of stored) {
      const device = this._normalizeStoredDevice(candidate);
      if (device) {
        this.devices.set(device.deviceId, device);
        if (
          !candidate.permissions ||
          PERMISSION_NAMES.some(name => typeof candidate.permissions[name] !== 'boolean')
        ) needsMigration = true;
      }
    }
    if (needsMigration) this.save();
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
        trusted: candidate.trusted === true,
        permissions: this._normalizePermissions(candidate.permissions)
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

  _normalizePermissions(permissions) {
    const normalized = { ...DEFAULT_PERMISSIONS };
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return normalized;
    for (const name of PERMISSION_NAMES) {
      if (typeof permissions[name] === 'boolean') normalized[name] = permissions[name];
    }
    return normalized;
  }
}

DeviceRegistry.DEFAULT_PERMISSIONS = DEFAULT_PERMISSIONS;
DeviceRegistry.PERMISSION_NAMES = PERMISSION_NAMES;

module.exports = DeviceRegistry;
