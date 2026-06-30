'use strict';

const { ResourceMonitorFailure } = require('./DiagnosticsErrors');

/**
 * Purpose: Observes Voice resource ownership.
 * Responsibility: Snapshot session, microphone, STT, processing, buffer, timer, and memory metadata.
 * Dependencies: Optional resource providers.
 * Lifecycle: Called by DiagnosticsManager without mutating resources.
 * Future extension notes: Add leak heuristics here, not in pipeline components.
 */
class ResourceMonitor {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.resources = options.resources || {};
    this.snapshots = [];
  }

  setResources(resources = {}) {
    this.resources = resources;
    return this;
  }

  snapshot(extra = {}) {
    try {
      const statusFor = resource => {
        if (!resource) return null;
        if (typeof resource.getStatus === 'function') return resource.getStatus();
        return { available: true };
      };
      const snapshot = Object.freeze({
        timestamp: this.clock().toISOString(),
        session: statusFor(this.resources.sessionManager),
        audioCapture: statusFor(this.resources.audioCapture),
        audioProcessor: statusFor(this.resources.audioProcessor),
        sttEngine: statusFor(this.resources.sttEngine),
        transcriptProcessor: statusFor(this.resources.transcriptProcessor),
        activeTimers: Number(extra.activeTimers) || 0,
        workerThreads: Number(extra.workerThreads) || 0
      });
      this.snapshots.push(snapshot);
      return snapshot;
    } catch (error) {
      throw new ResourceMonitorFailure('Voice resource snapshot failed.', { details: { error: error.message } });
    }
  }

  summarize() {
    return {
      snapshotCount: this.snapshots.length,
      latest: this.snapshots[this.snapshots.length - 1] || null
    };
  }
}

module.exports = ResourceMonitor;
