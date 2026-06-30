'use strict';

const DictionaryNormalizer = require('./DictionaryNormalizer');

/**
 * Purpose: Normalizes deterministic command terminology without intent recognition.
 * Responsibility: Apply command phrase casing/replacement rules such as "shut down", "log in", and "sign in".
 * Dependencies: DictionaryNormalizer for centralized replacements.
 * Pipeline position: Runs after general transcript normalization.
 * Future extension notes: Do not add command classification or routing here.
 */
class CommandNormalizer {
  /**
   * Create a command normalizer.
   * @param {{dictionary?: object}} options Normalizer options.
   */
  constructor(options = {}) {
    this.dictionary = options.dictionary || new DictionaryNormalizer().getCategory('commands');
  }

  /**
   * Normalize command terminology.
   * @param {string} text Input text.
   * @returns {{text: string, transformations: object[]}}
   */
  normalize(text) {
    return DictionaryNormalizer.applyDictionary(text, this.dictionary, 'command');
  }
}

module.exports = CommandNormalizer;
