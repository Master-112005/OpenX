'use strict';

/**
 * Purpose: Reserves the future Sherpa-ONNX runtime boundary.
 * Responsibility: Document runtime lifecycle without installing or loading Sherpa.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Native runtime loading should remain isolated here.
 */
class SherpaRuntime {
  /**
   * Placeholder runtime availability check.
   * @returns {{available: boolean, reason: string}}
   */
  getAvailability() {
    return {
      available: false,
      reason: 'Sherpa runtime is not implemented in Phase 1.'
    };
  }

  /**
   * Placeholder runtime creation.
   * @throws {Error} Always not implemented in Phase 1.
   */
  createRecognizer() {
    throw new Error('Sherpa recognizer creation is not implemented in Phase 1.');
  }
}

module.exports = SherpaRuntime;
