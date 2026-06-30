'use strict';

/**
 * Purpose: Samples local Voice runtime performance metadata.
 * Responsibility: Record CPU and memory snapshots without optimizing or changing behavior.
 * Dependencies: Node process APIs.
 * Lifecycle: Called by DiagnosticsManager on demand or observed intervals.
 * Future extension notes: Renderer memory can be injected by Electron-specific adapters later.
 */
class PerformanceMonitor {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.process = options.process || process;
    this.samples = [];
    this.previousCpu = null;
  }

  sample(metadata = {}) {
    const memory = typeof this.process.memoryUsage === 'function' ? this.process.memoryUsage() : {};
    const cpu = typeof this.process.cpuUsage === 'function' ? this.process.cpuUsage(this.previousCpu || undefined) : {};
    this.previousCpu = typeof this.process.cpuUsage === 'function' ? this.process.cpuUsage() : null;
    const snapshot = Object.freeze({
      timestamp: this.clock().toISOString(),
      cpuUserMicros: Number(cpu.user) || 0,
      cpuSystemMicros: Number(cpu.system) || 0,
      heapUsed: Number(memory.heapUsed) || 0,
      heapTotal: Number(memory.heapTotal) || 0,
      rss: Number(memory.rss) || 0,
      external: Number(memory.external) || 0,
      metadata: { ...metadata }
    });
    this.samples.push(snapshot);
    return snapshot;
  }

  getLatest() {
    return this.samples[this.samples.length - 1] || null;
  }

  summarize() {
    const latest = this.getLatest();
    return { sampleCount: this.samples.length, latest };
  }
}

module.exports = PerformanceMonitor;
