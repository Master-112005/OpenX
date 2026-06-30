'use strict';

/**
 * Purpose: Evaluates passive Voice subsystem health.
 * Responsibility: Derive healthy, warning, degraded, or critical status from local metrics and errors.
 * Dependencies: None.
 * Lifecycle: Called after metrics/errors update.
 * Future extension notes: Health only reports; it must never stop or alter execution.
 */
class HealthMonitor {
  constructor() {
    this.current = Object.freeze({ status: 'healthy', reasons: [] });
  }

  evaluate(snapshot = {}) {
    const reasons = [];
    const errors = Number(snapshot.errors?.count || 0);
    const failed = Number(snapshot.sessions?.sessionsFailed || 0);
    const p95 = Math.max(
      ...Object.values(snapshot.latency || {}).map(entry => Number(entry.p95) || 0),
      0
    );
    const heapUsed = Number(snapshot.performance?.latest?.heapUsed || 0);
    if (errors > 10 || failed > 5) reasons.push('high-error-rate');
    if (p95 > 5000) reasons.push('high-latency');
    if (heapUsed > 512 * 1024 * 1024) reasons.push('memory-growth');
    const status = reasons.length === 0
      ? 'healthy'
      : reasons.length === 1
        ? 'warning'
        : reasons.length === 2
          ? 'degraded'
          : 'critical';
    this.current = Object.freeze({ status, reasons });
    return this.current;
  }

  getStatus() {
    return this.current;
  }
}

module.exports = HealthMonitor;
