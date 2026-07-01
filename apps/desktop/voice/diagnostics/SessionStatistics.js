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
    this.recognitionCycles = {
      started: 0,
      endpoints: 0,
      completed: 0,
      stopped: 0,
      emptyFinalRecoveries: 0
    };
    this.speechDecisions = {
      evaluated: 0,
      accepted: 0,
      rejected: 0,
      rejectionReasons: {},
      classifications: {}
    };
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
    if (eventName === 'voice.recognition.cycle') {
      const phase = String(payload.phase || '');
      if (phase === 'started') this.recognitionCycles.started += 1;
      if (phase === 'endpoint') this.recognitionCycles.endpoints += 1;
      if (phase === 'completed') this.recognitionCycles.completed += 1;
      if (phase === 'stopped') this.recognitionCycles.stopped += 1;
      if (phase === 'empty-final-recovered') this.recognitionCycles.emptyFinalRecoveries += 1;
    }
    if (eventName === 'voice.speech.decision') {
      const decision = payload.speechDecision || {};
      const classification = decision.classification || 'unknown';
      const reason = decision.reason || 'unknown';
      this.speechDecisions.evaluated += 1;
      if (decision.accepted) {
        this.speechDecisions.accepted += 1;
      } else {
        this.speechDecisions.rejected += 1;
        this.speechDecisions.rejectionReasons[reason] = (this.speechDecisions.rejectionReasons[reason] || 0) + 1;
      }
      this.speechDecisions.classifications[classification] = (this.speechDecisions.classifications[classification] || 0) + 1;
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
      failureReasons: { ...this.failureReasons },
      recognitionCycles: { ...this.recognitionCycles },
      speechDecisions: {
        ...this.speechDecisions,
        rejectionReasons: { ...this.speechDecisions.rejectionReasons },
        classifications: { ...this.speechDecisions.classifications }
      }
    };
  }
}

module.exports = SessionStatistics;
