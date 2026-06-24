const { buildDataPaths, readJsonFile } = require('../assistant/Data');
const DeviceRegistry = require('./DeviceRegistry');
const PairingTokenManager = require('./PairingTokenManager');

class PairingService {
  constructor(options = {}) {
    const paths = buildDataPaths(options.config);
    this.tokenManager = options.tokenManager || new PairingTokenManager();
    this.deviceRegistry = options.deviceRegistry || new DeviceRegistry({
      filePath: options.devicesPath || paths.phoneDevicesPath
    });
    this.pairingPath = options.pairingPath || paths.phonePairingPath;
    this.permissionsPath = options.permissionsPath || paths.phonePermissionsPath;
    this.identityVerificationService = options.identityVerificationService || null;
    this.logger = options.logger || { info() {} };

    // Pairing tokens intentionally remain in memory. These files reserve the
    // phone data schemas without persisting a reusable pairing credential.
    readJsonFile(this.pairingPath, {});
    readJsonFile(this.permissionsPath, {});
  }

  async createPairingToken() {
    const verification = await this.identityVerificationService?.verifyIdentity?.();
    if (verification?.success !== true) {
      return { success: false, message: 'Identity verification required.' };
    }

    const pairingToken = this.tokenManager.generateToken();
    this.logger.info('[PHONE] Pairing token generated', { expiresAt: pairingToken.expiresAt });
    return { success: true, ...pairingToken };
  }

  validatePairRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return { valid: false, reason: 'invalid-request' };
    }

    const deviceId = typeof request.deviceId === 'string' ? request.deviceId.trim() : '';
    const deviceName = typeof request.deviceName === 'string' ? request.deviceName.trim() : '';
    const token = typeof request.token === 'string' ? request.token.trim().toUpperCase() : '';
    if (!deviceId || !deviceName || !token) {
      return { valid: false, reason: 'invalid-request' };
    }
    if (!this.tokenManager.validateToken(token)) {
      return { valid: false, reason: 'invalid-token' };
    }

    return { valid: true, deviceId, deviceName, token };
  }

  pairDevice(request) {
    const validation = this.validatePairRequest(request);
    if (!validation.valid) return validation;

    try {
      const device = this.deviceRegistry.registerDevice({
        deviceId: validation.deviceId,
        deviceName: validation.deviceName
      });
      this.tokenManager.invalidateToken(validation.token);
      return { valid: true, device };
    } catch (error) {
      return { valid: false, reason: 'invalid-device', error: error.message };
    }
  }

  destroy() {
    this.tokenManager.destroy?.();
  }
}

module.exports = PairingService;
