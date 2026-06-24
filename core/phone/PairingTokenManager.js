const crypto = require('crypto');

const TOKEN_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TOKEN_LENGTH = 8;
const TOKEN_LIFETIME_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 1000;

class PairingTokenManager {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.randomIndex = options.randomIndex || (max => crypto.randomInt(max));
    this.tokens = new Map();
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredTokens(),
      options.cleanupIntervalMs || CLEANUP_INTERVAL_MS
    );
    this.cleanupInterval.unref?.();
  }

  generateToken() {
    this.cleanupExpiredTokens();

    let token;
    do {
      token = Array.from(
        { length: TOKEN_LENGTH },
        () => TOKEN_CHARACTERS[this.randomIndex(TOKEN_CHARACTERS.length)]
      ).join('');
    } while (this.tokens.has(token));

    const expiresAt = this.now() + TOKEN_LIFETIME_MS;
    this.tokens.set(token, expiresAt);
    return { token, expiresAt };
  }

  validateToken(token) {
    this.cleanupExpiredTokens();
    const normalized = this._normalize(token);
    const expiresAt = this.tokens.get(normalized);
    return Number.isFinite(expiresAt) && expiresAt > this.now();
  }

  invalidateToken(token) {
    return this.tokens.delete(this._normalize(token));
  }

  cleanupExpiredTokens() {
    const now = this.now();
    let removed = 0;
    for (const [token, expiresAt] of this.tokens) {
      if (expiresAt <= now) {
        this.tokens.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.tokens.clear();
  }

  _normalize(token) {
    return typeof token === 'string' ? token.trim().toUpperCase() : '';
  }
}

PairingTokenManager.TOKEN_LENGTH = TOKEN_LENGTH;
PairingTokenManager.TOKEN_LIFETIME_MS = TOKEN_LIFETIME_MS;

module.exports = PairingTokenManager;
