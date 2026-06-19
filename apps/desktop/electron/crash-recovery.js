const { readJsonFile, writeJsonAtomic } = require('../../../core/shared/data-root');

class CrashRecoveryPolicy {
  constructor(options = {}) {
    if (!options.statePath) throw new TypeError('Crash recovery statePath is required');
    this.statePath = options.statePath;
    this.maxRestarts = Number.isInteger(options.maxRestarts) ? options.maxRestarts : 3;
    this.windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 5 * 60 * 1000;
  }

  requestRestart(now = Date.now()) {
    const state = readJsonFile(this.statePath, { crashTimestamps: [] });
    const timestamps = Array.isArray(state.crashTimestamps)
      ? state.crashTimestamps.filter(timestamp => Number.isFinite(timestamp) && now - timestamp < this.windowMs)
      : [];

    if (timestamps.length >= this.maxRestarts) {
      writeJsonAtomic(this.statePath, { crashTimestamps: timestamps, blockedAt: now });
      return false;
    }

    timestamps.push(now);
    writeJsonAtomic(this.statePath, { crashTimestamps: timestamps, lastCrashAt: now });
    return true;
  }

  markStable(now = Date.now()) {
    writeJsonAtomic(this.statePath, { crashTimestamps: [], stableAt: now });
  }
}

module.exports = CrashRecoveryPolicy;
