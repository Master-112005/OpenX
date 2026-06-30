'use strict';

const MetricsCollector = require('./MetricsCollector');
const LatencyMonitor = require('./LatencyMonitor');

/**
 * Purpose: Records local Voice metrics.
 * Responsibility: Provide counter and timing APIs for voice components without changing behavior.
 * Dependencies: MetricsCollector and LatencyMonitor.
 * Lifecycle: Injected into voice components by VoiceSessionManager or DiagnosticsManager.
 * Future implementation notes: Keep this local and metadata-only.
 */
class VoiceMetrics {
  constructor(options = {}) {
    this.collector = options.collector || new MetricsCollector(options);
    this.latency = options.latency || new LatencyMonitor(options);
  }

  /**
   * Increment a counter.
   * @param {string} name Metric name.
   * @param {number} value Increment value.
   * @returns {{recorded: boolean, name: string, value: number}}
   */
  increment(name, value = 1) {
    const metric = this.collector.record(name, value);
    return { recorded: true, name: metric.name, value: metric.value };
  }

  /**
   * Record a duration.
   * @param {string} name Metric name.
   * @param {number} milliseconds Duration in milliseconds.
   * @returns {{recorded: boolean, name: string, milliseconds: number}}
   */
  timing(name, milliseconds) {
    const entry = this.latency.record(name, milliseconds);
    return { recorded: true, name: entry.stage, milliseconds: entry.milliseconds };
  }

  getSnapshot() {
    return {
      metrics: this.collector.summarize(),
      latency: this.latency.summary()
    };
  }
}

module.exports = VoiceMetrics;
