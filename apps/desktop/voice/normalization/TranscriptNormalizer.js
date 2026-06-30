'use strict';

/**
 * Purpose: Performs general transcript normalization without domain-specific replacements.
 * Responsibility: Normalize capitalization, spacing, punctuation, and common speech artifacts while preserving user intent.
 * Dependencies: None.
 * Pipeline position: Runs after TextCleaner and before command/application/technology stages.
 * Future extension notes: Keep this deterministic; no grammar rewriting or intent inference belongs here.
 */
class TranscriptNormalizer {
  /**
   * Create a transcript normalizer.
   * @param {{removeFillers?: boolean, capitalizationRules?: boolean}} options Normalizer options.
   */
  constructor(options = {}) {
    this.removeFillers = options.removeFillers !== false;
    this.capitalizationRules = options.capitalizationRules !== false;
  }

  /**
   * Normalize general transcript text.
   * @param {string} transcript Cleaned transcript.
   * @returns {string}
   */
  normalize(transcript) {
    return this.normalizeWithMetadata(transcript).text;
  }

  /**
   * Normalize general transcript text with transformation metadata.
   * @param {string} transcript Cleaned transcript.
   * @returns {{text: string, transformations: object[]}}
   */
  normalizeWithMetadata(transcript) {
    let next = String(transcript || '');
    const transformations = [];
    const apply = (stage, updater) => {
      const before = next;
      next = updater(next);
      if (before !== next) transformations.push({ stage, before, after: next });
    };

    if (this.removeFillers) {
      apply('remove-fillers', value => value.replace(/\b(um|uh|erm|ah|like|please please)\b/gi, '').replace(/\s+/g, ' ').trim());
    }
    apply('normalize-spacing', value => value.replace(/\s+/g, ' ').trim());
    if (this.capitalizationRules) {
      apply('sentence-capitalization', value => value.replace(/^([a-z])/, match => match.toUpperCase()));
    }
    return { text: next, transformations };
  }

  /**
   * Normalize a raw recognition result shape.
   * @param {{text?: string, transcript?: string, confidence?: number}} result Recognition result.
   * @returns {{text: string, confidence: number|null}}
   */
  normalizeResult(result = {}) {
    return {
      text: this.normalize(result.text || result.transcript || ''),
      confidence: Number.isFinite(result.confidence) ? result.confidence : null
    };
  }
}

module.exports = TranscriptNormalizer;
