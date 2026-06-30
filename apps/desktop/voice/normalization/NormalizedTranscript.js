'use strict';

/**
 * Purpose: Represents immutable normalized transcript output for future NLP input.
 * Responsibility: Store original, cleaned, normalized text, validation result, timestamp, metadata, and applied transformations.
 * Dependencies: None.
 * Pipeline position: Final output of TranscriptProcessor.
 * Future extension notes: Existing OpenX NLP should receive this object's normalized text without changes to NLP itself.
 */
class NormalizedTranscript {
  /**
   * Create immutable normalized transcript.
   * @param {{originalTranscript?: string, cleanedTranscript?: string, normalizedTranscript?: string, validation?: object, timestamp?: Date|string, metadata?: object, transformations?: object[]}} options Output options.
   */
  constructor(options = {}) {
    this.originalTranscript = String(options.originalTranscript || '');
    this.cleanedTranscript = String(options.cleanedTranscript || '');
    this.normalizedTranscript = String(options.normalizedTranscript || '');
    this.validation = Object.freeze({
      valid: Boolean(options.validation?.valid),
      errors: Array.isArray(options.validation?.errors) ? options.validation.errors.slice() : [],
      warnings: Array.isArray(options.validation?.warnings) ? options.validation.warnings.slice() : []
    });
    this.timestamp = options.timestamp ? new Date(options.timestamp) : new Date();
    this.metadata = Object.freeze({ ...(options.metadata || {}) });
    this.transformations = Object.freeze((options.transformations || []).map(transformation => ({ ...transformation })));
    Object.freeze(this);
  }

  /**
   * Return text for NLP handoff.
   * @returns {string}
   */
  toString() {
    return this.normalizedTranscript;
  }

  /**
   * Return JSON-safe normalized transcript.
   * @returns {object}
   */
  toJSON() {
    return {
      originalTranscript: this.originalTranscript,
      cleanedTranscript: this.cleanedTranscript,
      normalizedTranscript: this.normalizedTranscript,
      validation: {
        valid: this.validation.valid,
        errors: this.validation.errors.slice(),
        warnings: this.validation.warnings.slice()
      },
      timestamp: this.timestamp.toISOString(),
      metadata: { ...this.metadata },
      transformations: this.transformations.map(transformation => ({ ...transformation }))
    };
  }
}

module.exports = NormalizedTranscript;
