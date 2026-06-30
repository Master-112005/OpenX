'use strict';

/**
 * Purpose: Tracks latency distributions for Voice pipeline stages.
 * Responsibility: Record minimum, maximum, average, and p95 latency without blocking execution.
 * Dependencies: None.
 * Lifecycle: Owned by DiagnosticsManager.
 * Future extension notes: Keep latency stage names stable for report comparisons.
 */
class LatencyMonitor {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.latencies = new Map();
  }

  record(stage, milliseconds, metadata = {}) {
    const key = String(stage || 'unknown');
    const value = Math.max(0, Number(milliseconds) || 0);
    const entry = Object.freeze({ stage: key, milliseconds: value, metadata: { ...metadata }, timestamp: this.clock().toISOString() });
    if (!this.latencies.has(key)) this.latencies.set(key, []);
    this.latencies.get(key).push(entry);
    return entry;
  }

  summary(stage = null) {
    const summarize = entries => {
      const values = entries.map(entry => entry.milliseconds).sort((a, b) => a - b);
      const total = values.reduce((sum, value) => sum + value, 0);
      const p95Index = values.length ? Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1) : 0;
      return {
        count: values.length,
        min: values.length ? values[0] : 0,
        max: values.length ? values[values.length - 1] : 0,
        average: values.length ? total / values.length : 0,
        p95: values.length ? values[p95Index] : 0
      };
    };
    if (stage) return summarize(this.latencies.get(String(stage)) || []);
    const result = {};
    for (const [key, entries] of this.latencies.entries()) result[key] = summarize(entries);
    return result;
  }
}

module.exports = LatencyMonitor;
