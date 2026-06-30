'use strict';

const EventEmitter = require('events');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const EVENTS = require('./AudioProcessingEvents');
const {
  RNNoiseInitializationFailedError,
  RNNoiseProcessingFailedError
} = require('./AudioProcessingErrors');

/**
 * Purpose: Provides the dedicated RNNoise-compatible noise suppression stage.
 * Responsibility: Initialize resources, process incremental PCM frames, preserve timing/alignment, and report status.
 * Dependencies: ProcessingConfiguration, AudioProcessingEvents, AudioProcessingErrors, and optional injected RNNoise backend.
 * Thread ownership: This processor owns its backend/model handle and never mutates VoiceSession state.
 * Future integration notes: Native RNNoise bindings should be adapted behind the injected backend interface without changing AudioProcessor.
 */
class RNNoiseProcessor {
  /**
   * Create an RNNoise processor.
   * @param {{configuration?: ProcessingConfiguration|object, backend?: object, logger?: object, metrics?: object, clock?: () => Date}} dependencies Processor dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.backend = dependencies.backend || null;
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.events = new EventEmitter();
    this.initialized = false;
    this.running = false;
    this.metrics = {
      framesProcessed: 0,
      processingTimeMs: 0,
      initializationFailures: 0
    };
  }

  /**
   * Subscribe to RNNoise processing events.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {RNNoiseProcessor}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Initialize RNNoise resources.
   * @returns {{initialized: boolean, enabled: boolean}}
   */
  initialize() {
    return this.load();
  }

  /**
   * Load RNNoise backend resources or prepare the deterministic fallback stage.
   * @returns {{initialized: boolean, enabled: boolean}}
   */
  load() {
    try {
      if (this.backend && typeof this.backend.load === 'function') {
        this.backend.load(this.configuration);
      }
      this.initialized = true;
      this.events.emit(EVENTS.RNNOISE_INITIALIZED, this.getStatus());
      this._log('RNNoise initialized', this.getStatus());
      return { initialized: true, enabled: this.configuration.rnnoiseEnabled };
    } catch (error) {
      this.metrics.initializationFailures += 1;
      const wrapped = new RNNoiseInitializationFailedError('RNNoise initialization failed.', {
        details: this._normalizeError(error)
      });
      this.events.emit(EVENTS.RNNOISE_FAILED, { error: wrapped.toJSON() });
      throw wrapped;
    }
  }

  /**
   * Start the RNNoise processing stage.
   * @returns {{started: boolean}}
   */
  start() {
    if (!this.initialized) this.initialize();
    if (this.backend && typeof this.backend.start === 'function') {
      this.backend.start();
    }
    this.running = true;
    return { started: true };
  }

  /**
   * Shut down RNNoise resources.
   * @returns {{shutdown: boolean}}
   */
  shutdown() {
    if (this.backend && typeof this.backend.shutdown === 'function') {
      this.backend.shutdown();
    }
    this.running = false;
    this.initialized = false;
    return { shutdown: true };
  }

  /**
   * Process one incremental PCM frame.
   * @param {{getPcmBuffer?: Function, pcm?: Buffer, sampleRate?: number, channels?: number}} frame Audio frame.
   * @returns {{cleanedPcm: Buffer, rnnoiseApplied: boolean, processingTimeMs: number}}
   */
  process(frame) {
    if (!this.initialized) this.initialize();
    const startedAt = this.clock();
    try {
      const pcm = frame && typeof frame.getPcmBuffer === 'function'
        ? frame.getPcmBuffer()
        : Buffer.from(frame?.pcm || []);
      const cleanedPcm = this.configuration.rnnoiseEnabled
        ? this._processPcm(pcm, frame)
        : Buffer.from(pcm);
      const processingTimeMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
      this.metrics.framesProcessed += 1;
      this.metrics.processingTimeMs += processingTimeMs;
      this._recordMetric('audio.processing.rnnoise.frames', 1);
      return {
        cleanedPcm,
        rnnoiseApplied: this.configuration.rnnoiseEnabled,
        processingTimeMs
      };
    } catch (error) {
      const wrapped = new RNNoiseProcessingFailedError('RNNoise processing failed.', {
        details: this._normalizeError(error)
      });
      this.events.emit(EVENTS.RNNOISE_FAILED, { error: wrapped.toJSON() });
      throw wrapped;
    }
  }

  /**
   * Return processor status.
   * @returns {{initialized: boolean, running: boolean, enabled: boolean, framesProcessed: number}}
   */
  getStatus() {
    return {
      initialized: this.initialized,
      running: this.running,
      enabled: this.configuration.rnnoiseEnabled,
      framesProcessed: this.metrics.framesProcessed
    };
  }

  /**
   * Return processing metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Process PCM bytes through injected backend or deterministic low-level noise gate.
   * @param {Buffer} pcm Raw PCM.
   * @param {object} frame Audio frame metadata.
   * @returns {Buffer}
   * @private
   */
  _processPcm(pcm, frame) {
    if (this.backend && typeof this.backend.process === 'function') {
      return Buffer.from(this.backend.process(pcm, frame, this.configuration));
    }
    return this._applyDeterministicNoiseGate(pcm);
  }

  /**
   * Apply a lightweight deterministic noise gate for testable fallback behavior.
   * @param {Buffer} pcm Raw PCM bytes.
   * @returns {Buffer}
   * @private
   */
  _applyDeterministicNoiseGate(pcm) {
    const output = Buffer.from(pcm);
    const threshold = Math.round(512 * this.configuration.rnnoiseAggressiveness);
    for (let index = 0; index + 1 < output.length; index += 2) {
      const sample = output.readInt16LE(index);
      if (Math.abs(sample) < threshold) {
        output.writeInt16LE(0, index);
      }
    }
    return output;
  }

  /**
   * Record a metric through an injected recorder.
   * @param {string} name Metric name.
   * @param {number} value Metric value.
   * @returns {void}
   * @private
   */
  _recordMetric(name, value) {
    if (this.metricsRecorder && typeof this.metricsRecorder.increment === 'function') {
      this.metricsRecorder.increment(name, value);
    }
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
    return { name: 'RNNoiseError', message: String(error || 'RNNoise failed.') };
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

module.exports = RNNoiseProcessor;
