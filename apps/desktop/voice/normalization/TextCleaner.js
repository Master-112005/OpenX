'use strict';

/**
 * Purpose: Performs mechanical transcript cleanup before semantic-preserving normalization.
 * Responsibility: Normalize whitespace, punctuation spacing, quotes, apostrophes, repeated punctuation, and accidental repeated words.
 * Dependencies: NormalizationConfiguration-compatible options.
 * Pipeline position: First stage after raw transcript extraction.
 * Future extension notes: Keep this stage mechanical; do not add command understanding.
 */
class TextCleaner {
  /**
   * Create a text cleaner.
   * @param {{removeRepeatedWords?: boolean}} options Cleaner options.
   */
  constructor(options = {}) {
    this.removeRepeatedWords = options.removeRepeatedWords !== false;
  }

  /**
   * Clean raw transcript text.
   * @param {string} text Raw text.
   * @returns {{text: string, transformations: object[]}}
   */
  clean(text) {
    let next = String(text || '');
    const transformations = [];
    const apply = (stage, updater) => {
      const before = next;
      next = updater(next);
      if (before !== next) transformations.push({ stage, before, after: next });
    };

    apply('normalize-quotes', value => value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    apply('repeated-punctuation', value => value.replace(/([!?.,])\1+/g, '$1'));
    apply('normalize-whitespace', value => value.replace(/\s+/g, ' ').trim());
    apply('punctuation-spacing', value => value.replace(/\s+([,.!?;:])/g, '$1').replace(/([,.!?;:])(?=\S)/g, '$1 '));
    if (this.removeRepeatedWords) {
      apply('remove-repeated-words', value => value.replace(/\b(\w+)(\s+\1\b)+/gi, '$1'));
    }
    apply('final-trim', value => value.replace(/\s+/g, ' ').trim());

    return { text: next, transformations };
  }
}

module.exports = TextCleaner;
