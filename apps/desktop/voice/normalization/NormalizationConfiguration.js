'use strict';

const { ConfigurationError } = require('./NormalizationErrors');

const DEFAULT_NORMALIZATION_CONFIGURATION = Object.freeze({
  normalizationEnabled: true,
  applicationNormalization: true,
  technologyNormalization: true,
  acronymNormalization: true,
  dictionaryReplacement: true,
  capitalizationRules: true,
  validationEnabled: true,
  loggingEnabled: true,
  removeFillers: true,
  removeRepeatedWords: true,
  maximumTranscriptLength: 1000,
  confidenceThreshold: 0
});

/**
 * Purpose: Owns transcript normalization configuration.
 * Responsibility: Validate and expose normalization, dictionary, capitalization, validation, logging, and transcript-length settings.
 * Dependencies: NormalizationErrors for configuration failures.
 * Pipeline position: Created before TranscriptProcessor builds the normalization pipeline.
 * Future extension notes: User settings may merge here without changing individual normalizer classes.
 */
class NormalizationConfiguration {
  /**
   * Create immutable normalization configuration.
   * @param {object} options Configuration overrides.
   */
  constructor(options = {}) {
    const merged = { ...DEFAULT_NORMALIZATION_CONFIGURATION, ...options };
    NormalizationConfiguration.validate(merged);
    this.normalizationEnabled = Boolean(merged.normalizationEnabled);
    this.applicationNormalization = Boolean(merged.applicationNormalization);
    this.technologyNormalization = Boolean(merged.technologyNormalization);
    this.acronymNormalization = Boolean(merged.acronymNormalization);
    this.dictionaryReplacement = Boolean(merged.dictionaryReplacement);
    this.capitalizationRules = Boolean(merged.capitalizationRules);
    this.validationEnabled = Boolean(merged.validationEnabled);
    this.loggingEnabled = Boolean(merged.loggingEnabled);
    this.removeFillers = Boolean(merged.removeFillers);
    this.removeRepeatedWords = Boolean(merged.removeRepeatedWords);
    this.maximumTranscriptLength = Number(merged.maximumTranscriptLength);
    this.confidenceThreshold = Number(merged.confidenceThreshold);
    Object.freeze(this);
  }

  /**
   * Return default configuration.
   * @returns {NormalizationConfiguration}
   */
  static defaults() {
    return new NormalizationConfiguration();
  }

  /**
   * Merge overrides into this configuration.
   * @param {object} overrides Configuration overrides.
   * @returns {NormalizationConfiguration}
   */
  merge(overrides = {}) {
    return new NormalizationConfiguration({ ...this.toJSON(), ...overrides });
  }

  /**
   * Validate configuration values.
   * @param {object} config Candidate configuration.
   * @returns {true}
   */
  static validate(config = {}) {
    if (!Number.isFinite(Number(config.maximumTranscriptLength)) || Number(config.maximumTranscriptLength) <= 0) {
      throw new ConfigurationError('Maximum transcript length must be a positive number.');
    }
    if (!Number.isFinite(Number(config.confidenceThreshold)) || Number(config.confidenceThreshold) < 0 || Number(config.confidenceThreshold) > 1) {
      throw new ConfigurationError('Confidence threshold must be between 0 and 1.');
    }
    return true;
  }

  /**
   * Return JSON-safe configuration.
   * @returns {object}
   */
  toJSON() {
    return {
      normalizationEnabled: this.normalizationEnabled,
      applicationNormalization: this.applicationNormalization,
      technologyNormalization: this.technologyNormalization,
      acronymNormalization: this.acronymNormalization,
      dictionaryReplacement: this.dictionaryReplacement,
      capitalizationRules: this.capitalizationRules,
      validationEnabled: this.validationEnabled,
      loggingEnabled: this.loggingEnabled,
      removeFillers: this.removeFillers,
      removeRepeatedWords: this.removeRepeatedWords,
      maximumTranscriptLength: this.maximumTranscriptLength,
      confidenceThreshold: this.confidenceThreshold
    };
  }
}

NormalizationConfiguration.DEFAULTS = DEFAULT_NORMALIZATION_CONFIGURATION;

module.exports = NormalizationConfiguration;
