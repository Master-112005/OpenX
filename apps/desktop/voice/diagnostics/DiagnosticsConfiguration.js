'use strict';

const path = require('path');
const { buildDataPaths } = require('../../../../core/assistant/Data');
const { DiagnosticsConfigurationError } = require('./DiagnosticsErrors');

const DEFAULTS = Object.freeze({
  enabled: true,
  loggingLevel: 'info',
  metricsEnabled: true,
  performanceMonitoring: true,
  memoryMonitoring: true,
  latencyMonitoring: true,
  timelineRecording: true,
  healthChecks: true,
  maximumLogSizeBytes: 1024 * 1024,
  retentionDays: 14,
  debugMode: false,
  storageRoot: buildDataPaths().voiceDiagnosticsDir
});

/**
 * Purpose: Centralizes local Voice diagnostics configuration.
 * Responsibility: Validate storage, logging, retention, timeline, and health settings.
 * Dependencies: DiagnosticsErrors for structured failures.
 * Lifecycle: Created by DiagnosticsManager and helpers.
 * Future extension notes: Do not add remote telemetry settings; diagnostics are local only.
 */
class DiagnosticsConfiguration {
  constructor(options = {}) {
    const merged = { ...DEFAULTS, ...(options || {}) };
    DiagnosticsConfiguration.validate(merged);
    this.options = Object.freeze(merged);
    Object.assign(this, this.options);
    Object.freeze(this);
  }

  static validate(config) {
    if (!config.storageRoot || typeof config.storageRoot !== 'string') {
      throw new DiagnosticsConfigurationError('Diagnostics storage root is invalid.');
    }
    if (!Number.isInteger(config.maximumLogSizeBytes) || config.maximumLogSizeBytes < 1024) {
      throw new DiagnosticsConfigurationError('Diagnostics log size limit is invalid.');
    }
    if (!Number.isFinite(config.retentionDays) || config.retentionDays < 1) {
      throw new DiagnosticsConfigurationError('Diagnostics retention period is invalid.');
    }
    return true;
  }

  pathFor(section) {
    return path.join(this.storageRoot, String(section || ''));
  }

  toJSON() {
    return { ...this.options };
  }
}

DiagnosticsConfiguration.DEFAULTS = DEFAULTS;

module.exports = DiagnosticsConfiguration;
