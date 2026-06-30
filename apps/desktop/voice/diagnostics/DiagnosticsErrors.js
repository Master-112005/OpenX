'use strict';

/**
 * Purpose: Defines structured diagnostics errors.
 * Responsibility: Keep diagnostics failures isolated from voice and assistant behavior.
 * Dependencies: None.
 * Lifecycle: Thrown or recorded inside diagnostics only.
 * Future extension notes: Diagnostics errors must never stop voice execution.
 */
class DiagnosticsError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || this.constructor.name;
    this.details = Object.freeze({ ...(options.details || {}) });
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: { ...this.details }
    };
  }
}

class MetricsCollectionFailed extends DiagnosticsError {}
class LoggerFailure extends DiagnosticsError {}
class ReportGenerationFailed extends DiagnosticsError {}
class TimelineCorrupted extends DiagnosticsError {}
class ResourceMonitorFailure extends DiagnosticsError {}
class HealthMonitorFailure extends DiagnosticsError {}
class DiagnosticsConfigurationError extends DiagnosticsError {}

module.exports = {
  DiagnosticsError,
  MetricsCollectionFailed,
  LoggerFailure,
  ReportGenerationFailed,
  TimelineCorrupted,
  ResourceMonitorFailure,
  HealthMonitorFailure,
  DiagnosticsConfigurationError
};
