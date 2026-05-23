const Normalizer = require('../../shared/index').Normalizer;
const EntityExtractor = require('../entities/index');
const {
  DOMAIN_VOCABULARY,
  FILLER_WORDS
} = require('./constants');
const {
  buildBigrams,
  preprocessCommand
} = require('./preprocessor');
const {
  scorePreparedPattern
} = require('./scorer');

class NlpProcessor {
  constructor(intentRegistry) {
    this.intentRegistry = intentRegistry;
    this.vocabulary = this._buildVocabulary();
  }

  _buildVocabulary() {
    const tokens = new Set(DOMAIN_VOCABULARY);
    const aliasBuckets = [
      EntityExtractor.APP_ALIASES || {},
      EntityExtractor.FOLDER_ALIASES || {}
    ];
    const intents = this.intentRegistry?.getAll?.() || [];

    aliasBuckets.forEach(bucket => {
      Object.keys(bucket).forEach(alias => {
        Normalizer.tokenize(alias).forEach(token => tokens.add(token));
      });
      Object.values(bucket).forEach(alias => {
        Normalizer.tokenize(alias).forEach(token => tokens.add(token));
      });
    });

    intents.forEach(intent => {
      [intent.id, intent.action, intent.description, ...(intent.patterns || [])]
        .filter(Boolean)
        .forEach(entry => {
          Normalizer.tokenize(entry).forEach(token => tokens.add(token));
        });
    });

    return Array.from(tokens);
  }

  _correctToken(token) {
    if (!token || token.length <= 2 || /^\d+$/.test(token)) {
      return token;
    }

    const match = Normalizer.findClosestOption(token, this.vocabulary, {
      minSimilarity: token.length >= 6 ? 0.64 : 0.74,
      maxDistance: token.length >= 7 ? 2 : 1
    });

    return match ? match.normalizedMatch : token;
  }

  prepare(text) {
    const preprocessed = preprocessCommand(text || '');
    const normalized = preprocessed.normalizedText;
    const normalizedTokens = preprocessed.tokens;
    const correctedTokens = normalizedTokens.map(token => this._correctToken(token));
    const correctedText = correctedTokens.join(' ').trim();
    const intentTokens = correctedTokens.filter(token => !FILLER_WORDS.has(token));
    const intentText = intentTokens.join(' ').trim();
    const bigrams = buildBigrams(correctedTokens);
    const intentBigrams = buildBigrams(intentTokens);

    return {
      normalizedText: normalized,
      correctedText,
      intentText,
      tokens: correctedTokens,
      intentTokens,
      bigrams,
      intentBigrams
    };
  }

  scorePattern(preparedInput, pattern) {
    const patternPrepared = this.prepare(pattern);
    return scorePreparedPattern(preparedInput, patternPrepared);
  }
}

module.exports = NlpProcessor;
