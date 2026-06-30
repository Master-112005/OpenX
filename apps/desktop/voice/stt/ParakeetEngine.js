'use strict';

const EventEmitter = require('events');
const STTConfiguration = require('./STTConfiguration');
const DecoderState = require('./DecoderState');
const SherpaRuntime = require('./SherpaRuntime');
const ModelManager = require('./ModelManager');
const ModelLoader = require('./ModelLoader');
const TranscriptAssembler = require('./TranscriptAssembler');
const STT_EVENTS = require('./STTEvents');
const {
  STTInvalidAudioFrameError,
  StreamingFailureError,
  RecognitionFailedError
} = require('./STTErrors');

/**
 * Purpose: Implements the default NVIDIA Parakeet TDT v3 recognition strategy.
 * Responsibility: Initialize model/runtime, receive ProcessedAudioFrame objects, stream decoder hypotheses, and produce transcript results.
 * Dependencies: STTConfiguration, DecoderState, internal SherpaRuntime, ModelManager, ModelLoader, TranscriptAssembler, events, and errors.
 * Lifecycle: initialize() -> start() -> partial(processedFrame)* -> final() -> stop()/destroy().
 * Future extension notes: This class must not expose Sherpa APIs; future model engines should implement the same strategy surface.
 */
class ParakeetEngine {
  /**
   * Create a Parakeet engine strategy.
   * @param {{configuration?: STTConfiguration|object, runtime?: SherpaRuntime, modelManager?: ModelManager, modelLoader?: ModelLoader, assembler?: TranscriptAssembler, decoderState?: DecoderState, logger?: object, metrics?: object, clock?: () => Date}} dependencies Engine dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof STTConfiguration
      ? dependencies.configuration
      : new STTConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.runtime = dependencies.runtime || new SherpaRuntime({ logger: this.logger });
    this.modelManager = dependencies.modelManager || new ModelManager({ configuration: this.configuration });
    this.modelLoader = dependencies.modelLoader || new ModelLoader({
      configuration: this.configuration,
      modelManager: this.modelManager,
      runtime: this.runtime,
      logger: this.logger
    });
    this.assembler = dependencies.assembler || new TranscriptAssembler();
    this.decoderState = dependencies.decoderState || new DecoderState();
    this.events = new EventEmitter();
    this.running = false;
    this.startedAt = null;
    this.loadedModel = null;
    this.metrics = {
      initializationTimeMs: 0,
      modelLoadTimeMs: 0,
      recognitionDurationMs: 0,
      framesProcessed: 0,
      partialResultsProduced: 0,
      finalResultsProduced: 0,
      averageInferenceLatencyMs: 0,
      recognitionFailures: 0,
      cancellationCount: 0
    };
  }

  /**
   * Subscribe to STT events.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {ParakeetEngine}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Initialize Parakeet model and Sherpa runtime behind the strategy.
   * @returns {{initialized: boolean, engine: string, model: object}}
   */
  initialize() {
    const startedAt = this.clock();
    this.decoderState.transitionTo(DecoderState.STATES.LOADING, 'initialize');
    this.events.emit(STT_EVENTS.MODEL_LOADING, { engine: 'parakeet', modelPath: this.configuration.modelPath });
    const modelLoadStartedAt = this.clock();
    this.loadedModel = this.modelLoader.load();
    this.metrics.modelLoadTimeMs += Math.max(0, this.clock().getTime() - modelLoadStartedAt.getTime());
    this.runtime.createRecognizer({ model: this.loadedModel, configuration: this.configuration });
    this.decoderState.transitionTo(DecoderState.STATES.READY, 'model-ready');
    this.metrics.initializationTimeMs += Math.max(0, this.clock().getTime() - startedAt.getTime());
    const payload = { initialized: true, engine: 'parakeet', model: { ...this.loadedModel } };
    this.events.emit(STT_EVENTS.MODEL_READY, payload);
    this._log('Model Ready', payload);
    return payload;
  }

  /**
   * Start streaming recognition.
   * @returns {{started: boolean, state: string}}
   */
  start() {
    if (this.running) throw new StreamingFailureError('STT decoding is already running.');
    if (this.decoderState.getState() === DecoderState.STATES.UNINITIALIZED) this.initialize();
    if (this.decoderState.getState() === DecoderState.STATES.STOPPED) {
      this.decoderState.transitionTo(DecoderState.STATES.READY, 'restart');
    }
    this.decoderState.transitionTo(DecoderState.STATES.DECODING, 'start');
    this.runtime.startStream();
    this.assembler.reset();
    this.assembler.start(this.clock());
    this.running = true;
    this.startedAt = this.clock();
    this.events.emit(STT_EVENTS.DECODING_STARTED, { state: this.decoderState.getState() });
    return { started: true, state: this.decoderState.getState() };
  }

  /**
   * Stop streaming recognition without finalizing a transcript.
   * @returns {{stopped: boolean, state: string}}
   */
  stop() {
    if (!this.running && this.decoderState.getState() === DecoderState.STATES.STOPPED) {
      return { stopped: false, state: this.decoderState.getState() };
    }
    if (this.running) this._updateRecognitionDuration();
    this.running = false;
    const state = this.decoderState.getState();
    if (state === DecoderState.STATES.DECODING) {
      this.decoderState.transitionTo(DecoderState.STATES.STOPPED, 'stop');
    } else if (state === DecoderState.STATES.FINALIZING) {
      this.decoderState.transitionTo(DecoderState.STATES.STOPPED, 'final-stop');
    }
    this.events.emit(STT_EVENTS.DECODING_STOPPED, { state: this.decoderState.getState() });
    return { stopped: true, state: this.decoderState.getState() };
  }

