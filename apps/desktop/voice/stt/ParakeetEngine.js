'use strict';

const STTEngine = require('./STTEngine');

/**
 * Purpose: Reserves the future NVIDIA Parakeet adapter boundary.
 * Responsibility: Identify Parakeet as a possible STT implementation without loading any model.
 * Dependencies: STTEngine contract only.
 * Future implementation notes: Model paths, GPU configuration, and runtime loading must be added in a later phase.
 */
class ParakeetEngine extends STTEngine {
  /**
   * Return static engine identity.
   * @returns {{name: string, implemented: boolean}}
   */
  getEngineInfo() {
    return { name: 'parakeet', implemented: false };
  }
}

module.exports = ParakeetEngine;
