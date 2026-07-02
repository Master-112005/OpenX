'use strict';

const { VoiceUIError } = require('./VoiceUIErrors');

const DEFAULT_CONFIGURATION = Object.freeze({
  overlayEnabled: true,
  size: Object.freeze({ width: 256, height: 50 }),
  mediumSize: Object.freeze({ width: 320, height: 148 }),
  expandedSize: Object.freeze({ width: 360, height: 360 }),
  position: Object.freeze({ horizontal: 'center', vertical: 'top', yOffset: 12 }),
  animationDurationMs: 420,
  fadeDurationMs: 160,
  autoCloseDelayMs: 900,
  transcriptFont: 'Segoe UI',
  theme: Object.freeze({
    mode: 'dark',
    glass: true,
    accentColor: '#4488ff',
    backgroundColor: 'rgba(17, 22, 36, 0.82)',
    textColor: '#f4f7ff',
    mutedColor: 'rgba(244, 247, 255, 0.68)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    blur: 34
  }),
  accessibility: Object.freeze({
    reducedMotion: false,
    highContrast: false,
    largeText: false,
    restoreFocus: true
  }),
  cancellation: Object.freeze({
    escape: true,
    shortcut: true,
    outsideClick: false
  })
});

/**
 * Purpose: Centralizes Voice UI runtime settings.
 * Responsibility: Validate overlay sizing, animation timing, theme, and accessibility defaults.
 * Dependencies: VoiceUIErrors for structured configuration failures.
 * Lifecycle: Created once by VoiceOverlay or VoiceWindowController and treated as immutable.
 * Future extension notes: Add renderer settings here instead of hardcoding them in UI classes.
 */
class VoiceConfiguration {
  /**
   * Create immutable Voice UI configuration.
   * @param {object} options Partial configuration.
   */
  constructor(options = {}) {
    const merged = VoiceConfiguration.merge(DEFAULT_CONFIGURATION, options);
    VoiceConfiguration.validate(merged);
    this.options = Object.freeze(merged);
    Object.assign(this, this.options);
    Object.freeze(this);
  }

  /**
   * Deep merge configuration objects.
   * @param {object} base Base configuration.
   * @param {object} overrides Partial overrides.
   * @returns {object}
   */
  static merge(base, overrides = {}) {
    const result = { ...base };
    for (const [key, value] of Object.entries(overrides || {})) {
      if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && base[key]
        && typeof base[key] === 'object'
        && !Array.isArray(base[key])
      ) {
        result[key] = VoiceConfiguration.merge(base[key], value);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Validate configuration values.
   * @param {object} config Candidate configuration.
   * @returns {true}
   */
  static validate(config) {
    if (!Number.isInteger(config.size?.width) || config.size.width < 220) {
      throw new VoiceUIError('Voice overlay width is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    if (!Number.isInteger(config.size?.height) || config.size.height < 44) {
      throw new VoiceUIError('Voice overlay height is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    if (!Number.isInteger(config.expandedSize?.width) || config.expandedSize.width < config.size.width) {
      throw new VoiceUIError('Voice overlay expanded width is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    if (!Number.isInteger(config.expandedSize?.height) || config.expandedSize.height < config.size.height) {
      throw new VoiceUIError('Voice overlay expanded height is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    if (!Number.isInteger(config.mediumSize?.width) || config.mediumSize.width < config.size.width || config.mediumSize.width > config.expandedSize.width) {
      throw new VoiceUIError('Voice overlay medium width is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    if (!Number.isInteger(config.mediumSize?.height) || config.mediumSize.height < config.size.height || config.mediumSize.height > config.expandedSize.height) {
      throw new VoiceUIError('Voice overlay medium height is invalid.', { code: 'InvalidVoiceUIConfiguration' });
    }
    for (const field of ['animationDurationMs', 'fadeDurationMs', 'autoCloseDelayMs']) {
      if (!Number.isFinite(config[field]) || config[field] < 0) {
        throw new VoiceUIError(`Voice UI ${field} is invalid.`, { code: 'InvalidVoiceUIConfiguration' });
      }
    }
    return true;
  }

  /**
   * Return JSON-safe configuration.
   * @returns {object}
   */
  toJSON() {
    return JSON.parse(JSON.stringify(this.options));
  }
}

VoiceConfiguration.DEFAULTS = DEFAULT_CONFIGURATION;

module.exports = VoiceConfiguration;
