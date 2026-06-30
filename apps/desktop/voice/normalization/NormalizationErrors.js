'use strict';

/**
 * Purpose: Defines structured errors for deterministic transcript normalization.
 * Responsibility: Represent invalid transcript, empty transcript, normalization, validation, dictionary, rule, and configuration failures.
 * Dependencies: None.
 * Pipeline position: Errors may be raised by any normalization stage and wrapped by TranscriptProcessor.
 * Future extension notes: Do not add intent or command-execution errors here.
 */

class NormalizationError extends Error {
  /**
   * Create a base normalization error.
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

class InvalidTranscriptError extends NormalizationError {}
class EmptyTranscriptError extends NormalizationError {}
class NormalizationFailureError extends NormalizationError {}
class ValidationFailureError extends NormalizationError {}
class DictionaryLoadFailureError extends NormalizationError {}
class UnknownNormalizationRuleError extends NormalizationError {}
class ConfigurationError extends NormalizationError {}

module.exports = {
  NormalizationError,
  InvalidTranscriptError,
  EmptyTranscriptError,
  NormalizationFailureError,
  ValidationFailureError,
  DictionaryLoadFailureError,
  UnknownNormalizationRuleError,
  ConfigurationError
};
