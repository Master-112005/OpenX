'use strict';

const EventEmitter = require('events');
const AudioFrame = require('../audio/AudioFrame');
const RNNoiseProcessor = require('./RNNoiseProcessor');
const VoiceActivityDetector = require('./VoiceActivityDetector');
const ProcessedAudioFrame = require('./ProcessedAudioFrame');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const EVENTS = require('./AudioProcessingEvents');
const {
  InvalidAudioFrameError,
  PipelineFailureError
} = require('./AudioProcessingErrors');

/**
 * Purpose: Configurable low-latency audio preprocessing pipeline.
 * Responsibility: Enforce Raw PCM -> RNNoise -> VAD -> Processed PCM ordering and produce ProcessedAudioFrame objects.
 * Dependencies: AudioFrame, RNNoiseProcessor, VoiceActivityDetector, ProcessedAudioFrame, ProcessingConfiguration, and processing events/errors.
 * Thread ownership: The pipeline owns processor order and stage state; future streaming callers feed frames incrementally.
 * Future integration notes: Additional processors can be inserted after RNNoise/VAD without changing VoiceSessionManager.
 */
class AudioPipeline {
  /**
   * Create the preprocessing pipeline.
   * @param {{configuration?: ProcessingConfiguration|object, rnnoise?: RNNoiseProcessor, vad?: VoiceActivityDetector, logger?: object, metrics?: object, clock?: () => Date}} dependencies Pipeline dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.rnnoise = dependencies.rnnoise || new RNNoiseProcessor({
      configuration: this.configuration,
      logger: this.logger,
      metrics: this.metricsRecorder,
      clock: this.clock
    });
    this.vad = dependencies.vad || new VoiceActivityDetector({
      configuration: this.configuration,
      logger: this.logger,
      metrics: this.metricsRecorder
    });
    this.events = new EventEmitter();
    this.initialized = false;
    this.metrics = {
      framesProcessed: 0,
      pipelineResets: 0,
      averageFrameLatencyMs: 0
    };
    this._forwardStageEvents();
  }

  /**
   * Subscribe to processing events.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {AudioPipeline}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Initialize RNNoise and VAD stages.
   * @returns {{initialized: boolean, stages: string[]}}
   */
  initialize() {
    try {
      this.rnnoise.initialize();
      this.rnnoise.start();
      this.vad.initialize();
      this.initialized = true;
      const payload = { initialized: true, stages: this.getStages() };
      this.events.emit(EVENTS.PROCESSING_INITIALIZED, payload);
      this._log('Pipeline initialized', payload);
      return payload;
    } catch (error) {
      const wrapped = error instanceof PipelineFailureError
        ? error
        : new PipelineFailureError('Audio processing pipeline failed to initialize.', {
          details: this._normalizeError(error)
        });
      this.events.emit(EVENTS.PROCESSING_ERROR, { error: wrapped.toJSON() });
      throw wrapped;
    }
  }

  /**
   * Return configured processing stage names.
   * @returns {string[]}
   */
  getStages() {
    return ['Raw PCM', 'RNNoise', 'Voice Activity Detection', 'Processed PCM'];
  }

  /**
   * Return configured stage count.
   * @returns {number}
   */
  getStageCount() {
    return this.getStages().length;
  }

  /**
   * Process one AudioFrame through RNNoise and VAD.
   * @param {AudioFrame} audioFrame Raw audio frame.
   * @returns {ProcessedAudioFrame}
   */
  process(audioFrame) {
    if (!this.configuration.pipelineEnabled) {
      return this._createBypassFrame(audioFrame);
    }
    if (!this.initialized) this.initialize();
    this._assertAudioFrame(audioFrame);
    const startedAt = this.clock();

    try {
      const rnnoiseResult = this.rnnoise.process(audioFrame);
      const vadResult = this.vad.detect({
        cleanedPcm: rnnoiseResult.cleanedPcm,
        durationMs: audioFrame.durationMs,
        sampleRate: audioFrame.sampleRate
      });
      const latencyMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
      const processedFrame = new ProcessedAudioFrame({
        originalFrame: audioFrame,
        cleanedPcm: rnnoiseResult.cleanedPcm,
        speechActivityState: vadResult.state,
        speechConfidence: vadResult.confidence,
        endpointCandidate: vadResult.endpointCandidate,
        processingMetadata: {
          rnnoiseApplied: rnnoiseResult.rnnoiseApplied,
          rnnoiseProcessingTimeMs: rnnoiseResult.processingTimeMs,
          vadApplied: this.configuration.vadEnabled,
          speechStarted: vadResult.speechStarted,
          speechEnded: vadResult.speechEnded,
          silenceDurationMs: vadResult.silenceDurationMs,
          speechDurationMs: vadResult.speechDurationMs,
          latencyMs
        }
      });
      this._recordProcessedFrame(processedFrame, latencyMs);
      return processedFrame;
    } catch (error) {
      const wrapped = error instanceof PipelineFailureError
        ? error
        : new PipelineFailureError('Audio processing pipeline failed.', {
          details: this._normalizeError(error)
        });
      this.events.emit(EVENTS.PROCESSING_ERROR, { error: wrapped.toJSON() });
      throw wrapped;
    }
  }

