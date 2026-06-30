'use strict';

/**
 * Purpose: Defines the future audio preprocessing pipeline boundary.
 * Responsibility: Compose preprocessing stages by interface without signal processing.
 * Dependencies: Optional stage objects injected by future phases.
 * Future implementation notes: RNNoise, VAD, resampling, and chunking should be plugged in without changing callers.
 */
class AudioPipeline {
  /**
   * Create a placeholder pipeline.
   * @param {Array<object>} stages Future processing stages.
   */
  constructor(stages = []) {
    this.stages = Array.isArray(stages) ? stages.slice() : [];
  }

  /**
   * Return configured stage count.
   * @returns {number}
   */
  getStageCount() {
    return this.stages.length;
  }

  /**
   * Placeholder process method.
   * @param {object} audioBuffer Future audio buffer.
   * @returns {{processed: boolean, audioBuffer: object}}
   */
  process(audioBuffer) {
    return { processed: false, audioBuffer };
  }
}

module.exports = AudioPipeline;
