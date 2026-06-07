const EventEmitter = require('events');

const VOICE_SESSION_STATES = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  RESPONDING: 'RESPONDING',
  PAUSED: 'PAUSED',
  TERMINATED: 'TERMINATED'
});

class VoiceSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.state = VOICE_SESSION_STATES.IDLE;
    this.sessionId = null;
    this.timeout = null;
    this.activeTimeoutMs = 0;
    this.now = options.now || (() => Date.now());
  }

  start(options = {}) {
    if (this.state !== VOICE_SESSION_STATES.IDLE && this.state !== VOICE_SESSION_STATES.TERMINATED) {
      this.touch(options.inactivityTimeoutMs);
      if (this.state !== VOICE_SESSION_STATES.LISTENING) {
        this._transition(VOICE_SESSION_STATES.LISTENING, {
          sessionId: this.sessionId,
          mode: options.mode || 'command',
          continued: true
        });
      }
      return true;
    }

    this.sessionId = `voice-${this.now()}`;
    this._transition(VOICE_SESSION_STATES.LISTENING, {
      sessionId: this.sessionId,
      mode: options.mode || 'command'
    });
    this._armTimeout(options.inactivityTimeoutMs);
    this.emit('sessionStarted', {
      sessionId: this.sessionId,
      mode: options.mode || 'command'
    });
    return true;
  }

  touch(timeoutMs) {
    const duration = Number(timeoutMs) > 0 ? Number(timeoutMs) : this.activeTimeoutMs;
    if (!duration) {
      return false;
    }

    this._armTimeout(duration);
    this.emit('activity', {
      sessionId: this.sessionId,
      timeoutMs: duration
    });
    return true;
  }

  markProcessing(metadata = {}) {
    return this._transition(VOICE_SESSION_STATES.PROCESSING, metadata);
  }

  markResponding(metadata = {}) {
    return this._transition(VOICE_SESSION_STATES.RESPONDING, metadata);
  }

  pause(metadata = {}) {
    return this._transition(VOICE_SESSION_STATES.PAUSED, metadata);
  }

  resume(metadata = {}) {
    return this._transition(VOICE_SESSION_STATES.LISTENING, metadata);
  }

  stop(reason = 'manual-stop') {
    this._clearTimeout();
    const sessionId = this.sessionId;
    this.sessionId = null;
    this._transition(VOICE_SESSION_STATES.IDLE, { reason });
    this.emit('sessionEnded', { sessionId, reason });
    return true;
  }

  terminate(reason = 'terminated') {
    this._clearTimeout();
    const sessionId = this.sessionId;
    this.sessionId = null;
    this._transition(VOICE_SESSION_STATES.TERMINATED, { reason });
    this.emit('sessionEnded', { sessionId, reason });
    return true;
  }

  _transition(nextState, metadata = {}) {
    const previousState = this.state;
    this.state = nextState;
    this.emit('stateChanged', {
      previousState,
      state: nextState,
      sessionId: this.sessionId,
      ...metadata
    });
    return true;
  }

  _armTimeout(timeoutMs) {
    this._clearTimeout();
    const duration = Number(timeoutMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    this.activeTimeoutMs = duration;
    this.timeout = setTimeout(() => {
      this.stop('inactivity-timeout');
      this.emit('timeout', { reason: 'inactivity-timeout', timeoutMs: duration });
    }, duration);
  }

  _clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}

module.exports = {
  VoiceSessionManager,
  VOICE_SESSION_STATES
};
