'use strict';

const VoiceStateMachine = require('./VoiceStateMachine');

/**
 * Purpose: Represents metadata for one complete Voice interaction.
 * Responsibility: Store lifecycle timestamps, current state, transcript placeholder, cancellation/error metadata, and future context shells.
 * Lifecycle: Created by VoiceSessionManager, advanced only by VoiceSessionManager, and converted to snapshots before external use.
 * Dependencies: VoiceStateMachine for the initial state vocabulary.
 * Future integration notes: Audio buffers, recognizer handles, and assistant execution objects must stay outside this metadata object.
 */
class VoiceSession {
  /**
   * Create a metadata-only Voice session record.
   * @param {{id?: string, sessionId?: string, createdAt?: Date|string, startedAt?: Date|string, state?: string, transcript?: string}} options Session metadata.
   */
  constructor(options = {}) {
    const stateMachine = new VoiceStateMachine();
    this.sessionId = options.sessionId || options.id || `voice-session-${Date.now()}`;
    this.id = this.sessionId;
    this.createdAt = options.createdAt ? new Date(options.createdAt) : new Date();
    this.startedAt = options.startedAt ? new Date(options.startedAt) : null;
    this.endedAt = null;
    this.currentState = options.state || stateMachine.getInitialState();
    this.state = this.currentState;
    this.transcript = options.transcript || '';
    this.cancellationReason = null;
    this.error = null;
    this.context = {
      audio: {},
      recognition: {},
      execution: {},
      diagnostics: {}
    };
    this.metrics = {
      transitions: [],
      lifecycleTimestamps: {
        createdAt: this.createdAt.toISOString()
      }
    };
  }

  /**
   * Mark the session as started without touching audio or recognition resources.
   * @param {Date|string} startedAt Start timestamp.
   * @returns {VoiceSession}
   */
  start(startedAt = new Date()) {
    this.startedAt = new Date(startedAt);
    this.metrics.lifecycleTimestamps.startedAt = this.startedAt.toISOString();
    return this;
  }

  /**
   * Change the stored metadata state after manager validation.
   * @param {string} state Future session state.
   * @param {{at?: Date|string, reason?: string}} details Transition metadata.
   * @returns {VoiceSession}
   */
  setState(state, details = {}) {
    const changedAt = details.at ? new Date(details.at) : new Date();
    const previousState = this.currentState;
    this.currentState = state;
    this.state = state;
    this.metrics.transitions.push({
      fromState: previousState,
      toState: state,
      at: changedAt.toISOString(),
      reason: details.reason || ''
    });
    this.metrics.lifecycleTimestamps[state] = changedAt.toISOString();
    return this;
  }

  /**
   * Store a transcript placeholder for future phases.
   * @param {string} transcript Placeholder transcript text.
   * @returns {VoiceSession}
   */
  setTranscriptPlaceholder(transcript) {
    this.transcript = String(transcript || '');
    return this;
  }

  /**
   * Mark the session as cancelled.
   * @param {string} reason Human-readable cancellation reason.
   * @param {Date|string} endedAt Cancellation timestamp.
   * @returns {VoiceSession}
   */
  cancel(reason = 'Session cancelled.', endedAt = new Date()) {
    this.cancellationReason = String(reason || 'Session cancelled.');
    this.endedAt = new Date(endedAt);
    this.metrics.lifecycleTimestamps.endedAt = this.endedAt.toISOString();
    return this;
  }

  /**
   * Store structured error metadata for the session.
   * @param {Error|string|object} error Error object or placeholder.
   * @param {Date|string} endedAt Error timestamp.
   * @returns {VoiceSession}
   */
  fail(error, endedAt = new Date()) {
    const fallback = { name: 'VoiceSessionError', message: 'Voice session failed.' };
    if (error instanceof Error) {
      this.error = { name: error.name, message: error.message };
    } else if (error && typeof error === 'object') {
      this.error = {
        name: String(error.name || fallback.name),
        message: String(error.message || fallback.message),
        type: error.type ? String(error.type) : undefined
      };
    } else {
      this.error = { ...fallback, message: String(error || fallback.message) };
    }
    this.endedAt = new Date(endedAt);
    this.metrics.lifecycleTimestamps.endedAt = this.endedAt.toISOString();
    return this;
  }

  /**
   * Mark the metadata session as finished.
   * @param {Date|string} endedAt Completion timestamp.
   * @returns {VoiceSession}
   */
  finish(endedAt = new Date()) {
    this.endedAt = new Date(endedAt);
    this.metrics.lifecycleTimestamps.endedAt = this.endedAt.toISOString();
    return this;
  }

  /**
   * Return elapsed metadata duration.
   * @param {Date|string} now Reference timestamp.
   * @returns {number}
   */
  getDurationMs(now = new Date()) {
    const end = this.endedAt || new Date(now);
    const start = this.startedAt || this.createdAt;
    return Math.max(0, end.getTime() - start.getTime());
  }

  /**
   * Return a JSON-safe snapshot.
   * @returns {{id: string, sessionId: string, createdAt: string, startedAt: string|null, endedAt: string|null, state: string, currentState: string, durationMs: number, transcript: string, cancellationReason: string|null, error: object|null, context: object, metrics: object}}
   */
  toJSON() {
    return {
      id: this.sessionId,
      sessionId: this.sessionId,
      createdAt: this.createdAt.toISOString(),
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      endedAt: this.endedAt ? this.endedAt.toISOString() : null,
      state: this.currentState,
      currentState: this.currentState,
      durationMs: this.getDurationMs(),
      transcript: this.transcript,
      cancellationReason: this.cancellationReason,
      error: this.error ? { ...this.error } : null,
      context: JSON.parse(JSON.stringify(this.context)),
      metrics: JSON.parse(JSON.stringify(this.metrics))
    };
  }
}

module.exports = VoiceSession;
