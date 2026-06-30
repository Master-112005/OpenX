'use strict';

const EventEmitter = require('events');
const STTConfiguration = require('./STTConfiguration');
const ParakeetEngine = require('./ParakeetEngine');
const STT_EVENTS = require('./STTEvents');
const { StreamingFailureError } = require('./STTErrors');

/**
 * Purpose: Public model-agnostic Speech-to-Text engine facade for OpenX Voice.
 * Responsibility: Expose streaming lifecycle methods while hiding Parakeet and Sherpa implementation details.
 * Dependencies: STTConfiguration, ParakeetEngine strategy, STT events, and structured STT errors.
 * Lifecycle: initialize() -> start() -> partial(processedFrame)* -> final() -> stop()/destroy(), with cancel/reset recovery.
 * Future extension notes: Future engines such as Whisper or Moonshine should be selected behind this facade without changing VoiceSessionManager.
 */
class STTEngine {
  /**
   * Create the public STT engine facade.
   * @param {{configuration?: STTConfiguration|object, engine?: object, EngineClass?: Function, logger?: object, metrics?: object, clock?: () => Date}} dependencies Engine dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof STTConfiguration
      ? dependencies.configuration
      : new STTConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.events = new EventEmitter();
    this.engine = dependencies.engine || this._createEngine(dependencies.EngineClass || ParakeetEngine);
    this._forwardEngineEvents();
    this.initialized = false;
  }

  /**
   * Subscribe to STT events.
   * @param {string} eventName Event name from STTEvents.
   * @param {Function} listener Event listener.
   * @returns {STTEngine}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove an STT event listener.
   * @param {string} eventName Event name from STTEvents.
   * @param {Function} listener Event listener.
   * @returns {STTEngine}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Initialize the configured STT strategy.
   * @returns {{initialized: boolean, engine: string, model: object}}
   */
  initialize() {
    const result = this.engine.initialize();
    this.initialized = true;
    this.events.emit(STT_EVENTS.STT_INITIALIZED, result);
    this._log('Initialized', result);
    return result;
  }

  /**
   * Start streaming recognition.
   * @returns {{started: boolean, state: string}}
   */
  start() {
    if (!this.initialized) this.initialize();
    return this.engine.start();
  }

  /**
   * Stop streaming recognition.
   * @returns {{stopped: boolean, state: string}}
   */
  stop() {
    return this.engine.stop();
  }

  /**
   * Cancel streaming recognition and clear partial state.
   * @returns {{cancelled: boolean, state: string}}
   */
  cancel() {
    return this.engine.cancel();
  }

  /**
   * Feed one ProcessedAudioFrame and return a partial transcript.
   * @param {import('../preprocessing/ProcessedAudioFrame')} processedFrame Processed audio frame.
   * @returns {import('./TranscriptResult')}
   */
  partial(processedFrame) {
    if (!this.configuration.streamingEnabled) {
      throw new StreamingFailureError('STT streaming is disabled.');
    }
    return this.engine.partial(processedFrame);
  }

  /**
   * Finalize streaming recognition and return a final transcript.
   * @returns {import('./TranscriptResult')}
   */
  final() {
    return this.engine.final();
  }

  /**
   * Reset decoder and transcript state.
   * @returns {{reset: boolean, state: string}}
   */
  reset() {
    this.initialized = false;
    return this.engine.reset();
  }

  /**
   * Destroy STT resources.
   * @returns {{destroyed: boolean}}
   */
  destroy() {
    this.initialized = false;
    return this.engine.destroy();
  }

  /**
   * Return whether streaming recognition is active.
   * @returns {boolean}
   */
  isRunning() {
    return this.engine.isRunning();
  }

  /**
   * Return public STT status without runtime internals.
   * @returns {object}
   */
  getStatus() {
    const status = this.engine.getStatus();
    return {
      initialized: this.initialized,
      running: this.isRunning(),
      engine: status.engine,
      decoder: status.decoder,
      model: status.model,
      metrics: status.metrics
    };
  }

  /**
   * Create configured strategy implementation.
   * @param {Function} EngineClass Strategy class.
   * @returns {object}
   * @private
   */
  _createEngine(EngineClass) {
    return new EngineClass({
      configuration: this.configuration,
      logger: this.logger,
      metrics: this.metricsRecorder,
      clock: this.clock
    });
  }

  /**
   * Forward internal engine events through the facade event bus.
   * @returns {void}
   * @private
   */
  _forwardEngineEvents() {
    if (!this.engine || typeof this.engine.on !== 'function') return;
    for (const eventName of Object.values(STT_EVENTS)) {
      this.engine.on(eventName, payload => this.events.emit(eventName, payload));
    }
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

module.exports = STTEngine;
