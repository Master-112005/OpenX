'use strict';

const EventEmitter = require('events');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const EVENTS = require('./AudioProcessingEvents');
const {
  VADInitializationFailedError,
  VADProcessingFailedError
} = require('./AudioProcessingErrors');

const VAD_STATES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  SILENCE: 'SILENCE',
  POSSIBLE_SPEECH: 'POSSIBLE_SPEECH',
  SPEECH: 'SPEECH',
  POSSIBLE_END: 'POSSIBLE_END',
  ENDPOINT: 'ENDPOINT'
});

/**
 * Purpose: Detects speech activity from RNNoise-cleaned PCM audio.
 * Responsibility: Classify speech/silence, estimate speech boundaries, and produce endpoint candidates without controlling sessions.
 * Dependencies: ProcessingConfiguration, AudioProcessingEvents, and AudioProcessingErrors.
 * Thread ownership: This detector owns only rolling VAD metadata and does not mutate VoiceSession state.
 * Future integration notes: Model-based VAD can replace the energy estimator behind this API.
 */
class VoiceActivityDetector {
  /**
   * Create a VAD instance.
   * @param {{configuration?: ProcessingConfiguration|object, analyzer?: Function, logger?: object, metrics?: object}} dependencies VAD dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.analyzer = dependencies.analyzer || null;
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.events = new EventEmitter();
    this.initialized = false;
    this.state = VAD_STATES.UNKNOWN;
    this.speechDurationMs = 0;
    this.silenceDurationMs = 0;
    this.metrics = {
      framesAnalyzed: 0,
      speechFrames: 0,
      silenceFrames: 0,
      endpoints: 0
    };
  }

  /**
   * Return supported VAD activity states.
   * @returns {Readonly<Record<string, string>>}
   */
  static get STATES() {
    return VAD_STATES;
  }