  /**
   * Reset pipeline and rolling VAD state.
   * @returns {{reset: boolean}}
   */
  reset() {
    this.vad.reset();
    this.metrics.pipelineResets += 1;
    this.events.emit(EVENTS.PIPELINE_RESET, this.getStatus());
    return { reset: true };
  }

  /**
   * Shutdown processing stages.
   * @returns {{shutdown: boolean}}
   */
  shutdown() {
    this.rnnoise.shutdown();
    this.initialized = false;
    this.events.emit(EVENTS.PROCESSING_SHUTDOWN, this.getStatus());
    return { shutdown: true };
  }

  /**
   * Return pipeline status metadata.
   * @returns {object}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      enabled: this.configuration.pipelineEnabled,
      stages: this.getStages(),
      rnnoise: this.rnnoise.getStatus(),
      vad: this.vad.getStatus()
    };
  }

  /**
   * Return processing metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      rnnoise: this.rnnoise.getMetrics(),
      vad: this.vad.getMetrics()
    };
  }

  /**
   * Forward events from RNNoise and VAD into pipeline event bus.
   * @returns {void}
   * @private
   */
  _forwardStageEvents() {
    for (const eventName of [
      EVENTS.RNNOISE_INITIALIZED,
      EVENTS.RNNOISE_FAILED,
      EVENTS.VAD_INITIALIZED,
      EVENTS.SPEECH_STARTED,
      EVENTS.SPEECH_ENDED,
      EVENTS.SILENCE_DETECTED,
      EVENTS.ENDPOINT_DETECTED
    ]) {
      if (this.rnnoise && typeof this.rnnoise.on === 'function') {
        this.rnnoise.on(eventName, payload => this.events.emit(eventName, payload));
      }
      if (this.vad && typeof this.vad.on === 'function') {
        this.vad.on(eventName, payload => this.events.emit(eventName, payload));
      }
    }
  }

  /**
   * Validate incoming raw audio frame.
   * @param {AudioFrame} audioFrame Candidate frame.
   * @returns {void}
   * @private
   */
  _assertAudioFrame(audioFrame) {
    if (!(audioFrame instanceof AudioFrame)) {
      throw new InvalidAudioFrameError('AudioPipeline requires AudioFrame input.');
    }
  }

  /**
   * Create a processed frame when the pipeline is disabled.
   * @param {AudioFrame} audioFrame Raw audio frame.
   * @returns {ProcessedAudioFrame}
   * @private
   */
  _createBypassFrame(audioFrame) {
    this._assertAudioFrame(audioFrame);
    return new ProcessedAudioFrame({
      originalFrame: audioFrame,
      cleanedPcm: audioFrame.getPcmBuffer(),
      speechActivityState: 'UNKNOWN',
      speechConfidence: 0,
      endpointCandidate: false,
      processingMetadata: {
        rnnoiseApplied: false,
        vadApplied: false,
        latencyMs: 0,
        bypassed: true
      }
    });
  }

  /**
   * Record metrics and emit frame processed event.
   * @param {ProcessedAudioFrame} processedFrame Processed frame.
   * @param {number} latencyMs Frame latency.
   * @returns {void}
   * @private
   */
  _recordProcessedFrame(processedFrame, latencyMs) {
    this.metrics.framesProcessed += 1;
    const previousTotal = this.metrics.averageFrameLatencyMs * (this.metrics.framesProcessed - 1);
    this.metrics.averageFrameLatencyMs = (previousTotal + latencyMs) / this.metrics.framesProcessed;
    if (this.metricsRecorder && typeof this.metricsRecorder.increment === 'function') {
      this.metricsRecorder.increment('audio.processing.frames', 1);
    }
    this.events.emit(EVENTS.FRAME_PROCESSED, {
      frame: processedFrame,
      metadata: processedFrame.toMetadata()
    });
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
    return { name: 'PipelineError', message: String(error || 'Pipeline failed.') };
  }

  /**
   * Write structured processing logs when a logger exists.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Audio Processing] ${message}`, metadata);
    }
  }
}

module.exports = AudioPipeline;
