const net = require('net');
const os = require('os');
const QRCode = require('qrcode');

const DEFAULT_SERVER_PORT = 8080;
const PROTOCOL_VERSION = 1;

function isPrivateIpv4(address) {
  if (/^10\./.test(address) || /^192\.168\./.test(address)) return true;
  const match = /^172\.(\d+)\./.exec(address);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function resolveDesktopIpv4() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter(entry => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal)
    .map(entry => entry.address)
    .filter(address => net.isIPv4(address));
  return candidates.find(isPrivateIpv4) || candidates[0] || '127.0.0.1';
}

class QRPairingService {
  constructor(options = {}) {
    if (!options.pairingService || typeof options.pairingService.createPairingToken !== 'function') {
      throw new TypeError('QRPairingService requires a pairing service');
    }
    this.pairingService = options.pairingService;
    this.serverPort = options.serverPort ?? DEFAULT_SERVER_PORT;
    this.resolveServerIp = options.resolveServerIp || resolveDesktopIpv4;
    this.qrCode = options.qrCode || QRCode;
    this.logger = options.logger || { info() {}, warn() {} };
    this.now = options.now || (() => Date.now());
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.currentPairing = null;
    this.expirationTimer = null;
  }

  async generatePairingQR() {
    const tokenResult = await this.pairingService.createPairingToken();
    if (tokenResult?.success !== true) return tokenResult;

    this._discardCurrentPairing();
    const payload = {
      serverIp: this.resolveServerIp(),
      serverPort: this.serverPort,
      pairingToken: tokenResult.token,
      expiresAt: tokenResult.expiresAt,
      protocolVersion: PROTOCOL_VERSION
    };

    try {
      this._validatePayload(payload);
      const qrDataUrl = await this.qrCode.toDataURL(JSON.stringify(payload), {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320
      });
      this.currentPairing = { payload, qrDataUrl };
      this._scheduleExpiration(payload);
      this.logger.info('[PHONE] QR generated', { expiresAt: payload.expiresAt });
      return { success: true, payload: { ...payload }, qrDataUrl };
    } catch (error) {
      this.pairingService.tokenManager.invalidateToken(tokenResult.token);
      this.logger.warn('[PHONE] QR generation failed', { error: error.message });
      return { success: false, message: 'Unable to generate pairing QR.' };
    }
  }

  getPairingPayload() {
    if (!this.currentPairing) return null;
    if (this.currentPairing.payload.expiresAt <= this.now()) {
      this._expireCurrentPairing(this.currentPairing.payload.pairingToken);
      return null;
    }
    return { ...this.currentPairing.payload };
  }

  getPairingConnectionInfo() {
    return {
      serverIp: this.resolveServerIp(),
      serverPort: this.serverPort,
      protocolVersion: PROTOCOL_VERSION
    };
  }

  destroy() {
    this._discardCurrentPairing();
  }

  _validatePayload(payload) {
    const keys = Object.keys(payload).sort();
    const requiredKeys = ['expiresAt', 'pairingToken', 'protocolVersion', 'serverIp', 'serverPort'];
    if (keys.length !== requiredKeys.length || keys.some((key, index) => key !== requiredKeys[index])) {
      throw new TypeError('Invalid QR pairing payload fields');
    }
    if (net.isIP(payload.serverIp) !== 4) throw new TypeError('Invalid desktop IP address');
    if (!Number.isInteger(payload.serverPort) || payload.serverPort < 1 || payload.serverPort > 65535) {
      throw new TypeError('Invalid desktop server port');
    }
    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new TypeError('Invalid protocol version');
    }
    if (typeof payload.pairingToken !== 'string' || !/^[A-Z0-9]{8}$/.test(payload.pairingToken)) {
      throw new TypeError('Invalid pairing token');
    }
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= this.now()) {
      throw new TypeError('Invalid pairing expiration');
    }
    return true;
  }

  _scheduleExpiration(payload) {
    const delay = Math.max(0, payload.expiresAt - this.now());
    this.expirationTimer = this.setTimeout(
      () => this._expireCurrentPairing(payload.pairingToken),
      delay
    );
    this.expirationTimer?.unref?.();
  }

  _expireCurrentPairing(token) {
    if (!this.currentPairing || this.currentPairing.payload.pairingToken !== token) return;
    this.clearTimeout(this.expirationTimer);
    this.expirationTimer = null;
    this.pairingService.tokenManager.invalidateToken(token);
    this.currentPairing = null;
    this.logger.info('[PHONE] QR expired');
  }

  _discardCurrentPairing() {
    if (this.expirationTimer) this.clearTimeout(this.expirationTimer);
    this.expirationTimer = null;
    if (this.currentPairing) {
      this.pairingService.tokenManager.invalidateToken(this.currentPairing.payload.pairingToken);
    }
    this.currentPairing = null;
  }
}

QRPairingService.DEFAULT_SERVER_PORT = DEFAULT_SERVER_PORT;
QRPairingService.PROTOCOL_VERSION = PROTOCOL_VERSION;
QRPairingService.resolveDesktopIpv4 = resolveDesktopIpv4;

module.exports = QRPairingService;
