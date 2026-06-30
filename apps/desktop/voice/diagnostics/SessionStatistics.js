'use strict';

/**
 * Purpose: Tracks aggregate Voice session statistics.
 * Responsibility: Count starts, completions, cancellations, failures, durations, reasons, and transcript lengths.
 * Dependencies: None.
 * Lifecycle: Updated by DiagnosticsManager from observed manager events.
 * Future extension notes: Store only metadata and lengths, not transcript content.
 */
class SessionStatistics {
  constructor() {
    this.started = 0;
    this.completed = 0;
    this.cancelled = 0;
    this.failed = 0;
    this.durations = [];
    this.transcriptLengths = [];
    this.cancellationReasons = {};
    this.failureReasons = {};
  }

  recordEvent(eventName, payload = {}) {
    if (/created|started/.test(eventName)) this.started += eventName.includes('created') ? 1 : 0;
    if (/finished|closed/.test(eventName)) this.completed += eventName.includes('finished') ? 1 : 0;
    if (/cancelled/.test(eventName)) {
      this.cancelled += 1;
      const reason = payload.session?.cancellationReason || payload.reason || 'unknown';
      this.cancellationReasons[reason] = (this.cancellationReasons[reason] || 0) + 1;
    }
    if (/error/.test(eventName)) {
      this.failed += 1;
      const reason = payload.error?.message || payload.error?.type || 'unknown';
      this.failureReasons[reason] = (this.failureReasons[reason] || 0) + 1;
    }
    const duration = Number(payload.session?.durationMs);
    if (Number.isFinite(duration)) this.durations.push(duration);
    const transcript = payload.session?.transcript || payload.transcriptResult?.transcript || payload.transcriptResult?.finalTranscript || '';
    if (transcript) this.transcriptLengths.push(String(transcript).length);
  }

  summarize() {
    const avg = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      sessionsStarted: this.started,
      sessionsCompleted: this.completed,
      sessionsCancelled: this.cancelled,
      sessionsFailed: this.failed,
      averageDurationMs: avg(this.durations),
      longestSessionMs: this.durations.length ? Math.max(...this.durations) : 0,
      shortestSessionMs: this.durations.length ? Math.min(...this.durations) : 0,
      averageTranscriptLength: avg(this.transcriptLengths),
      cancellationReasons: { ...this.cancellationReasons },
      failureReasons: { ...this.failureReasons }
    };
  }
}

module.exports = SessionStatistics;
