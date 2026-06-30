'use strict';

const {
  EmptyTranscriptError,
  InvalidTranscriptError,
  ValidationFailureError
} = require('./NormalizationErrors');

/**
 * Purpose: Validates normalized transcript text without modifying it.
 * Responsibility: Detect empty text, invalid characters, excessive repetition, maximum length, and confidence-threshold failures.
 * Dependencies: NormalizationErrors for structured validation failures.
 * Pipeline position: Final gate before NormalizedTranscript creation.
 * Future extension notes: Keep validation deterministic and separate from NLP.
 */
class TextValidator {
  /**
   * Create a validator.
   * @param {{maximumTranscriptLength?: number, confidenceThreshold?: number}} options Validator options.
   */
  constructor(options = {}) {
    this.maximumTranscriptLength = Number(options.maximumTranscriptLength) || 1000;
    this.confidenceThreshold = Number(options.confidenceThreshold) || 0;
  }

  /**
   * Validate normalized transcript text.
   * @param {string} text Normalized text.
   * @param {{confidence?: number}} metadata Validation metadata.
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
  validate(text, metadata = {}) {
    const value = String(text || '');
    const errors = [];
    const warnings = [];

    if (!value.trim()) errors.push('Transcript is empty.');
    if (value.length > this.maximumTranscriptLength) errors.push('Transcript exceeds maximum length.');
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) errors.push('Transcript contains invalid control characters.');
    if (/(.)\1{20,}/.test(value)) errors.push('Transcript appears corrupted by excessive character repetition.');
    if (/\b(\w+\b\s*)\1{5,}/i.test(value)) errors.push('Transcript contains excessive word repetition.');
    if (Number.isFinite(metadata.confidence) && metadata.confidence < this.confidenceThreshold) {
      errors.push('Transcript confidence is below threshold.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate and throw a structured error when invalid.
   * @param {string} text Normalized text.
   * @param {{confidence?: number}} metadata Validation metadata.
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
  assertValid(text, metadata = {}) {
    const result = this.validate(text, metadata);
    if (result.valid) return result;
    if (result.errors.includes('Transcript is empty.')) {
      throw new EmptyTranscriptError('Transcript is empty.', { details: result });
    }
    if (result.errors.some(error => error.includes('control') || error.includes('corrupted'))) {
      throw new InvalidTranscriptError('Transcript is invalid.', { details: result });
    }
    throw new ValidationFailureError('Transcript validation failed.', { details: result });
  }
}

module.exports = TextValidator;
