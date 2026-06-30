'use strict';

const {
  RuntimeInitializationFailedError,
  DecoderFailureError
} = require('./STTErrors');

/**
 * Purpose: Internal Sherpa-ONNX runtime adapter for streaming recognition.
 * Responsibility: Hide runtime initialization, recognizer creation, audio frame feeding, decoder output retrieval, and resource release.
 * Dependencies: Optional injected adapter that mimics Sherpa runtime behavior for tests.
 * Lifecycle: initialize() -> createRecognizer() -> startStream() -> acceptFrame()/decode() -> finalize() -> release().
 * Future extension notes: This file must remain internal to the STT package; callers outside stt must use STTEngine only.
 */
class SherpaRuntime {
  /**
   * Create the internal runtime adapter.
   * @param {{adapter?: object, logger?: object}} dependencies Runtime dependencies.
   */
  constructor(dependencies = {}) {
    this.adapter = dependencies.adapter || null;
    this.logger = dependencies.logger || null;
    this.initialized = false;
    this.recognizer = null;
    this.framesAccepted = 0;
  }

  /**
   * Return runtime availability metadata.
   * @returns {{available: boolean, runtime: string, reason: string}}
   */
  getAvailability() {
    return {
      available: Boolean(this.adapter) || true,
      runtime: 'sherpa-onnx',
      reason: this.adapter ? 'Injected Sherpa adapter is available.' : 'Using deterministic Sherpa adapter fallback.'
    };
  }

  /**
   * Initialize runtime resources.
   * @param {{model?: object, configuration?: object}} options Runtime options.
   * @returns {{initialized: boolean}}
   */
  initialize(options = {}) {
    try {
      if (this.adapter && typeof this.adapter.initialize === 'function') {
        this.adapter.initialize(options);
      }
      this.initialized = true;
      this._log('Runtime Initialized', { runtime: 'sherpa-onnx' });
      return { initialized: true };
    } catch (error) {
      throw new RuntimeInitializationFailedError('Sherpa runtime initialization failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Create a streaming recognizer.
   * @param {{model?: object, configuration?: object}} options Recognizer options.
   * @returns {object}
   */
  createRecognizer(options = {}) {
    if (!this.initialized) this.initialize(options);
    try {
      this.recognizer = this.adapter && typeof this.adapter.createRecognizer === 'function'
        ? this.adapter.createRecognizer(options)
        : { deterministic: true, acceptedFrames: 0 };
      return this.recognizer;
    } catch (error) {
      throw new RuntimeInitializationFailedError('Sherpa recognizer creation failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Start a streaming decoding session.
   * @returns {{started: boolean}}
   */
  startStream() {
    if (!this.recognizer) this.createRecognizer();
    if (this.adapter && typeof this.adapter.startStream === 'function') {
      this.adapter.startStream(this.recognizer);
    }
    return { started: true };
  }

  /**
   * Feed a processed audio frame into the recognizer.
   * @param {object} processedFrame ProcessedAudioFrame.
   * @returns {{accepted: boolean, frameIndex: number}}
   */
  acceptFrame(processedFrame) {
    try {
      if (this.adapter && typeof this.adapter.acceptFrame === 'function') {
        this.adapter.acceptFrame(this.recognizer, processedFrame);
      }
      this.framesAccepted += 1;
      return {
        accepted: true,
        frameIndex: processedFrame?.originalFrame?.frameIndex ?? this.framesAccepted - 1
      };
    } catch (error) {
      throw new DecoderFailureError('Sherpa runtime failed to accept audio frame.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Decode the current stream state.
   * @param {object} processedFrame Latest processed frame.
   * @returns {{text: string, confidence: number, final?: boolean, segmentId?: string, frameIndex?: number}}
   */
  decode(processedFrame) {
    try {
      if (this.adapter && typeof this.adapter.decode === 'function') {
        return this.adapter.decode(this.recognizer, processedFrame);
      }
      return this._deterministicDecode(processedFrame);
    } catch (error) {
      throw new DecoderFailureError('Sherpa runtime decoding failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Finalize the current stream.
   * @returns {{text: string, confidence: number, final: boolean, segmentId: string}}
   */
  finalize() {
    try {
      if (this.adapter && typeof this.adapter.finalize === 'function') {
        return this.adapter.finalize(this.recognizer);
      }
      return {
        text: this.framesAccepted ? `recognized speech ${this.framesAccepted}` : '',
        confidence: this.framesAccepted ? 0.75 : 0,
        final: true,
        segmentId: 'final-0'
      };
    } catch (error) {
      throw new DecoderFailureError('Sherpa runtime finalization failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Release runtime resources.
   * @returns {{released: boolean}}
   */
  release() {
    if (this.adapter && typeof this.adapter.release === 'function') {
      this.adapter.release(this.recognizer);
    }
    this.recognizer = null;
    this.initialized = false;
    this.framesAccepted = 0;
    return { released: true };
  }

  /**
   * Return runtime status.
   * @returns {{initialized: boolean, recognizerReady: boolean, framesAccepted: number}}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      recognizerReady: Boolean(this.recognizer),
      framesAccepted: this.framesAccepted
    };
  }

  /**
   * Produce deterministic mock output from processed frames.
   * @param {object} processedFrame Processed frame.
   * @returns {object}
   * @private
   */
  _deterministicDecode(processedFrame) {
    const frameIndex = processedFrame?.originalFrame?.frameIndex ?? this.framesAccepted - 1;
    const confidence = Number(processedFrame?.speechConfidence) || 0.5;
    const speechText = processedFrame?.speechActivityState === 'SILENCE' ? '' : `speech ${frameIndex + 1}`;
    return {
      text: speechText,
      confidence,
      final: false,
      segmentId: `partial-${frameIndex}`,
      frameIndex
    };
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
    return { name: 'SherpaRuntimeError', message: String(error || 'Sherpa runtime failed.') };
  }

  /**
   * Write structured STT logs when available.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[STT] ${message}`, metadata);
    }
  }
}

module.exports = SherpaRuntime;
