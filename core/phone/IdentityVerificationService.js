const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000;

class IdentityVerificationService {
  constructor(options = {}) {
    if (!options.verifier || typeof options.verifier.verifyIdentity !== 'function') {
      throw new TypeError('IdentityVerificationService requires a native verifier');
    }
    this.verifier = options.verifier;
    this.logger = options.logger || { info() {}, warn() {} };
    this.now = options.now || (() => Date.now());
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.verifiedAt = null;
    this.pendingVerification = null;
  }

  async verifyIdentity() {
    this.logger.info('[PHONE] Identity verification requested');
    const now = this.now();
    if (
      this.verifiedAt !== null &&
      now >= this.verifiedAt &&
      now - this.verifiedAt < this.sessionTtlMs
    ) {
      this.logger.info('[PHONE] Identity verification succeeded', { cached: true });
      return { success: true };
    }

    if (!this.pendingVerification) {
      this.pendingVerification = this._performVerification();
    }

    try {
      return await this.pendingVerification;
    } finally {
      this.pendingVerification = null;
    }
  }

  async _performVerification() {
    try {
      const result = await this.verifier.verifyIdentity();
      if (result?.success === true) {
        this.verifiedAt = this.now();
        this.logger.info('[PHONE] Identity verification succeeded');
        return { success: true };
      }
      this.verifiedAt = null;
      this.logger.warn('[PHONE] Identity verification failed', {
        reason: result?.reason || 'verification_failed'
      });
      return { success: false, reason: 'verification_failed' };
    } catch (error) {
      this.verifiedAt = null;
      this.logger.warn('[PHONE] Identity verification failed', { error: error.message });
      return { success: false, reason: 'verification_failed' };
    }
  }
}

IdentityVerificationService.DEFAULT_SESSION_TTL_MS = DEFAULT_SESSION_TTL_MS;

module.exports = IdentityVerificationService;
