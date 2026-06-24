const crypto = require('crypto');

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

class TransferIntegrity {
  createHash(data) {
    if (!Buffer.isBuffer(data)) throw new TypeError('File data must be a buffer');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  verify(data, expectedHash) {
    if (!Buffer.isBuffer(data) || typeof expectedHash !== 'string' || !SHA256_PATTERN.test(expectedHash)) {
      return false;
    }
    const actual = Buffer.from(this.createHash(data), 'hex');
    const expected = Buffer.from(expectedHash.toLowerCase(), 'hex');
    return crypto.timingSafeEqual(actual, expected);
  }

  validateHash(hash) {
    const normalized = typeof hash === 'string' ? hash.trim().toLowerCase() : '';
    if (!SHA256_PATTERN.test(normalized)) throw new TypeError('Invalid SHA-256 hash');
    return normalized;
  }
}

module.exports = TransferIntegrity;
