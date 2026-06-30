'use strict';

/**
 * Purpose: Defines structured Speech-to-Text error classes.
 * Responsibility: Wrap model, runtime, decoder, frame, streaming, timeout, and recognition failures without leaking runtime exceptions.
 * Dependencies: None.
 * Lifecycle: Errors are created inside the STT package and exposed as stable metadata through events/results.
 * Future extension notes: Whisper, Moonshine, or other engines should translate provider-specific failures into this hierarchy.
 */

class STTError extends Error {
  /**
   * Create a base STT error.
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

class ModelNotFoundError extends STTError {}
class ModelLoadFailedError extends STTError {}
class RuntimeInitializationFailedError extends STTError {}
class DecoderFailureError extends STTError {}
class STTInvalidAudioFrameError extends STTError {}
class RecognitionFailedError extends STTError {}
class ModelIncompatibleError extends STTError {}
class StreamingFailureError extends STTError {}
class InferenceTimeoutError extends STTError {}

module.exports = {
  STTError,
  ModelNotFoundError,
  ModelLoadFailedError,
  RuntimeInitializationFailedError,
  DecoderFailureError,
  STTInvalidAudioFrameError,
  RecognitionFailedError,
  ModelIncompatibleError,
  StreamingFailureError,
  InferenceTimeoutError
};
