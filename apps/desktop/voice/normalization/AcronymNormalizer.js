'use strict';

const DictionaryNormalizer = require('./DictionaryNormalizer');

/**
 * Purpose: Normalizes deterministic acronyms and spoken acronym variants.
 * Responsibility: Convert terms such as "c p u", "api", and "json" to canonical acronym casing.
 * Dependencies: DictionaryNormalizer for centralized acronym mappings.
 * Pipeline position: Runs after technology normalization.
 * Future extension notes: Keep acronym mapping deterministic; no context-dependent acronym expansion here.
 */
class AcronymNormalizer {
  /**
   * Create an acronym normalizer.
   * @param {{dictionary?: object}} options Normalizer options.
   */
  constructor(options = {}) {
    this.dictionary = options.dictionary || new DictionaryNormalizer().getCategory('acronyms');
  }

  /**
   * Normalize acronyms.
   * @param {string} text Input text.
   * @returns {{text: string, transformations: object[]}}
   */
  normalize(text) {
    return DictionaryNormalizer.applyDictionary(text, this.dictionary, 'acronym');
  }
}

module.exports = AcronymNormalizer;
