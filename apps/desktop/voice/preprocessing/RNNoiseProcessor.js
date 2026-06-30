'use strict';

/**
 * Purpose: Defines the future RNNoise preprocessing boundary.
 * Responsibility: Keep denoising optional and replaceable.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Native model loading and DSP are explicitly out of scope for this foundation.
 */
class RNNoiseProcessor {
  /**
   * Placeholder model load method.
   * @throws {Error} Always not implemented in Phase 1.
   */
  load() {
    throw new Error('RNNoise processing is not implemented in Phase 1.');
  }

  /**
   * Placeholder denoise method.
   * @param {object} audioBuffer Future audio buffer.
   * @returns {{processed: boolean, audioBuffer: object}}
   */
  process(audioBuffer) {
    return { processed: false, audioBuffer };
  }
}

module.exports = RNNoiseProcessor;
