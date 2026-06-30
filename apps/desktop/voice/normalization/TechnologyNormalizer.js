'use strict';

const DictionaryNormalizer = require('./DictionaryNormalizer');

/**
 * Purpose: Normalizes deterministic technology terminology.
 * Responsibility: Convert technology variants such as "git hub", "wifi", "usb c", and "node js" to canonical forms.
 * Dependencies: DictionaryNormalizer for centralized technology mappings.
 * Pipeline position: Runs after application normalization.
 * Future extension notes: Keep technology replacements deterministic and dictionary-backed.
 */
class TechnologyNormalizer {
  /**
   * Create a technology normalizer.
   * @param {{dictionary?: object}} options Normalizer options.
   */
  constructor(options = {}) {
    this.dictionary = options.dictionary || new DictionaryNormalizer().getCategory('technologies');
  }

  /**
   * Normalize technology terms.
   * @param {string} text Input text.
   * @returns {{text: string, transformations: object[]}}
   */
  normalize(text) {
    return DictionaryNormalizer.applyDictionary(text, this.dictionary, 'technology');
  }
}

module.exports = TechnologyNormalizer;
