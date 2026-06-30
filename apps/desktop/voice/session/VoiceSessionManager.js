'use strict';

const EventEmitter = require('events');
const VoiceSession = require('./VoiceSession');
const VoiceStateMachine = require('./VoiceStateMachine');
const { SESSION_EVENTS, VOICE_ERROR_TYPES } = require('./SessionEvents');
const VoiceSettings = require('../config/VoiceSettings');
const VoiceLogger = require('../diagnostics/VoiceLogger');
const VoiceMetrics = require('../diagnostics/VoiceMetrics');

/**
 * Purpose: Central lifecycle controller for every future OpenX Voice interaction.
 * Responsibility: Own session creation, state transitions, resource placeholders, timeouts, cleanup, events, logging, and metrics.
 * Lifecycle: The manager moves from IDLE through INITIALIZING, READY, LISTENING, PROCESSING, EXECUTING, then closes back to IDLE.
 * Dependencies: VoiceSession, VoiceStateMachine, VoiceLogger, VoiceMetrics, and injectable timer/clock functions for deterministic tests.
 * Future integration notes: Electron, hotkeys, microphone capture, STT, preprocessing, UI, and assistant execution must call this manager instead of controlling each other directly.
 */
class VoiceSessionManager {
  /**
   * Create the Voice session manager.
   * @param {{SessionClass?: typeof VoiceSession, stateMachine?: VoiceStateMachine, logger?: VoiceLogger, metrics?: VoiceMetrics, clock?: () => Date, setTimeout?: Function, clearTimeout?: Function, timeouts?: object, resources?: object}} dependencies Replaceable dependencies.
   */
  constructor(dependencies = {}) {
    this.SessionClass = dependencies.SessionClass || VoiceSession;
    this.stateMachine = dependencies.stateMachine || new VoiceStateMachine();
    this.logger = dependencies.logger || new VoiceLogger();
    this.metricsRecorder = dependencies.metrics || new VoiceMetrics();
    this.clock = dependencies.clock || (() => new Date());
    this.setTimer = dependencies.setTimeout || setTimeout;
    this.clearTimer = dependencies.clearTimeout || clearTimeout;
    this.timeouts = {
      ...VoiceSettings.session.timeouts,
      ...(dependencies.timeouts || {})
    };
    this.resources = {
      audioCapture: null,
      sttEngine: null,
      preprocessingPipeline: null,
      ui: null,
      diagnostics: null,
      ...(dependencies.resources || {})
    };
    this.events = new EventEmitter();
    this.currentSession = null;
    this.currentState = this.stateMachine.getInitialState();
    this.activeTimers = new Map();
    this.transitionLog = [];
    this.sessionHistory = [];
  }

  /**
   * Subscribe to a Voice lifecycle event.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Subscribe once to a Voice lifecycle event.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  once(eventName, listener) {
    this.events.once(eventName, listener);
    return this;
  }

  /**
   * Remove a Voice lifecycle event listener.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Initialize manager-owned resources and move to READY.
   * @returns {{success: boolean, state: string}}
   */
  initialize() {
    if (this.currentState === VoiceStateMachine.STATES.READY) {
      return { success: true, state: this.currentState };
    }
    this._transitionTo(VoiceStateMachine.STATES.INITIALIZING, { reason: 'initialize' });
    this._scheduleLifecycleTimeout('initialization', this.timeouts.initializationMs);
    this._transitionTo(VoiceStateMachine.STATES.READY, { reason: 'initialize-complete' });
    this._publish(SESSION_EVENTS.VOICE_SESSION_INITIALIZED, this._buildEventPayload());
    return { success: true, state: this.currentState };
  }

  /**
   * Create a session and immediately begin listening through the validated lifecycle.
   * @param {{id?: string, sessionId?: string, transcript?: string}} options Session options.
   * @returns {{success: boolean, state: string, session: object}}
   */
  startSession(options = {}) {
    this.prepareSession(options);
    return this.beginListening();
  }

