const EventEmitter = require('events');
const { EVENTS } = require('../../shared/events');

const SPEECH_STATES = Object.freeze({
  IDLE: 'IDLE',
  WAKE_DETECTED: 'WAKE_DETECTED',
  LISTENING: 'LISTENING',
  HEARING_SPEECH: 'HEARING_SPEECH',
  PROCESSING: 'PROCESSING',
  RESPONDING: 'RESPONDING',
  ERROR: 'ERROR'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [SPEECH_STATES.IDLE]: new Set([
    SPEECH_STATES.WAKE_DETECTED,
    SPEECH_STATES.LISTENING,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.WAKE_DETECTED]: new Set([
    SPEECH_STATES.RESPONDING,
    SPEECH_STATES.LISTENING,
    SPEECH_STATES.PROCESSING,
    SPEECH_STATES.IDLE,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.LISTENING]: new Set([
    SPEECH_STATES.HEARING_SPEECH,
    SPEECH_STATES.PROCESSING,
    SPEECH_STATES.IDLE,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.HEARING_SPEECH]: new Set([
    SPEECH_STATES.PROCESSING,
    SPEECH_STATES.IDLE,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.PROCESSING]: new Set([
    SPEECH_STATES.RESPONDING,
    SPEECH_STATES.IDLE,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.RESPONDING]: new Set([
    SPEECH_STATES.IDLE,
    SPEECH_STATES.LISTENING,
    SPEECH_STATES.ERROR
  ]),
  [SPEECH_STATES.ERROR]: new Set([
    SPEECH_STATES.IDLE,
    SPEECH_STATES.LISTENING
  ])
});

class SpeechStateMachine extends EventEmitter {
  constructor(eventBus, initialState = SPEECH_STATES.IDLE) {
    super();
    this.eventBus = eventBus || null;
    this.currentState = initialState;
  }

  getState() {
    return this.currentState;
  }

  is(state) {
    return this.currentState === state;
  }

  transition(nextState, metadata = {}) {
    if (!nextState || nextState === this.currentState) {
      return {
        changed: false,
        previousState: this.currentState,
        currentState: this.currentState,
        metadata
      };
    }

    const allowed = ALLOWED_TRANSITIONS[this.currentState];
    if (!allowed || !allowed.has(nextState)) {
      const error = new Error(`Invalid speech state transition: ${this.currentState} -> ${nextState}`);
      error.code = 'INVALID_SPEECH_STATE_TRANSITION';
      throw error;
    }

    const previousState = this.currentState;
    this.currentState = nextState;
    const detail = {
      previousState,
      currentState: nextState,
      metadata
    };

    this.emit('transition', detail);
    if (this.eventBus?.publish) {
      this.eventBus.publish(EVENTS.VOICE_STATE_CHANGED, detail);
    }

    return {
      changed: true,
      ...detail
    };
  }

  reset(metadata = {}) {
    if (this.currentState === SPEECH_STATES.IDLE) {
      return {
        changed: false,
        previousState: SPEECH_STATES.IDLE,
        currentState: SPEECH_STATES.IDLE,
        metadata
      };
    }

    return this.transition(SPEECH_STATES.IDLE, metadata);
  }
}

module.exports = {
  SPEECH_STATES,
  SpeechStateMachine
};
