'use strict';

/**
 * Purpose: Defines the future transcript normalization boundary.
 * Responsibility: Provide a stable API without applying dictionaries or replacements.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Text normalization can later feed the existing assistant pipeline as plain text.
 */
class TranscriptNormalizer {
  /**
   * Return transcript unchanged.
   * @param {string} transcript Raw transcript.
   * @returns {string}
   */
  normalize(transcript) {
    return String(transcript || '');
  }

  /**
   * Placeholder confidence cleanup hook.
   * @param {{text?: string, confidence?: number}} result Future recognition result.
   * @returns {{text: string, confidence: number|null}}
   */
  normalizeResult(result = {}) {
    return {
      text: String(result.text || ''),
      confidence: Number.isFinite(result.confidence) ? result.confidence : null
    };
  }
}

module.exports = TranscriptNormalizer;
