'use strict';

/**
 * Purpose: Defines the abstract speech-to-text engine contract.
 * Responsibility: Document future recognition methods without implementing STT.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Concrete engines should implement this shape and remain replaceable.
 */
class STTEngine {
  /**
   * Placeholder engine initialization.
   * @throws {Error} Always not implemented in Phase 1.
   */
  initialize() {
    throw new Error('STT engine initialization is not implemented in Phase 1.');
  }

  /**
   * Placeholder transcription call.
   * @param {object} audioBuffer Future audio buffer.
   * @throws {Error} Always not implemented in Phase 1.
   */
  transcribe(audioBuffer) {
    throw new Error('STT transcription is not implemented in Phase 1.');
  }

  /**
   * Placeholder disposal hook.
   * @returns {{disposed: boolean}}
   */
  dispose() {
    return { disposed: false };
  }
}

module.exports = STTEngine;