  /**
   * Create a single owned session without starting audio capture.
   * @param {{id?: string, sessionId?: string, transcript?: string}} options Session options.
   * @returns {{success: boolean, state: string, session: object}}
   */
  prepareSession(options = {}) {
    this._assertNoActiveSession();
    if (this.currentState === VoiceStateMachine.STATES.IDLE) {
      this.initialize();
    }
    if (this.currentState !== VoiceStateMachine.STATES.READY) {
      throw new Error(`Cannot prepare Voice session from ${this.currentState}.`);
    }

    this.currentSession = new this.SessionClass(options);
    this.currentSession.setState(this.currentState, { at: this.clock(), reason: 'prepared' });
    this._scheduleLifecycleTimeout('overall', this.timeouts.overallMs);
    this._publish(SESSION_EVENTS.VOICE_SESSION_CREATED, this._buildEventPayload());
    this._log('Session Created', { state: this.currentState, sessionId: this.currentSession.sessionId });
    return this._result();
  }

  /**
   * Move the current session into LISTENING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginListening() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.LISTENING, { reason: 'begin-listening' });
    this.currentSession.start(this.clock());
    this._scheduleLifecycleTimeout('listening', this.timeouts.listeningMs);
    this._publish(SESSION_EVENTS.VOICE_SESSION_STARTED, this._buildEventPayload());
    return this._result();
  }

  /**
   * Move the current session into PROCESSING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginProcessing() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.PROCESSING, { reason: 'begin-processing' });
    this._scheduleLifecycleTimeout('processing', this.timeouts.processingMs);
    return this._result();
  }

  /**
   * Move the current session into EXECUTING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginExecution() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.EXECUTING, { reason: 'begin-execution' });
    this._scheduleLifecycleTimeout('execution', this.timeouts.executionMs);
    return this._result();
  }

  /**
   * Finish the current session and automatically clean up back to IDLE.
   * @returns {{success: boolean, state: string, session: object}}
   */
  finishSession() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.FINISHED, { reason: 'finish-session' });
    this.currentSession.finish(this.clock());
    const snapshot = this.currentSession.toJSON();
    this._publish(SESSION_EVENTS.VOICE_SESSION_FINISHED, this._buildEventPayload(snapshot));
    this.closeSession('finished');
    return { success: true, state: this.currentState, session: snapshot };
  }

  /**
   * Compatibility alias for finishing a session that is already executing.
   * @returns {{success: boolean, state: string, session: object}}
   */
  stopSession() {
    return this.finishSession();
  }

  /**
   * Cancel the current session and automatically clean up back to IDLE.
   * @param {string} reason Cancellation reason.
   * @returns {{success: boolean, state: string, session: object}}
   */
  cancelSession(reason = 'Session cancelled.') {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.CANCELLED, { reason });
    this.currentSession.cancel(reason, this.clock());
    const snapshot = this.currentSession.toJSON();
    this._publish(SESSION_EVENTS.VOICE_SESSION_CANCELLED, this._buildEventPayload(snapshot));
    this.closeSession('cancelled');
    return { success: true, state: this.currentState, session: snapshot };
  }

  /**
   * Move the current session through ERROR recovery and automatically clean up back to IDLE.
   * @param {Error|string|object} error Error or placeholder error metadata.
   * @returns {{success: boolean, state: string, session: object|null, error: object}}
   */
  failSession(error) {
    const normalizedError = this._normalizeError(error);
    if (this.currentState !== VoiceStateMachine.STATES.ERROR) {
      this._transitionTo(VoiceStateMachine.STATES.ERROR, { reason: normalizedError.message });
    }
    if (this.currentSession) {
      this.currentSession.fail(normalizedError, this.clock());
    }
    const snapshot = this.currentSession ? this.currentSession.toJSON() : null;
    this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(snapshot, { error: normalizedError }));
    this.closeSession('error');
    return { success: false, state: this.currentState, session: snapshot, error: normalizedError };
  }

  /**
   * Close the current lifecycle state, release placeholders, and return to IDLE.
   * @param {string} reason Cleanup reason.
   * @returns {{success: boolean, state: string}}
   */
  closeSession(reason = 'close-session') {
    if (this.currentState === VoiceStateMachine.STATES.IDLE && !this.currentSession) {
      return { success: true, state: this.currentState };
    }

    if (this.currentState !== VoiceStateMachine.STATES.CLOSING) {
      this._transitionTo(VoiceStateMachine.STATES.CLOSING, { reason });
    }

    const snapshot = this.currentSession ? this.currentSession.toJSON() : null;
    this._clearAllTimeouts();
    this._releaseResourcePlaceholders();
    if (snapshot) {
      this.sessionHistory.push(snapshot);
    }
    this.currentSession = null;
    this._transitionTo(VoiceStateMachine.STATES.IDLE, { reason: 'cleanup-complete', sessionSnapshot: snapshot });
    this._publish(SESSION_EVENTS.VOICE_SESSION_CLOSED, this._buildEventPayload(snapshot));
    return { success: true, state: this.currentState };
  }

  /**
   * Force cleanup and restore IDLE without keeping the active session.
   * @returns {{success: boolean, state: string}}
   */
  reset() {
    this._clearAllTimeouts();
    this._releaseResourcePlaceholders();
    if (this.currentSession) {
      this.sessionHistory.push(this.currentSession.toJSON());
    }
    this.currentSession = null;
    this.currentState = this.stateMachine.getInitialState();
    this._log('Reset', { state: this.currentState });
    return { success: true, state: this.currentState };
  }

  /**
   * Return an immutable snapshot of the current session.
   * @returns {object|null}
   */
  getSession() {
    return this.currentSession ? this.currentSession.toJSON() : null;
  }

  /**
   * Get the manager's current state.
   * @returns {string}
   */
  getCurrentState() {
    return this.currentState;
  }

  /**
   * Report whether a session is currently owned by the manager.
   * @returns {boolean}
   */
  isActive() {
    return Boolean(this.currentSession);
  }

  /**
   * Report whether the manager is not IDLE.
   * @returns {boolean}
   */
  isBusy() {
    return this.currentState !== VoiceStateMachine.STATES.IDLE;
  }

  /**
   * Return metadata-only lifecycle metrics.
   * @returns {{state: string, active: boolean, busy: boolean, transitionCount: number, sessionCount: number, currentSession: object|null, transitions: object[]}}
   */
  getMetrics() {
    return {
      state: this.currentState,
      active: this.isActive(),
      busy: this.isBusy(),
      transitionCount: this.transitionLog.length,
      sessionCount: this.sessionHistory.length + (this.currentSession ? 1 : 0),
      currentSession: this.getSession(),
      transitions: this.transitionLog.map(transition => ({ ...transition }))
    };
  }

  /**
   * Validate and apply a state transition.
   * @param {string} nextState Requested next state.
   * @param {{reason?: string, sessionSnapshot?: object}} details Transition details.
   * @returns {string}
   * @private
   */
  _transitionTo(nextState, details = {}) {
    const previousState = this.currentState;
    this.stateMachine.assertTransition(previousState, nextState);
    this.currentState = nextState;
    const now = this.clock();
    const transition = {
      fromState: previousState,
      toState: nextState,
      at: now.toISOString(),
      reason: details.reason || ''
    };
    this.transitionLog.push(transition);
    if (this.currentSession) {
      this.currentSession.setState(nextState, { at: now, reason: details.reason });
    }
    this._clearCompletedTimeouts(nextState);
    this.metricsRecorder.increment('voice.state.transition', 1);
    this._log('State Changed', transition);
    this._publish(SESSION_EVENTS.VOICE_STATE_CHANGED, this._buildEventPayload(details.sessionSnapshot, { transition }));
    return this.currentState;
  }

  /**
   * Schedule a placeholder lifecycle timeout.
   * @param {string} name Timeout name.
   * @param {number} milliseconds Timeout duration.
   * @returns {void}
   * @private
   */
  _scheduleLifecycleTimeout(name, milliseconds) {
    const timeoutMs = Math.max(0, Number(milliseconds) || 0);
    if (!timeoutMs) return;
    this._clearTimeout(name);
    const timer = this.setTimer(() => {
      this._publish(SESSION_EVENTS.VOICE_TIMEOUT, this._buildEventPayload(null, { timeout: name }));
      if (this.currentState !== VoiceStateMachine.STATES.IDLE) {
        this.failSession({
          name: VOICE_ERROR_TYPES.TIMEOUT,
          message: `Voice ${name} timeout expired.`,
          type: VOICE_ERROR_TYPES.TIMEOUT
        });
      }
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    this.activeTimers.set(name, timer);
  }

  /**
   * Clear timeouts that no longer belong to the active lifecycle state.
   * @param {string} nextState State just entered.
   * @returns {void}
   * @private
   */
  _clearCompletedTimeouts(nextState) {
    const states = VoiceStateMachine.STATES;
    const timeoutByState = {
      [states.READY]: ['initialization'],
      [states.PROCESSING]: ['listening'],
      [states.EXECUTING]: ['processing'],
      [states.FINISHED]: ['execution'],
      [states.CANCELLED]: ['listening', 'processing', 'execution'],
      [states.ERROR]: ['initialization', 'listening', 'processing', 'execution'],
      [states.CLOSING]: ['initialization', 'listening', 'processing', 'execution', 'overall'],
      [states.IDLE]: ['initialization', 'listening', 'processing', 'execution', 'overall']
    };
    for (const name of timeoutByState[nextState] || []) {
      this._clearTimeout(name);
    }
  }

  /**
   * Clear one lifecycle timeout.
   * @param {string} name Timeout name.
   * @returns {void}
   * @private
   */
  _clearTimeout(name) {
    if (!this.activeTimers.has(name)) return;
    this.clearTimer(this.activeTimers.get(name));
    this.activeTimers.delete(name);
  }

  /**
   * Clear all lifecycle timeouts.
   * @returns {void}
   * @private
   */
  _clearAllTimeouts() {
    for (const name of Array.from(this.activeTimers.keys())) {
      this._clearTimeout(name);
    }
  }

  /**
   * Ensure no current session is active before creating a new one.
   * @returns {void}
   * @private
   */
  _assertNoActiveSession() {
    if (this.currentSession) {
      throw new Error(`${VOICE_ERROR_TYPES.SESSION_BUSY}: Voice session already exists.`);
    }
  }

  /**
   * Ensure a session exists before a lifecycle action.
   * @returns {void}
   * @private
   */
  _assertSession() {
    if (!this.currentSession) {
      throw new Error('Voice session does not exist.');
    }
  }

  /**
   * Release future resource ownership placeholders.
   * @returns {void}
   * @private
   */
  _releaseResourcePlaceholders() {
    for (const key of Object.keys(this.resources)) {
      this.resources[key] = null;
    }
  }

  /**
   * Publish a lifecycle event internally.
   * @param {string} eventName Event name.
   * @param {object} payload Event payload.
   * @returns {void}
   * @private
   */
  _publish(eventName, payload) {
    this.events.emit(eventName, Object.freeze({ ...payload, eventName }));
  }

  /**
   * Build a serializable event payload.
   * @param {object|null} sessionSnapshot Optional session snapshot.
   * @param {object} extra Extra event fields.
   * @returns {object}
   * @private
   */
  _buildEventPayload(sessionSnapshot = null, extra = {}) {
    return {
      state: this.currentState,
      session: sessionSnapshot || this.getSession(),
      at: this.clock().toISOString(),
      ...extra
    };
  }

  /**
   * Build a standard success result.
   * @returns {{success: boolean, state: string, session: object|null}}
   * @private
   */
  _result() {
    return {
      success: true,
      state: this.currentState,
      session: this.getSession()
    };
  }

  /**
   * Normalize error metadata without leaking native error objects.
   * @param {Error|string|object} error Error input.
   * @returns {{name: string, message: string, type: string}}
   * @private
   */
  _normalizeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        type: error.type || 'VoiceSessionError'
      };
    }
    if (error && typeof error === 'object') {
      return {
        name: String(error.name || 'VoiceSessionError'),
        message: String(error.message || 'Voice session failed.'),
        type: String(error.type || 'VoiceSessionError')
      };
    }
    return {
      name: 'VoiceSessionError',
      message: String(error || 'Voice session failed.'),
      type: 'VoiceSessionError'
    };
  }

  /**
   * Write a centralized structured Voice log entry.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    this.logger.info(`[Voice] ${message}`, metadata);
  }
}

module.exports = VoiceSessionManager;
