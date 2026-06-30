'use strict';

/**
 * Purpose: Defines local Voice diagnostics event names.
 * Responsibility: Provide stable observer-only diagnostics events.
 * Dependencies: None.
 * Lifecycle: Emitted by DiagnosticsManager and helper monitors.
 * Future extension notes: Keep these local; do not add cloud or analytics concepts.
 */
const DIAGNOSTICS_EVENTS = Object.freeze({
  DIAGNOSTICS_STARTED: 'voice.diagnostics.started',
  DIAGNOSTICS_STOPPED: 'voice.diagnostics.stopped',
  METRIC_RECORDED: 'voice.diagnostics.metric.recorded',
  LATENCY_UPDATED: 'voice.diagnostics.latency.updated',
  HEALTH_CHANGED: 'voice.diagnostics.health.changed',
  REPORT_GENERATED: 'voice.diagnostics.report.generated',
  ERROR_RECORDED: 'voice.diagnostics.error.recorded',
  SESSION_SUMMARIZED: 'voice.diagnostics.session.summarized',
  TIMELINE_EVENT_RECORDED: 'voice.diagnostics.timeline.recorded'
});

module.exports = DIAGNOSTICS_EVENTS;
