'use strict';

/**
 * Purpose: Defines structured Audio Layer error classes.
 * Responsibility: Normalize microphone, configuration, permission, capture, and buffer failures.
 * Dependencies: None.
 * Thread ownership: Errors are immutable metadata objects after construction.
 * Future integration notes: Native capture backends should translate platform-specific failures into these classes.
 */

class AudioError extends Error {
  /**
   * Create a base audio error.
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

class MicrophoneNotFoundError extends AudioError {}
class PermissionDeniedError extends AudioError {}
class UnsupportedSampleRateError extends AudioError {}
class CaptureFailedError extends AudioError {}
class DeviceDisconnectedError extends AudioError {}
class InitializationFailedError extends AudioError {}
class BufferOverflowError extends AudioError {}

module.exports = {
  AudioError,
  MicrophoneNotFoundError,
  PermissionDeniedError,
  UnsupportedSampleRateError,
  CaptureFailedError,
  DeviceDisconnectedError,
  InitializationFailedError,
  BufferOverflowError
};
