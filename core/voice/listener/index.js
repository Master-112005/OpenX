const EventEmitter = require('events');
const { IdGenerator } = require('../../shared/index');
const { EVENTS } = require('../../shared/events');
const AudioBufferManager = require('../buffering/index');
const VoiceActivityDetector = require('../vad/index');

class ActiveListener extends EventEmitter {
  constructor(config = {}, options = {}) {
    super();
    this.eventBus = options.eventBus || null;
    this.buffer = new AudioBufferManager({
      frameDurationMs: config?.voice?.frameDurationMs || 20,
      preRollDurationMs: config?.voice?.preRollDurationMs || 400,
      maxUtteranceMs: config?.voice?.stt?.maxDurationMs || config?.voice?.maxUtteranceMs || 12000
    });
    this.vad = options.vad || new VoiceActivityDetector({
      threshold: config?.voice?.stt?.energyThreshold || config?.voice?.vadThreshold || 0.015
    });
    this.silenceTimeoutMs = Number(config?.voice?.silenceTimeout || config?.voice?.stt?.silenceTimeoutMs || 1200);
    this.maxUtteranceMs = Number(config?.voice?.stt?.maxDurationMs || config?.voice?.maxUtteranceMs || 12000);
    this.isActive = false;
    this.isCapturingSpeech = false;
    this.currentSession = null;
    this.lastSpeechAt = 0;
  }

  startSession(metadata = {}) {
    if (this.isActive) {
      return this.currentSession;
    }

    this.isActive = true;
    this.isCapturingSpeech = false;
    this.currentSession = {
      id: IdGenerator.generate(),
      startedAt: new Date().toISOString(),
      metadata
    };

    this._publish(EVENTS.LISTENER_STARTED, {
      sessionId: this.currentSession.id,
      ...metadata
    });
    this.emit('started', this.currentSession);
    return this.currentSession;
  }

  stopSession(reason = 'manual-stop') {
    if (!this.isActive && !this.currentSession) {
      return null;
    }

    const session = this.currentSession;
    this.isActive = false;
    this.isCapturingSpeech = false;
    this.currentSession = null;
    this.buffer.reset();

    this._publish(EVENTS.LISTENER_STOPPED, {
      sessionId: session?.id || null,
      reason
    });
    this.emit('stopped', { sessionId: session?.id || null, reason });
    return session;
  }

  ingestFrame(frame = {}) {
    if (!this.isActive) {
      return null;
    }

    this.buffer.append(frame.samples || frame.buffer || frame.data || frame);
    const decision = this.vad.evaluate(frame);
    const now = Date.now();

    if (decision.speechDetected) {
      this.noteSpeechDetected({
        rms: decision.rms,
        source: 'vad'
      });
      this.lastSpeechAt = now;

      if (this.buffer.getActiveDurationMs() >= this.maxUtteranceMs) {
        return this.finalizeUtterance({ reason: 'max-duration' });
      }

      return null;
    }

    if (
      this.isCapturingSpeech &&
      this.lastSpeechAt > 0 &&
      now - this.lastSpeechAt >= this.silenceTimeoutMs
    ) {
      return this.finalizeUtterance({ reason: 'silence-timeout' });
    }

    return null;
  }

  noteSpeechDetected(metadata = {}) {
    if (!this.isActive) {
      return null;
    }

    if (!this.isCapturingSpeech) {
      this.buffer.startUtterance();
      this.isCapturingSpeech = true;
      this._publish(EVENTS.SPEECH_DETECTED, {
        sessionId: this.currentSession?.id || null,
        ...metadata
      });
      this.emit('hearingSpeech', {
        sessionId: this.currentSession?.id || null,
        ...metadata
      });
    }

    this.lastSpeechAt = Date.now();
    return {
      sessionId: this.currentSession?.id || null,
      ...metadata
    };
  }

  finalizeUtterance(metadata = {}) {
    if (!this.currentSession) {
      return null;
    }

    if (!this.isCapturingSpeech) {
      this.buffer.startUtterance();
    }

    const utteranceBuffer = this.buffer.finalizeUtterance();
    this.isCapturingSpeech = false;

    const utterance = {
      id: IdGenerator.generate(),
      sessionId: this.currentSession.id,
      startedAt: this.currentSession.startedAt,
      finalizedAt: new Date().toISOString(),
      durationMs: utteranceBuffer.durationMs,
      frameCount: utteranceBuffer.frames.length,
      text: metadata.text || '',
      confidence: metadata.confidence ?? null,
      reason: metadata.reason || 'manual',
      backend: metadata.backend || null
    };

    this._publish(EVENTS.UTTERANCE_FINALIZED, utterance);
    this.emit('utterance', utterance);
    return utterance;
  }

  _publish(event, payload) {
    if (this.eventBus?.publish) {
      this.eventBus.publish(event, payload);
    }
  }
}

module.exports = ActiveListener;
