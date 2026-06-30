'use strict';

const { ThemeLoadFailure } = require('./VoiceUIErrors');

/**
 * Purpose: Resolves Voice UI theme tokens from existing OpenX theme settings.
 * Responsibility: Provide glass, color, contrast, and motion tokens without duplicating renderer theme logic.
 * Dependencies: Optional settings snapshot.
 * Lifecycle: Resolved on overlay creation and settings/theme changes.
 * Future extension notes: Wire additional OpenX theme fields here as settings evolve.
 */
class VoiceTheme {
  /**
   * Create a theme resolver.
   * @param {{settings?: object, defaults?: object}} options Theme options.
   */
  constructor(options = {}) {
    this.settings = options.settings || {};
    this.defaults = options.defaults || {};
    this.currentTheme = this.resolve(options.theme || {});
  }

  /**
   * Resolve theme tokens.
   * @param {object} override Theme override.
   * @returns {object}
   */
  resolve(override = {}) {
    try {
      const chat = this.settings.chat || {};
      const system = this.settings.system || {};
      const theme = {
        mode: override.mode || system.theme || chat.themeId || this.defaults.mode || 'dark',
        glass: override.glass !== undefined ? override.glass : this.defaults.glass !== false,
        accentColor: override.accentColor || chat.accentColor || this.defaults.accentColor || '#4488ff',
        backgroundColor: override.backgroundColor || this.defaults.backgroundColor || 'rgba(17, 22, 36, 0.82)',
        textColor: override.textColor || this.defaults.textColor || '#f4f7ff',
        mutedColor: override.mutedColor || this.defaults.mutedColor || 'rgba(244, 247, 255, 0.68)',
        borderColor: override.borderColor || this.defaults.borderColor || 'rgba(255, 255, 255, 0.16)',
        blur: Number.isFinite(override.blur) ? override.blur : Number(this.defaults.blur || 34)
      };
      return Object.freeze(theme);
    } catch (error) {
      throw new ThemeLoadFailure('Voice UI theme could not be loaded.', {
        details: { error: error.message }
      });
    }
  }

  /**
   * Switch to a new theme override.
   * @param {object} theme Theme override.
   * @returns {object}
   */
  switchTheme(theme = {}) {
    this.currentTheme = this.resolve(theme);
    return this.currentTheme;
  }

  /**
   * Return CSS variable tokens for the renderer.
   * @param {object} theme Theme tokens.
   * @returns {object}
   */
  toCssVariables(theme = this.currentTheme) {
    return Object.freeze({
      '--voice-bg': theme.backgroundColor,
      '--voice-text': theme.textColor,
      '--voice-muted': theme.mutedColor,
      '--voice-accent': theme.accentColor,
      '--voice-border': theme.borderColor,
      '--voice-blur': `${theme.blur}px`
    });
  }
}

module.exports = VoiceTheme;