  /**
   * Cancel streaming recognition.
   * @returns {{cancelled: boolean, state: string}}
   */
  cancel() {
    this.metrics.cancellationCount += 1;
    this.running = false;
    const state = this.decoderState.getState();
    if (state === DecoderState.STATES.DECODING || state === DecoderState.STATES.FINALIZING) {
      this.decoderState.transitionTo(DecoderState.STATES.STOPPED, 'cancel');
    }
    this.assembler.reset();
    this.events.emit(STT_EVENTS.STT_CANCELLED, { state: this.decoderState.getState() });
    return { cancelled: true, state: this.decoderState.getState() };
  }

  /**
   * Feed one processed frame and return the latest partial transcript.
   * @param {import('../preprocessing/ProcessedAudioFrame')} processedFrame Processed audio frame.
   * @returns {import('./TranscriptResult')}
   */
  partial(processedFrame) {
    if (!this.running) this.start();
    this._assertProcessedFrame(processedFrame);
    const startedAt = this.clock();
    try {
      this.runtime.acceptFrame(processedFrame);
      const hypothesis = this.runtime.decode(processedFrame);
      const result = this.assembler.addPartial(hypothesis);
      const latencyMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
      this._recordInference(latencyMs, false);
      this.events.emit(STT_EVENTS.PARTIAL_RESULT, { result, transcript: result.toJSON() });
      return result;
    } catch (error) {
      this.metrics.recognitionFailures += 1;
      throw new RecognitionFailedError('Parakeet partial recognition failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Finalize and return the final transcript result.
   * @returns {import('./TranscriptResult')}
   */
  final() {
    if (this.decoderState.getState() === DecoderState.STATES.DECODING) {
      this.decoderState.transitionTo(DecoderState.STATES.FINALIZING, 'final');
    }
    try {
      const hypothesis = this.runtime.finalize();
      if (hypothesis && hypothesis.text) this.assembler.addFinal(hypothesis);
      const result = this.assembler.getFinalResult();
      this.metrics.finalResultsProduced += 1;
      this.stop();
      this.events.emit(STT_EVENTS.FINAL_RESULT, { result, transcript: result.toJSON() });
      return result;
    } catch (error) {
      this.metrics.recognitionFailures += 1;
      throw new RecognitionFailedError('Parakeet final recognition failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Reset decoder and transcript state.
   * @returns {{reset: boolean, state: string}}
   */
  reset() {
    this.running = false;
    this.startedAt = null;
    this.assembler.reset();
    this.decoderState.reset();
    this.events.emit(STT_EVENTS.STT_RESET, { state: this.decoderState.getState() });
    return { reset: true, state: this.decoderState.getState() };
  }

  /**
   * Destroy model/runtime resources.
   * @returns {{destroyed: boolean}}
   */
  destroy() {
    this.cancel();
    this.modelLoader.unload();
    this.events.emit(STT_EVENTS.MODEL_UNLOADED, { engine: 'parakeet' });
    return { destroyed: true };
  }

  /**
   * Return whether streaming recognition is active.
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Return recognition status.
   * @returns {object}
   */
  getStatus() {
    return {
      engine: 'parakeet',
      running: this.running,
      decoder: this.decoderState.toJSON(),
      model: this.loadedModel ? { ...this.loadedModel } : null,
      runtime: this.runtime.getStatus(),
      metrics: this.getMetrics()
    };
  }

  /**
   * Return static engine identity.
   * @returns {{name: string, implemented: boolean, runtime: string, model: string}}
   */
  getEngineInfo() {
    return {
      name: 'parakeet',
      implemented: true,
      runtime: 'sherpa-onnx',
      model: this.configuration.modelName
    };
  }

  /**
   * Return recognition metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Validate processed frame input.
   * @param {object} processedFrame Processed frame.
   * @returns {void}
   * @private
   */
  _assertProcessedFrame(processedFrame) {
    if (!processedFrame || typeof processedFrame.getPcmBuffer !== 'function' || !processedFrame.originalFrame) {
      throw new STTInvalidAudioFrameError('STT requires ProcessedAudioFrame input.');
    }
  }

  /**
   * Record inference metrics.
   * @param {number} latencyMs Inference latency.
   * @param {boolean} finalResult Whether result is final.
   * @returns {void}
   * @private
   */
  _recordInference(latencyMs, finalResult) {
    this.metrics.framesProcessed += 1;
    if (!finalResult) this.metrics.partialResultsProduced += 1;
    const previousTotal = this.metrics.averageInferenceLatencyMs * (this.metrics.framesProcessed - 1);
    this.metrics.averageInferenceLatencyMs = (previousTotal + latencyMs) / this.metrics.framesProcessed;
    if (this.metricsRecorder && typeof this.metricsRecorder.increment === 'function') {
      this.metricsRecorder.increment('stt.frames.processed', 1);
    }
  }

  /**
   * Update recognition duration.
   * @returns {void}
   * @private
   */
  _updateRecognitionDuration() {
    if (!this.startedAt) return;
    this.metrics.recognitionDurationMs += Math.max(0, this.clock().getTime() - this.startedAt.getTime());
    this.startedAt = null;
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
    return { name: 'ParakeetRecognitionError', message: String(error || 'Recognition failed.') };
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

module.exports = ParakeetEngine;