  /**
   * Subscribe to VAD events.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {VoiceActivityDetector}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Initialize VAD state.
   * @returns {{initialized: boolean, enabled: boolean}}
   */
  initialize() {
    try {
      this.initialized = true;
      this.events.emit(EVENTS.VAD_INITIALIZED, this.getStatus());
      return { initialized: true, enabled: this.configuration.vadEnabled };
    } catch (error) {
      throw new VADInitializationFailedError('VAD initialization failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Detect activity from cleaned PCM audio.
   * @param {{cleanedPcm?: Buffer, durationMs?: number, sampleRate?: number, getPcmBuffer?: Function}} input Cleaned frame data.
   * @returns {{hasVoice: boolean, confidence: number, state: string, speechStarted: boolean, speechEnded: boolean, endpointCandidate: boolean, silenceDurationMs: number, speechDurationMs: number}}
   */
  detect(input = {}) {
    if (!this.initialized) this.initialize();
    try {
      const pcm = input.cleanedPcm
        ? Buffer.from(input.cleanedPcm)
        : (typeof input.getPcmBuffer === 'function' ? input.getPcmBuffer() : Buffer.from(input.pcm || []));
      const durationMs = Number(input.durationMs) || this.configuration.frameSizeMs;
      const confidence = this.configuration.vadEnabled ? this._estimateConfidence(pcm, input) : 0;
      const previousState = this.state;
      const nextState = this._classify(confidence, durationMs);
      const speechStarted = previousState !== VAD_STATES.SPEECH && nextState === VAD_STATES.SPEECH;
      const speechEnded = [VAD_STATES.SPEECH, VAD_STATES.POSSIBLE_END].includes(previousState)
        && [VAD_STATES.SILENCE, VAD_STATES.ENDPOINT].includes(nextState);
      const endpointCandidate = nextState === VAD_STATES.ENDPOINT;

      this.state = nextState;
      this.metrics.framesAnalyzed += 1;
      if (confidence >= this.configuration.speechThreshold) this.metrics.speechFrames += 1;
      if (confidence <= this.configuration.silenceThreshold) this.metrics.silenceFrames += 1;
      if (endpointCandidate) this.metrics.endpoints += 1;
      this._emitActivityEvents({ speechStarted, speechEnded, endpointCandidate, confidence, state: nextState });
      return {
        hasVoice: [VAD_STATES.POSSIBLE_SPEECH, VAD_STATES.SPEECH].includes(nextState),
        confidence,
        state: nextState,
        speechStarted,
        speechEnded,
        endpointCandidate,
        silenceDurationMs: this.silenceDurationMs,
        speechDurationMs: this.speechDurationMs
      };
    } catch (error) {
      throw new VADProcessingFailedError('VAD processing failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Reset rolling VAD state.
   * @returns {{reset: boolean, state: string}}
   */
  reset() {
    this.state = VAD_STATES.UNKNOWN;
    this.speechDurationMs = 0;
    this.silenceDurationMs = 0;
    return { reset: true, state: this.state };
  }

  /**
   * Return current VAD status.
   * @returns {{initialized: boolean, enabled: boolean, state: string}}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      enabled: this.configuration.vadEnabled,
      state: this.state
    };
  }

  /**
   * Return VAD metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Estimate speech confidence from cleaned PCM.
   * @param {Buffer} pcm Cleaned PCM.
   * @param {object} input Input metadata.
   * @returns {number}
   * @private
   */
  _estimateConfidence(pcm, input) {
    if (typeof this.analyzer === 'function') {
      return this._clamp(Number(this.analyzer(pcm, input, this.configuration)) || 0);
    }
    if (!pcm.length) return 0;
    let sumSquares = 0;
    let samples = 0;
    for (let index = 0; index + 1 < pcm.length; index += 2) {
      const normalized = pcm.readInt16LE(index) / 32768;
      sumSquares += normalized * normalized;
      samples += 1;
    }
    if (!samples) return 0;
    return this._clamp(Math.sqrt(sumSquares / samples));
  }

  /**
   * Classify activity state and update rolling durations.
   * @param {number} confidence Speech confidence.
   * @param {number} durationMs Frame duration.
   * @returns {string}
   * @private
   */
  _classify(confidence, durationMs) {
    if (confidence >= this.configuration.speechThreshold) {
      this.speechDurationMs += durationMs;
      this.silenceDurationMs = 0;
      return this.speechDurationMs >= this.configuration.minimumSpeechDurationMs
        ? VAD_STATES.SPEECH
        : VAD_STATES.POSSIBLE_SPEECH;
    }

    this.silenceDurationMs += durationMs;
    if (this.speechDurationMs > 0 && this.silenceDurationMs >= this.configuration.endpointSilenceDurationMs) {
      this.speechDurationMs = 0;
      return VAD_STATES.ENDPOINT;
    }
    if (this.speechDurationMs > 0 && this.silenceDurationMs >= this.configuration.maximumSilenceDurationMs) {
      return VAD_STATES.POSSIBLE_END;
    }
    if (confidence <= this.configuration.silenceThreshold) {
      return VAD_STATES.SILENCE;
    }
    return this.state === VAD_STATES.SPEECH ? VAD_STATES.POSSIBLE_END : VAD_STATES.SILENCE;
  }

  /**
   * Emit VAD activity events.
   * @param {object} activity Activity metadata.
   * @returns {void}
   * @private
   */
  _emitActivityEvents(activity) {
    if (activity.speechStarted) this.events.emit(EVENTS.SPEECH_STARTED, activity);
    if (activity.speechEnded) this.events.emit(EVENTS.SPEECH_ENDED, activity);
    if (activity.state === VAD_STATES.SILENCE) this.events.emit(EVENTS.SILENCE_DETECTED, activity);
    if (activity.endpointCandidate) this.events.emit(EVENTS.ENDPOINT_DETECTED, activity);
  }

  /**
   * Clamp a confidence score.
   * @param {number} value Candidate confidence.
   * @returns {number}
   * @private
   */
  _clamp(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  /**
   * Normalize error metadata.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error && typeof error.toJSON === 'function') return error.toJSON();
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'VADError', message: String(error || 'VAD failed.') };
  }
}

module.exports = VoiceActivityDetector;
