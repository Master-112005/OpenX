const EventEmitter = require('events');

const SIGNAL_EVENTS = Object.freeze({
  ACTIVE_WINDOW_CHANGED: 'active-window-changed',
  PROCESS_STARTED: 'process-started',
  PROCESS_STOPPED: 'process-stopped',
  MICROPHONE_ACTIVITY_CHANGED: 'microphone-activity-changed',
  MODE_ENTERED: 'mode-entered',
  MODE_EXITED: 'mode-exited',
  MODE_CHANGED: 'mode-changed'
});

class EnvironmentSignals {
  constructor() {
    this.emitter = new EventEmitter();
  }

  emit(event, payload = {}) {
    const envelope = {
      event,
      payload,
      timestamp: Date.now()
    };

    this.emitter.emit(event, envelope);
    this.emitter.emit('*', envelope);
    return envelope;
  }

  subscribe(event, callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.emitter.on(event, callback);
    return () => this.emitter.off(event, callback);
  }

  removeAllListeners() {
    this.emitter.removeAllListeners();
  }
}

const signals = new EnvironmentSignals();

module.exports = {
  SIGNAL_EVENTS,
  EnvironmentSignals,
  emit: signals.emit.bind(signals),
  subscribe: signals.subscribe.bind(signals),
  removeAllListeners: signals.removeAllListeners.bind(signals),
  signals
};
