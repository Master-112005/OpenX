const { readJsonFile, writeJsonAtomic } = require('../../../core/assistant/Data');

class CrashRecoveryPolicy {
  constructor(options = {}) {
    if (!options.statePath) throw new TypeError('Crash recovery statePath is required');
    this.statePath = options.statePath;
    this.maxRestarts = Number.isInteger(options.maxRestarts) ? options.maxRestarts : 3;
    this.windowMs = Number.isFinite(options.windowMs) ? options.windowMs : 5 * 60 * 1000;
  }

  readCrashTimestamps(now = Date.now()) {
    const state = readJsonFile(this.statePath, { crashTimestamps: [] });
    return Array.isArray(state.crashTimestamps)
      ? state.crashTimestamps.filter(timestamp => (
        Number.isFinite(timestamp)
        && timestamp >= 0
        && timestamp <= now
        && now - timestamp < this.windowMs
      ))
      : [];
  }

  getState(now = Date.now()) {
    const crashTimestamps = this.readCrashTimestamps(now);
    return {
      blocked: crashTimestamps.length >= this.maxRestarts,
      crashTimestamps,
      remainingRestarts: Math.max(0, this.maxRestarts - crashTimestamps.length)
    };
  }

  requestRestart(now = Date.now()) {
    const timestamps = this.readCrashTimestamps(now);

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
