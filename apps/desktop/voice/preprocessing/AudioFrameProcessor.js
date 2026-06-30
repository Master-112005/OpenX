'use strict';

const AudioFrame = require('../audio/AudioFrame');
const AudioPipeline = require('./AudioPipeline');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const { InvalidAudioFrameError } = require('./AudioProcessingErrors');

/**
 * Purpose: Processes one AudioFrame at a time through the configured preprocessing pipeline.
 * Responsibility: Validate frame input and delegate Raw PCM -> RNNoise -> VAD -> ProcessedAudioFrame work to AudioPipeline.
 * Dependencies: AudioFrame, AudioPipeline, ProcessingConfiguration, and AudioProcessingErrors.
 * Thread ownership: Stateless wrapper around the owned pipeline for future streaming workers.
 * Future integration notes: This class can later run inside a worker thread without changing AudioProcessor's public API.
 */
class AudioFrameProcessor {
  /**
   * Create a frame processor.
   * @param {{pipeline?: AudioPipeline, configuration?: ProcessingConfiguration|object, logger?: object, metrics?: object, clock?: () => Date}} dependencies Processor dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.pipeline = dependencies.pipeline || new AudioPipeline({
      configuration: this.configuration,
      logger: dependencies.logger,
      metrics: dependencies.metrics,
      clock: dependencies.clock
    });
  }

  /**
   * Initialize the owned pipeline.
   * @returns {{initialized: boolean, stages: string[]}}
   */
  initialize() {
    return this.pipeline.initialize();
  }

  /**
   * Process one valid AudioFrame.
   * @param {AudioFrame} audioFrame Raw audio frame.
   * @returns {import('./ProcessedAudioFrame')}
   */
  processFrame(audioFrame) {
    if (!(audioFrame instanceof AudioFrame)) {
      throw new InvalidAudioFrameError('AudioFrameProcessor requires AudioFrame input.');
    }
    return this.pipeline.process(audioFrame);
  }

  /**
   * Reset the owned pipeline.
   * @returns {{reset: boolean}}
   */
  reset() {
    return this.pipeline.reset();
  }

  /**
   * Shutdown the owned pipeline.
   * @returns {{shutdown: boolean}}
   */
  shutdown() {
    return this.pipeline.shutdown();
  }

  /**
   * Return owned pipeline status.
   * @returns {object}
   */
  getStatus() {
    return this.pipeline.getStatus();
  }

  /**
   * Return owned pipeline metrics.
   * @returns {object}
   */
  getMetrics() {
    return this.pipeline.getMetrics();
  }
}

module.exports = AudioFrameProcessor;
