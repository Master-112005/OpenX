'use strict';

/**
 * Purpose: Builds local diagnostics reports.
 * Responsibility: Serialize session, latency, performance, resource, error, health, and timeline summaries.
 * Dependencies: None.
 * Lifecycle: Created by DiagnosticsManager during report generation.
 * Future extension notes: Reports remain local JSON only.
 */
class DiagnosticsReport {
  constructor(options = {}) {
    this.generatedAt = options.generatedAt || new Date().toISOString();
    this.kind = options.kind || 'summary';
    this.summary = options.summary || {};
  }

  toJSON() {
    return {
      kind: this.kind,
      generatedAt: this.generatedAt,
      summary: this.summary
    };
  }
}

module.exports = DiagnosticsReport;
