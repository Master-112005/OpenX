'use strict';

/**
 * Purpose: Tracks the STT decoder lifecycle independently from VoiceSession state.
 * Responsibility: Validate decoder transitions from loading through decoding/finalizing/stopped/error.
 * Dependencies: None.
 * Lifecycle: UNINITIALIZED -> LOADING -> READY -> DECODING -> FINALIZING -> STOPPED, with ERROR recovery.
 * Future extension notes: Runtime-specific decoder states must be mapped to this stable state machine.
 */
class DecoderState {
  /**
   * Return decoder state constants.
   * @returns {Readonly<Record<string, string>>}
   */
  static get STATES() {
    return Object.freeze({
      UNINITIALIZED: 'UNINITIALIZED',
      LOADING: 'LOADING',
      READY: 'READY',
      DECODING: 'DECODING',
      FINALIZING: 'FINALIZING',
      STOPPED: 'STOPPED',
      ERROR: 'ERROR'
    });
  }

  /**
   * Return decoder transition table.
   * @returns {Readonly<Record<string, readonly string[]>>}
   */
  static get TRANSITIONS() {
    const states = DecoderState.STATES;
    return Object.freeze({
      [states.UNINITIALIZED]: Object.freeze([states.LOADING, states.ERROR]),
      [states.LOADING]: Object.freeze([states.READY, states.ERROR]),
      [states.READY]: Object.freeze([states.DECODING, states.STOPPED, states.ERROR]),
      [states.DECODING]: Object.freeze([states.FINALIZING, states.STOPPED, states.ERROR]),
      [states.FINALIZING]: Object.freeze([states.STOPPED, states.ERROR]),
      [states.STOPPED]: Object.freeze([states.READY, states.LOADING, states.ERROR]),
      [states.ERROR]: Object.freeze([states.STOPPED, states.LOADING])
    });
  }

  /**
   * Create a decoder state machine.
   */
  constructor() {
    this.currentState = DecoderState.STATES.UNINITIALIZED;
    this.transitions = [];
  }

  /**
   * Return current decoder state.
   * @returns {string}
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check whether a transition is allowed.
   * @param {string} fromState Current state.
   * @param {string} toState Requested state.
   * @returns {{allowed: boolean, fromState: string, toState: string, reason: string}}
   */
  canTransition(fromState, toState) {
    const allowed = (DecoderState.TRANSITIONS[fromState] || []).includes(toState);
    return {
      allowed,
      fromState,
      toState,
      reason: allowed ? 'Transition allowed.' : `Invalid decoder state transition: ${fromState} -> ${toState}`
    };
  }

  /**
   * Apply a validated decoder transition.
   * @param {string} toState Requested state.
   * @param {string} reason Transition reason.
   * @returns {string}
   */
  transitionTo(toState, reason = '') {
    const result = this.canTransition(this.currentState, toState);
    if (!result.allowed) throw new Error(result.reason);
    const transition = {
      fromState: this.currentState,
      toState,
      reason: String(reason || ''),
      at: new Date().toISOString()
    };
    this.currentState = toState;
    this.transitions.push(transition);
    return this.currentState;
  }

  /**
   * Reset decoder state.
   * @returns {{reset: boolean, state: string}}
   */
  reset() {
    this.currentState = DecoderState.STATES.UNINITIALIZED;
    this.transitions = [];
    return { reset: true, state: this.currentState };
  }

  /**
   * Return decoder metrics.
   * @returns {{state: string, transitionCount: number, transitions: object[]}}
   */
  toJSON() {
    return {
      state: this.currentState,
      transitionCount: this.transitions.length,
      transitions: this.transitions.map(transition => ({ ...transition }))
    };
  }
}

module.exports = DecoderState;
