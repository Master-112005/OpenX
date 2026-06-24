const REQUEST_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

class SecurityManager {
  constructor(options = {}) {
    if (!options.deviceRegistry || typeof options.deviceRegistry.isTrusted !== 'function') {
      throw new TypeError('SecurityManager requires a device registry');
    }
    if (!options.sessionManager || typeof options.sessionManager.validateSession !== 'function') {
      throw new TypeError('SecurityManager requires a session manager');
    }
    this.deviceRegistry = options.deviceRegistry;
    this.sessionManager = options.sessionManager;
    this.now = options.now || (() => Date.now());
    this.timestampToleranceMs = options.timestampToleranceMs || REQUEST_TIMESTAMP_TOLERANCE_MS;
    this.logger = options.logger || { warn() {} };
    this.seenRequests = new Map();
  }

  validateConnection(payload) {
    this.cleanupReplayCache();
    const deviceId = typeof payload?.deviceId === 'string' ? payload.deviceId.trim() : '';
    if (!deviceId || !this.deviceRegistry.isTrusted(deviceId)) {
      return this._authenticationFailure(deviceId, 'untrusted-device', 'Device not paired');
    }

    const session = this.sessionManager.validateSession(deviceId, payload.sessionToken);
    if (!session.valid) {
      if (session.reason === 'expired-session') {
        this.logger.warn('[PHONE] Expired session', { deviceId });
        return { valid: false, reason: session.reason, message: 'Session expired.' };
      }
      return this._authenticationFailure(deviceId, session.reason, 'Authentication failed.');
    }

    if (!Number.isSafeInteger(payload.timestamp) ||
        Math.abs(this.now() - payload.timestamp) > this.timestampToleranceMs) {
      return this._authenticationFailure(deviceId, 'stale-timestamp', 'Stale request.');
    }

    const requestId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return this._authenticationFailure(deviceId, 'invalid-request-id', 'Authentication failed.');
    }

    const cache = this.seenRequests.get(deviceId) || new Map();
    if (cache.has(requestId)) {
      this.logger.warn('[PHONE] Replay attempt', { deviceId, requestId });
      return { valid: false, reason: 'duplicate-request', message: 'Duplicate request.' };
    }
    cache.set(requestId, this.now() + this.timestampToleranceMs);
    this.seenRequests.set(deviceId, cache);
    return { valid: true, deviceId, session: session.session };
  }

  cleanupReplayCache() {
    const now = this.now();
    let removed = 0;
    for (const [deviceId, requests] of this.seenRequests) {
      for (const [requestId, expiresAt] of requests) {
        if (expiresAt <= now) {
          requests.delete(requestId);
          removed += 1;
        }
      }
      if (requests.size === 0) this.seenRequests.delete(deviceId);
    }
    return removed;
  }

  clearDevice(deviceId) {
    return this.seenRequests.delete(deviceId);
  }

  _authenticationFailure(deviceId, reason, message) {
    this.logger.warn('[PHONE] Authentication failure', { deviceId: deviceId || null, reason });
    return { valid: false, reason, message };
  }
}

SecurityManager.REQUEST_TIMESTAMP_TOLERANCE_MS = REQUEST_TIMESTAMP_TOLERANCE_MS;

module.exports = SecurityManager;
