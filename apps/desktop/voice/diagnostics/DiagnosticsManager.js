'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const DiagnosticsConfiguration = require('./DiagnosticsConfiguration');
const DIAGNOSTICS_EVENTS = require('./DiagnosticsEvents');
const VoiceLogger = require('./VoiceLogger');
const VoiceMetrics = require('./VoiceMetrics');
const MetricsCollector = require('./MetricsCollector');
const LatencyMonitor = require('./LatencyMonitor');
const PerformanceMonitor = require('./PerformanceMonitor');
const ResourceMonitor = require('./ResourceMonitor');
const SessionStatistics = require('./SessionStatistics');
const ErrorTracker = require('./ErrorTracker');
const HealthMonitor = require('./HealthMonitor');
const EventTimeline = require('./EventTimeline');
const DiagnosticsReport = require('./DiagnosticsReport');
const { ReportGenerationFailed } = require('./DiagnosticsErrors');

/**
 * Purpose: Coordinates local passive Voice diagnostics.
 * Responsibility: Subscribe to voice events, collect metrics, timings, errors, timelines, health, and local reports.
 * Dependencies: Diagnostics helpers, local filesystem, and injectable event sources.
 * Lifecycle: start() attaches observation, stop() detaches observation; neither method controls voice execution.
 * Future extension notes: This manager must remain observer-only and must never modify transcripts, recognition, assistant behavior, or automation.
 */
class DiagnosticsManager extends EventEmitter {
  constructor(dependencies = {}) {
    super();
    this.configuration = dependencies.configuration instanceof DiagnosticsConfiguration
      ? dependencies.configuration
      : new DiagnosticsConfiguration(dependencies.configuration || {});
    this.clock = dependencies.clock || (() => new Date());
    this.collector = dependencies.collector || new MetricsCollector({ clock: this.clock });
    this.latencyMonitor = dependencies.latencyMonitor || new LatencyMonitor({ clock: this.clock });
    this.performanceMonitor = dependencies.performanceMonitor || new PerformanceMonitor({ clock: this.clock });
    this.resourceMonitor = dependencies.resourceMonitor || new ResourceMonitor({ clock: this.clock });
    this.sessionStatistics = dependencies.sessionStatistics || new SessionStatistics();
    this.errorTracker = dependencies.errorTracker || new ErrorTracker({ clock: this.clock, debugMode: this.configuration.debugMode });
    this.healthMonitor = dependencies.healthMonitor || new HealthMonitor();
    this.timeline = dependencies.timeline || new EventTimeline({ clock: this.clock });
    this.logger = dependencies.logger || new VoiceLogger({ configuration: this.configuration, enabled: true });
    this.metrics = dependencies.metrics || new VoiceMetrics({
      collector: this.collector,
      latency: this.latencyMonitor
    });
    this.subscriptions = [];
    this.running = false;
  }

  /**
   * Start diagnostics observation.
   * @param {{sessionManager?: object, resources?: object}} sources Observable sources.
   * @returns {{started: boolean}}
   */
  start(sources = {}) {
    if (this.running) return { started: false };
    this.running = true;
    this._ensureStorage();
    if (sources.resources) this.resourceMonitor.setResources(sources.resources);
    if (sources.sessionManager) this.attachToSessionManager(sources.sessionManager);
    this.performanceMonitor.sample({ reason: 'diagnostics-start' });
    this.emit(DIAGNOSTICS_EVENTS.DIAGNOSTICS_STARTED, Object.freeze({ at: this.clock().toISOString() }));
    this.logger.info('[Voice] Diagnostics Started');
    return { started: true };
  }

  /**
   * Stop diagnostics observation.
   * @returns {{stopped: boolean}}
   */
  stop() {
    for (const subscription of this.subscriptions) {
      const remove = subscription.source.off || subscription.source.removeListener;
      if (typeof remove === 'function') remove.call(subscription.source, subscription.eventName, subscription.listener);
    }
    this.subscriptions = [];
    this.running = false;
    this.emit(DIAGNOSTICS_EVENTS.DIAGNOSTICS_STOPPED, Object.freeze({ at: this.clock().toISOString() }));
    return { stopped: true };
  }

