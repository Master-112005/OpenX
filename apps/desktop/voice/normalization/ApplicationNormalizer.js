'use strict';

const DictionaryNormalizer = require('./DictionaryNormalizer');

/**
 * Purpose: Normalizes deterministic desktop application names.
 * Responsibility: Convert spoken application variants such as "visual studio code" and "chrome browser" to canonical names.
 * Dependencies: DictionaryNormalizer for centralized application mappings.
 * Pipeline position: Runs after command terminology normalization.
 * Future extension notes: Do not add fuzzy matching or app launching here.
 */
class ApplicationNormalizer {
  /**
   * Create an application normalizer.
   * @param {{dictionary?: object}} options Normalizer options.
   */
  constructor(options = {}) {
    this.dictionary = options.dictionary || new DictionaryNormalizer().getCategory('applications');
  }

  /**
   * Normalize application names.
   * @param {string} text Input text.
   * @returns {{text: string, transformations: object[]}}
   */
  normalize(text) {
    return DictionaryNormalizer.applyDictionary(text, this.dictionary, 'application');
  }
}

module.exports = ApplicationNormalizer;
