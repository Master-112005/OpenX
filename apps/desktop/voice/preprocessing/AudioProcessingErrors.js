'use strict';

/**
 * Purpose: Defines structured errors for the Audio Processing Layer.
 * Responsibility: Normalize RNNoise, VAD, frame validation, sample-rate, and pipeline failures.
 * Dependencies: None.
 * Thread ownership: Error instances carry immutable metadata for event/log payloads.
 * Future integration notes: Native model failures should be translated into these errors before leaving preprocessing.
 */

class AudioProcessingError extends Error {
  /**
   * Create a base preprocessing error.
   * @param {string} message Error message.
   * @param {{code?: string, details?: object}} options Error metadata.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || this.constructor.name;
    this.details = { ...(options.details || {}) };
  }

  /**
   * Return JSON-safe error metadata.
   * @returns {{name: string, code: string, message: string, details: object}}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: { ...this.details }
    };
  }
}

class RNNoiseInitializationFailedError extends AudioProcessingError {}
class RNNoiseProcessingFailedError extends AudioProcessingError {}
class VADInitializationFailedError extends AudioProcessingError {}
class VADProcessingFailedError extends AudioProcessingError {}
class InvalidAudioFrameError extends AudioProcessingError {}
class UnsupportedProcessingSampleRateError extends AudioProcessingError {}
class PipelineFailureError extends AudioProcessingError {}

module.exports = {
  AudioProcessingError,
  RNNoiseInitializationFailedError,
  RNNoiseProcessingFailedError,
  VADInitializationFailedError,
  VADProcessingFailedError,
  InvalidAudioFrameError,
  UnsupportedProcessingSampleRateError,
  PipelineFailureError
};
