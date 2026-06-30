'use strict';

const { VoiceIntegrationConfigurationError } = require('./VoiceIntegrationErrors');

const DEFAULT_CONFIGURATION = Object.freeze({
  enabled: true,
  trimInput: true,
  maximumCommandLength: 1000,
  autoTransitionSession: true,
  dispatchTimeoutMs: 30000,
  loggingEnabled: true,
  metricsEnabled: true
});

/**
 * Purpose: Centralizes Voice assistant integration configuration.
 * Responsibility: Validate adapter limits and bridge coordination settings.
 * Dependencies: VoiceIntegrationErrors for structured failures.
 * Lifecycle: Created by adapter, dispatcher, bridge, or coordinator during construction.
 * Future extension notes: Do not add assistant behavior toggles here; the assistant remains the single source of behavior.
 */
class VoiceIntegrationConfiguration {
  /**
   * Create immutable integration configuration.
   * @param {object} options Partial configuration.
   */
  constructor(options = {}) {
    const merged = { ...DEFAULT_CONFIGURATION, ...(options || {}) };
    VoiceIntegrationConfiguration.validate(merged);
    this.options = Object.freeze(merged);
    Object.assign(this, this.options);
    Object.freeze(this);
  }

  /**
   * Validate configuration.
   * @param {object} config Candidate config.
   * @returns {true}
   */
  static validate(config) {
    if (!Number.isInteger(config.maximumCommandLength) || config.maximumCommandLength < 1) {
      throw new VoiceIntegrationConfigurationError('Voice command length limit is invalid.');
    }
    if (!Number.isFinite(config.dispatchTimeoutMs) || config.dispatchTimeoutMs < 0) {
      throw new VoiceIntegrationConfigurationError('Voice dispatch timeout is invalid.');
    }
    return true;
  }

  /**
   * Return JSON-safe configuration.
   * @returns {object}
   */
  toJSON() {
    return { ...this.options };
  }
}

VoiceIntegrationConfiguration.DEFAULTS = DEFAULT_CONFIGURATION;

module.exports = VoiceIntegrationConfiguration;