  /**
   * Attach to VoiceSessionManager events passively.
   * @param {{on: Function}} manager VoiceSessionManager-like object.
   * @returns {DiagnosticsManager}
   */
  attachToSessionManager(manager) {
    const events = require('../session/SessionEvents').SESSION_EVENTS;
    for (const eventName of Object.values(events)) {
      const listener = payload => this.observeEvent(eventName, payload);
      manager.on(eventName, listener);
      this.subscriptions.push({ source: manager, eventName, listener });
    }
    return this;
  }

  /**
   * Observe one event without influencing execution.
   * @param {string} eventName Event name.
   * @param {object} payload Event payload.
   * @returns {object}
   */
  observeEvent(eventName, payload = {}) {
    const timelineEvent = this.timeline.add(eventName, payload);
    this.sessionStatistics.recordEvent(eventName, payload);
    this.recordMetric(`event.${eventName}`, 1, { sessionId: timelineEvent.sessionId });
    if (/error/i.test(eventName) || payload.error) this.recordError(payload.error || eventName, { component: eventName });
    this.emit(DIAGNOSTICS_EVENTS.TIMELINE_EVENT_RECORDED, timelineEvent);
    return timelineEvent;
  }

  /**
   * Record one metric.
   * @param {string} name Metric name.
   * @param {number} value Metric value.
   * @param {object} metadata Metric metadata.
   * @returns {object}
   */
  recordMetric(name, value = 1, metadata = {}) {
    const metric = this.collector.record(name, value, metadata);
    this.emit(DIAGNOSTICS_EVENTS.METRIC_RECORDED, metric);
    return metric;
  }

  /**
   * Record latency.
   * @param {string} stage Pipeline stage.
   * @param {number} milliseconds Duration.
   * @param {object} metadata Latency metadata.
   * @returns {object}
   */
  recordLatency(stage, milliseconds, metadata = {}) {
    const latency = this.latencyMonitor.record(stage, milliseconds, metadata);
    this.emit(DIAGNOSTICS_EVENTS.LATENCY_UPDATED, latency);
    return latency;
  }

  /**
   * Record an error.
   * @param {Error|string|object} error Error payload.
   * @param {object} metadata Error metadata.
   * @returns {object}
   */
  recordError(error, metadata = {}) {
    const entry = this.errorTracker.record(error, metadata);
    this.emit(DIAGNOSTICS_EVENTS.ERROR_RECORDED, entry);
    return entry;
  }

  /**
   * Generate a local diagnostics report.
   * @param {string} kind Report kind.
   * @returns {object}
   */
  generateReport(kind = 'summary') {
    try {
      const snapshot = this.getSnapshot();
      const report = new DiagnosticsReport({
        kind,
        generatedAt: this.clock().toISOString(),
        summary: snapshot
      }).toJSON();
      const reportsDir = this.configuration.pathFor('reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, `${kind}-${Date.now()}.json`);
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      this.emit(DIAGNOSTICS_EVENTS.REPORT_GENERATED, Object.freeze({ path: reportPath, report }));
      return { generated: true, path: reportPath, report };
    } catch (error) {
      throw new ReportGenerationFailed('Diagnostics report generation failed.', { details: { error: error.message } });
    }
  }

  /**
   * Return current health.
   * @returns {object}
   */
  getHealth() {
    const health = this.healthMonitor.evaluate(this.getSnapshot(false));
    this.emit(DIAGNOSTICS_EVENTS.HEALTH_CHANGED, health);
    return health;
  }

  /**
   * Return diagnostics snapshot.
   * @param {boolean} includeHealth Include computed health.
   * @returns {object}
   */
  getSnapshot(includeHealth = true) {
    const snapshot = {
      metrics: this.collector.summarize(),
      latency: this.latencyMonitor.summary(),
      performance: this.performanceMonitor.summarize(),
      resources: this.resourceMonitor.summarize(),
      sessions: this.sessionStatistics.summarize(),
      errors: this.errorTracker.summarize(),
      timeline: this.timeline.list({ limit: 50 })
    };
    if (includeHealth) snapshot.health = this.healthMonitor.evaluate(snapshot);
    return snapshot;
  }

  _ensureStorage() {
    for (const section of ['metrics', 'logs', 'reports', 'health']) {
      fs.mkdirSync(this.configuration.pathFor(section), { recursive: true });
    }
  }
}

module.exports = DiagnosticsManager;
