'use strict';

const path = require('path');
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
    this.sherpa = dependencies.sherpa || null;
    this.logger = dependencies.logger || null;
    this.initialized = false;
    this.recognizer = null;
    this.stream = null;
    this.configuration = null;
    this.model = null;
    this.sampleRate = 16000;
    this.sampleChunks = [];
    this.totalSamples = 0;
    this.lastPartialText = '';
    this.lastDecodeAt = 0;
    this.framesAccepted = 0;
  }

  /**
   * Return runtime availability metadata.
   * @returns {{available: boolean, runtime: string, reason: string}}
   */
  getAvailability() {
    const hasNativeRuntime = this.adapter || this.sherpa || SherpaRuntime._canLoadNativeSherpa();
    return {
      available: Boolean(hasNativeRuntime),
      runtime: 'sherpa-onnx',
      reason: this.adapter
        ? 'Injected Sherpa adapter is available.'
        : (hasNativeRuntime ? 'Native sherpa-onnx-node runtime is available.' : 'sherpa-onnx-node runtime is not available.')
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
      this.model = options.model || null;
      this.configuration = options.configuration || null;
      this.sampleRate = Number(this.configuration?.sampleRate) || 16000;
      if (!this.adapter) {
        this.sherpa = this.sherpa || SherpaRuntime._loadNativeSherpa();
      }
      this.initialized = true;
      this._log('Runtime Initialized', {
        runtime: 'sherpa-onnx',
        mode: this.adapter ? 'adapter' : 'native-offline'
      });
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
      if (this.adapter && typeof this.adapter.createRecognizer === 'function') {
        this.recognizer = this.adapter.createRecognizer(options);
      } else {
        this.model = options.model || this.model;
        this.configuration = options.configuration || this.configuration;
        const recognizerConfig = this._buildOfflineRecognizerConfig(this.model, this.configuration);
        this.recognizer = new this.sherpa.OfflineRecognizer(recognizerConfig);
      }
      this._log('Recognizer Created', {
        runtime: 'sherpa-onnx',
        mode: this.adapter ? 'adapter' : 'native-offline',
        modelPath: this.model?.path || this.configuration?.modelPath || ''
      });
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
    } else {
      this.stream = null;
      this.sampleChunks = [];
      this.totalSamples = 0;
      this.lastPartialText = '';
      this.lastDecodeAt = 0;
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
      } else {
        const samples = this._samplesFromProcessedFrame(processedFrame);
        if (samples.length) this._appendSamples(samples);
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
      return this._decodeNativePartial(processedFrame);
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
      return this._decodeNativeFinal();
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
    this.stream = null;
    this.initialized = false;
    this.sampleChunks = [];
    this.totalSamples = 0;
    this.lastPartialText = '';
    this.lastDecodeAt = 0;
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
      framesAccepted: this.framesAccepted,
      samplesBuffered: this.totalSamples,
      mode: this.adapter ? 'adapter' : 'native-offline'
    };
  }

  /**
   * Create the native offline recognizer configuration for local Parakeet transducer files.
   * @param {object} model Loaded model metadata.
   * @param {object} configuration STT configuration.
   * @returns {object}
   * @private
   */
  _buildOfflineRecognizerConfig(model = {}, configuration = {}) {
    const modelPath = path.resolve(model?.path || configuration?.modelPath || '');
    const provider = configuration?.gpuEnabled ? 'cuda' : 'cpu';
    return {
      featConfig: {
        sampleRate: Number(configuration?.sampleRate) || 16000,
        featureDim: 80
      },
      modelConfig: {
        transducer: {
          encoder: path.join(modelPath, 'encoder.int8.onnx'),
          decoder: path.join(modelPath, 'decoder.int8.onnx'),
          joiner: path.join(modelPath, 'joiner.int8.onnx')
        },
        tokens: path.join(modelPath, 'tokens.txt'),
        numThreads: Math.max(1, Number(configuration?.numThreads) || 2),
        debug: configuration?.loggingEnabled ? 0 : 0,
        provider
      }
    };
  }

  /**
   * Convert little-endian PCM16 frame bytes to mono Float32 samples.
   * @param {object} processedFrame ProcessedAudioFrame.
   * @returns {Float32Array}
   * @private
   */
  _samplesFromProcessedFrame(processedFrame) {
    const pcm = processedFrame && typeof processedFrame.getPcmBuffer === 'function'
      ? processedFrame.getPcmBuffer()
      : Buffer.alloc(0);
    const channels = Math.max(1, Number(processedFrame?.channels) || Number(processedFrame?.originalFrame?.channels) || 1);
    const sampleCount = Math.floor(pcm.length / 2 / channels);
    const samples = new Float32Array(sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const offset = ((sampleIndex * channels) + channel) * 2;
        if (offset + 1 >= pcm.length) continue;
        sum += pcm.readInt16LE(offset) / 32768;
      }
      samples[sampleIndex] = sum / channels;
    }
    return samples;
  }

  /**
   * Append samples while bounding utterance memory.
   * @param {Float32Array} samples Samples to append.
   * @returns {void}
   * @private
   */
  _appendSamples(samples) {
    const copy = new Float32Array(samples);
    this.sampleChunks.push(copy);
    this.totalSamples += copy.length;
    const maxSamples = this.sampleRate * 30;
    while (this.totalSamples > maxSamples && this.sampleChunks.length > 1) {
      const removed = this.sampleChunks.shift();
      this.totalSamples -= removed.length;
    }
  }

  /**
   * Return accumulated samples as one contiguous Float32Array.
   * @returns {Float32Array}
   * @private
   */
  _combinedSamples() {
    const combined = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const chunk of this.sampleChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }

  /**
   * Decode accumulated audio through the native offline recognizer.
   * @returns {object}
   * @private
   */
  _decodeNativeResult() {
    if (!this.recognizer || this.totalSamples === 0) {
      return { text: '', confidence: 0, tokens: [] };
    }
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({
      samples: this._combinedSamples(),
      sampleRate: this.sampleRate
    });
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream) || {};
    return {
      ...result,
      text: String(result.text || '').trim(),
      confidence: this._confidenceFromResult(result)
    };
  }

  /**
   * Produce a partial hypothesis only when the native decoder finds real text.
   * @param {object} processedFrame Processed frame.
   * @returns {object}
   * @private
   */
  _decodeNativePartial(processedFrame) {
    const now = Date.now();
    const intervalMs = Math.max(500, Number(this.configuration?.partialResultIntervalMs) || 700);
    if (now - this.lastDecodeAt < intervalMs && !processedFrame?.endpointCandidate) {
      return {
        text: '',
        confidence: 0,
        final: false,
        segmentId: `partial-${processedFrame?.originalFrame?.frameIndex ?? this.framesAccepted}`
      };
    }
    this.lastDecodeAt = now;
    const result = this._decodeNativeResult();
    if (!result.text || result.text === this.lastPartialText) {
      return {
        text: '',
        confidence: result.confidence || 0,
        final: false,
        segmentId: `partial-${processedFrame?.originalFrame?.frameIndex ?? this.framesAccepted}`
      };
    }
    this.lastPartialText = result.text;
    return {
      text: result.text,
      confidence: result.confidence || 0.8,
      final: false,
      segmentId: `partial-${processedFrame?.originalFrame?.frameIndex ?? this.framesAccepted}`,
      frameIndex: processedFrame?.originalFrame?.frameIndex
    };
  }

  /**
   * Finalize the native offline decode.
   * @returns {object}
   * @private
   */
  _decodeNativeFinal() {
    const result = this._decodeNativeResult();
    return {
      text: result.text,
      confidence: result.text ? (result.confidence || 0.8) : 0,
      final: true,
      segmentId: 'final-0'
    };
  }

  /**
   * Derive a bounded confidence value from native result metadata.
   * @param {object} result Native recognizer result.
   * @returns {number}
   * @private
   */
  _confidenceFromResult(result = {}) {
    const scores = Array.isArray(result.ys_log_probs) ? result.ys_log_probs : [];
    if (!scores.length) return result.text ? 0.8 : 0;
    const average = scores.reduce((sum, score) => sum + Number(score || 0), 0) / scores.length;
    return Math.max(0, Math.min(1, Math.exp(average)));
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

  /**
   * Load native sherpa package.
   * @returns {object}
   * @private
   */
  static _loadNativeSherpa() {
    return require('sherpa-onnx-node');
  }

  /**
   * Check native sherpa package availability.
   * @returns {boolean}
   * @private
   */
  static _canLoadNativeSherpa() {
    try {
      SherpaRuntime._loadNativeSherpa();
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = SherpaRuntime;
