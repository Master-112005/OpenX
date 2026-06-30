'use strict';

/**
 * Purpose: Defines deterministic Voice session lifecycle states and transitions.
 * Responsibility: Own the state vocabulary and reject illegal lifecycle movement.
 * Lifecycle: Managers begin at IDLE, move forward through initialization/listening/processing/execution, then close back to IDLE.
 * Dependencies: None.
 * Future integration notes: Future audio, STT, UI, and assistant components must request lifecycle changes through VoiceSessionManager.
 */
class VoiceStateMachine {
  /**
   * Return all supported Voice states.
   * @returns {Readonly<Record<string, string>>}
   */
  static get STATES() {
    return Object.freeze({
      IDLE: 'IDLE',
      INITIALIZING: 'INITIALIZING',
      READY: 'READY',
      LISTENING: 'LISTENING',
      PROCESSING: 'PROCESSING',
      EXECUTING: 'EXECUTING',
      SPEAKING: 'SPEAKING',
      FINISHED: 'FINISHED',
      CANCELLED: 'CANCELLED',
      CLOSING: 'CLOSING',
      ERROR: 'ERROR'
    });
  }

  /**
   * Return the deterministic transition table.
   * @returns {Readonly<Record<string, readonly string[]>>}
   */
  static get TRANSITIONS() {
    const states = VoiceStateMachine.STATES;
    return Object.freeze({
      [states.IDLE]: Object.freeze([states.INITIALIZING]),
      [states.INITIALIZING]: Object.freeze([states.READY, states.ERROR]),
      [states.READY]: Object.freeze([states.LISTENING, states.CLOSING]),
      [states.LISTENING]: Object.freeze([states.PROCESSING, states.CANCELLED, states.ERROR]),
      [states.PROCESSING]: Object.freeze([states.EXECUTING, states.LISTENING, states.ERROR]),
      [states.EXECUTING]: Object.freeze([states.SPEAKING, states.LISTENING, states.FINISHED, states.ERROR]),
      [states.SPEAKING]: Object.freeze([states.LISTENING, states.CANCELLED, states.ERROR]),
      [states.FINISHED]: Object.freeze([states.CLOSING]),
      [states.CANCELLED]: Object.freeze([states.CLOSING]),
      [states.CLOSING]: Object.freeze([states.IDLE]),
      [states.ERROR]: Object.freeze([states.CLOSING])
    });
  }

  /**
   * Return the initial state for a new manager or session.
   * @returns {string}
   */
  getInitialState() {
    return VoiceStateMachine.STATES.IDLE;
  }

  /**
   * Check whether a state is part of the Voice lifecycle vocabulary.
   * @param {string} state Candidate lifecycle state.
   * @returns {boolean}
   */
  isKnownState(state) {
    return Object.prototype.hasOwnProperty.call(VoiceStateMachine.TRANSITIONS, state);
  }

  /**
   * Return allowed next states for a lifecycle state.
   * @param {string} state Current lifecycle state.
   * @returns {readonly string[]}
   */
  getAllowedTransitions(state) {
    return VoiceStateMachine.TRANSITIONS[state] || Object.freeze([]);
  }

  /**
   * Validate a requested lifecycle transition.
   * @param {string} fromState Current state.
   * @param {string} toState Requested future state.
   * @returns {{allowed: boolean, fromState: string, toState: string, reason: string}}
   */
  canTransition(fromState, toState) {
    if (!this.isKnownState(fromState)) {
      return {
        allowed: false,
        fromState,
        toState,
        reason: `Unknown source state: ${fromState}`
      };
    }

    if (!this.isKnownState(toState)) {
      return {
        allowed: false,
        fromState,
        toState,
        reason: `Unknown target state: ${toState}`
      };
    }

    const allowed = this.getAllowedTransitions(fromState).includes(toState);
    return {
      allowed,
      fromState,
      toState,
      reason: allowed ? 'Transition allowed.' : `Invalid Voice state transition: ${fromState} -> ${toState}`
    };
  }

  /**
   * Validate a transition and throw when it is not allowed.
   * @param {string} fromState Current state.
   * @param {string} toState Requested future state.
   * @returns {{allowed: boolean, fromState: string, toState: string, reason: string}}
   */
  assertTransition(fromState, toState) {
    const result = this.canTransition(fromState, toState);
    if (!result.allowed) {
      throw new Error(result.reason);
    }
    return result;
  }
}

module.exports = VoiceStateMachine;
