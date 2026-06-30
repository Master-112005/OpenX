'use strict';

const EventEmitter = require('events');
const AudioFrameProcessor = require('./AudioFrameProcessor');
const AudioPipeline = require('./AudioPipeline');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const EVENTS = require('./AudioProcessingEvents');
const { PipelineFailureError } = require('./AudioProcessingErrors');

/**
 * Purpose: Public coordinator for the OpenX Audio Processing Layer.
 * Responsibility: Own preprocessing configuration, pipeline, frame processor, events, logging, and processing metrics.
 * Dependencies: AudioFrameProcessor, AudioPipeline, ProcessingConfiguration, AudioProcessingEvents, and AudioProcessingErrors.
 * Thread ownership: VoiceSessionManager owns this coordinator; callers should not bypass it to invoke RNNoise or VAD directly.
 * Future integration notes: Future STT should consume ProcessedAudioFrame output from this coordinator only.
 */
class AudioProcessor {
  /**
   * Create an audio processor coordinator.
   * @param {{configuration?: ProcessingConfiguration|object, pipeline?: AudioPipeline, frameProcessor?: AudioFrameProcessor, logger?: object, metrics?: object, clock?: () => Date}} dependencies Processor dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.pipeline = dependencies.pipeline || new AudioPipeline({
      configuration: this.configuration,
      logger: this.logger,
      metrics: this.metricsRecorder,
      clock: this.clock
    });
    this.frameProcessor = dependencies.frameProcessor || new AudioFrameProcessor({
      configuration: this.configuration,
      pipeline: this.pipeline,
      logger: this.logger,
      metrics: this.metricsRecorder,
      clock: this.clock
    });
    this.events = new EventEmitter();
    this.initialized = false;
    this.metrics = {
      framesProcessed: 0,
      speechFrames: 0,
      silenceFrames: 0,
      endpoints: 0,
      initializationFailures: 0
    };
    this._forwardPipelineEvents();
  }

  /**
   * Subscribe to processing events.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {AudioProcessor}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a processing event listener.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {AudioProcessor}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Initialize preprocessing pipeline.
   * @returns {{initialized: boolean, stages: string[]}}
   */
  initialize() {
    try {
      const result = this.frameProcessor.initialize();
      this.initialized = true;
      this._log('Processing initialized', result);
      return result;
    } catch (error) {
      this.metrics.initializationFailures += 1;
      const wrapped = error instanceof PipelineFailureError
        ? error
        : new PipelineFailureError('AudioProcessor initialization failed.', {
          details: this._normalizeError(error)
        });
      this.events.emit(EVENTS.PROCESSING_ERROR, { error: wrapped.toJSON() });
      throw wrapped;
    }
  }

  /**
   * Process one raw AudioFrame into a ProcessedAudioFrame.
   * @param {import('../audio/AudioFrame')} audioFrame Raw audio frame.
   * @returns {import('./ProcessedAudioFrame')}
   */
  processFrame(audioFrame) {
    if (!this.initialized) this.initialize();
    const processedFrame = this.frameProcessor.processFrame(audioFrame);
    this._recordProcessedFrame(processedFrame);
    return processedFrame;
  }

  /**
   * Reset preprocessing state.
   * @returns {{reset: boolean}}
   */
  reset() {
    return this.frameProcessor.reset();
  }

  /**
   * Shutdown preprocessing resources.
   * @returns {{shutdown: boolean}}
   */
  shutdown() {
    const result = this.frameProcessor.shutdown();
    this.initialized = false;
    return result;
  }

  /**
   * Compatibility close method for VoiceSessionManager cleanup.
   * @returns {{shutdown: boolean}}
   */
  close() {
    return this.shutdown();
  }

  /**
   * Return processing status.
   * @returns {object}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      configuration: this.configuration.toJSON(),
      pipeline: this.frameProcessor.getStatus()
    };
  }

  /**
   * Return processing metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      pipeline: this.frameProcessor.getMetrics()
    };
  }

  /**
   * Forward pipeline events through the public processor bus.
   * @returns {void}
   * @private
   */
  _forwardPipelineEvents() {
    for (const eventName of Object.values(EVENTS)) {
      this.pipeline.on(eventName, payload => this.events.emit(eventName, payload));
    }
  }

  /**
   * Record processed-frame metrics.
   * @param {import('./ProcessedAudioFrame')} processedFrame Processed frame.
   * @returns {void}
   * @private
   */
  _recordProcessedFrame(processedFrame) {
    this.metrics.framesProcessed += 1;
    if (processedFrame.speechActivityState === 'SPEECH') this.metrics.speechFrames += 1;
    if (processedFrame.speechActivityState === 'SILENCE') this.metrics.silenceFrames += 1;
    if (processedFrame.endpointCandidate) this.metrics.endpoints += 1;
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
    return { name: 'AudioProcessorError', message: String(error || 'AudioProcessor failed.') };
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

module.exports = AudioProcessor;
