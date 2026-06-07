const EventEmitter = require('events');

const EVENTS = Object.freeze({
  COMMAND_RECEIVED: 'command.received',
  VOICE_ACTIVATED: 'voice.activated',
  LISTENER_STARTED: 'listener.started',
  LISTENER_STOPPED: 'listener.stopped',
  SPEECH_DETECTED: 'speech.detected',
  UTTERANCE_FINALIZED: 'utterance.finalized',
  STT_COMPLETED: 'stt.completed',
  INTENT_DETECTED: 'intent.detected',
  COMMAND_EXECUTED: 'command.executed',
  RESPONSE_GENERATED: 'response.generated',
  RESPONSE_STARTED: 'response.started',
  RESPONSE_COMPLETED: 'response.completed',
  UI_STATE_CHANGED: 'ui.state.changed',
  VOICE_STATE_CHANGED: 'voice.state.changed',
  VOICE_SESSION_STARTED: 'voice.sessionStarted',
  VOICE_SESSION_ENDED: 'voice.sessionEnded',
  VOICE_PARTIAL_TRANSCRIPT: 'voice.partialTranscript',
  VOICE_FINAL_TRANSCRIPT: 'voice.finalTranscript',
  VOICE_PROCESSING_STARTED: 'voice.processingStarted',
  VOICE_PROCESSING_FINISHED: 'voice.processingFinished',
  VOICE_ERROR: 'voice.error'
});

class AssistantEventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyLimit = Number(options.historyLimit) > 0 ? Number(options.historyLimit) : 250;
    this.history = [];
  }

  publish(event, payload = {}) {
    const envelope = {
      event,
      payload,
      timestamp: new Date().toISOString()
    };

    this.history.push(envelope);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    this.emit(event, envelope);
    this.emit('*', envelope);
    return envelope;
  }

  subscribe(event, handler) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  getRecentEvents(limit = 50) {
    if (limit <= 0) {
      return [];
    }

    return this.history.slice(-limit);
  }
}

module.exports = {
  AssistantEventBus,
  EVENTS
};
