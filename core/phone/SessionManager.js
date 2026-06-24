const crypto = require('crypto');

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

class SessionManager {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.createToken = options.createToken || (() => crypto.randomBytes(32).toString('hex'));
    this.logger = options.logger || { warn() {} };
    this.sessions = new Map();
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredSessions(),
      options.cleanupIntervalMs || CLEANUP_INTERVAL_MS
    );
    this.cleanupInterval.unref?.();
  }

  createSession(deviceId) {
    const normalizedDeviceId = this._normalizeDeviceId(deviceId);
    const issuedAt = this.now();
    const session = {
      deviceId: normalizedDeviceId,
      sessionToken: this.createToken(),
      issuedAt,
      expiresAt: issuedAt + SESSION_LIFETIME_MS
    };
    this.sessions.set(normalizedDeviceId, session);
    return { ...session };
  }

  validateSession(deviceId, sessionToken) {
    const normalizedDeviceId = this._tryNormalizeDeviceId(deviceId);
    const token = typeof sessionToken === 'string' ? sessionToken.trim() : '';
    if (!normalizedDeviceId || !token) return { valid: false, reason: 'missing-session' };

    const session = this.sessions.get(normalizedDeviceId);
    if (!session) return { valid: false, reason: 'invalid-session' };
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(normalizedDeviceId);
      return { valid: false, reason: 'expired-session' };
    }
    if (!this._tokensEqual(session.sessionToken, token)) {
      return { valid: false, reason: 'invalid-session' };
    }
    return { valid: true, session: { ...session } };
  }

  revokeSession(deviceId) {
    const normalizedDeviceId = this._tryNormalizeDeviceId(deviceId);
    return normalizedDeviceId ? this.sessions.delete(normalizedDeviceId) : false;
  }

  cleanupExpiredSessions() {
    const now = this.now();
    let removed = 0;
    for (const [deviceId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(deviceId);
        this.logger.warn('[PHONE] Expired session', { deviceId });
        removed += 1;
      }
    }
    return removed;
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }

  _normalizeDeviceId(deviceId) {
    const normalized = this._tryNormalizeDeviceId(deviceId);
    if (!normalized) throw new TypeError('Invalid device ID');
    return normalized;
  }

  _tryNormalizeDeviceId(deviceId) {
    const normalized = typeof deviceId === 'string' ? deviceId.trim() : '';
    return /^[A-Za-z0-9._-]{1,128}$/.test(normalized) ? normalized : '';
  }

  _tokensEqual(expected, actual) {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(actual, 'utf8');
    return expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }
}

SessionManager.SESSION_LIFETIME_MS = SESSION_LIFETIME_MS;

module.exports = SessionManager;
