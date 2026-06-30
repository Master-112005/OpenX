'use strict';

const { sanitizeMetadata } = require('./privacy');

/**
 * Purpose: Tracks Voice subsystem errors.
 * Responsibility: Record categorized errors with timestamp, component, severity, and safe metadata.
 * Dependencies: Privacy sanitizer.
 * Lifecycle: DiagnosticsManager records observed failures here.
 * Future extension notes: Stack traces are stored only when debug mode is enabled.
 */
class ErrorTracker {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.debugMode = options.debugMode === true;
    this.errors = [];
  }

  record(error, metadata = {}) {
    const normalized = error instanceof Error
      ? { name: error.name, message: error.message, stack: this.debugMode ? error.stack : undefined }
      : { name: String(error?.name || 'VoiceError'), message: String(error?.message || error || 'Voice error') };
    const entry = Object.freeze({
      timestamp: this.clock().toISOString(),
      component: String(metadata.component || 'voice'),
      severity: String(metadata.severity || 'error'),
      recoveryAction: String(metadata.recoveryAction || 'observe'),
      error: normalized,
      metadata: sanitizeMetadata(metadata)
    });
    this.errors.push(entry);
    return entry;
  }

  list(limit = 100) {
    return this.errors.slice(-Math.max(0, Number(limit) || 0));
  }

  summarize() {
    const byComponent = {};
    for (const entry of this.errors) {
      byComponent[entry.component] = (byComponent[entry.component] || 0) + 1;
    }
    return { count: this.errors.length, byComponent };
  }
}

module.exports = ErrorTracker;
