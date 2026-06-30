'use strict';

const { sanitizeMetadata } = require('./privacy');

/**
 * Purpose: Collects local Voice metrics.
 * Responsibility: Store sanitized metric values and metadata without changing voice behavior.
 * Dependencies: Privacy sanitizer.
 * Lifecycle: Owned by DiagnosticsManager.
 * Future extension notes: No subsystem should bypass DiagnosticsManager to write metrics.
 */
class MetricsCollector {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.metrics = [];
  }

  record(name, value = 1, metadata = {}) {
    const metric = Object.freeze({
      name: String(name || 'voice.metric'),
      value: Number(value) || 0,
      metadata: sanitizeMetadata(metadata),
      timestamp: this.clock().toISOString()
    });
    this.metrics.push(metric);
    return metric;
  }

  list(limit = 100) {
    return this.metrics.slice(-Math.max(0, Number(limit) || 0));
  }

  summarize() {
    const totals = {};
    for (const metric of this.metrics) {
      totals[metric.name] = (totals[metric.name] || 0) + metric.value;
    }
    return { count: this.metrics.length, totals };
  }
}

module.exports = MetricsCollector;
