'use strict';

const { AccessibilityFailure } = require('./VoiceUIErrors');

/**
 * Purpose: Produces accessibility metadata for the Voice overlay.
 * Responsibility: Support keyboard use, screen readers, reduced motion, high contrast, large text, and focus restoration metadata.
 * Dependencies: None.
 * Lifecycle: Applied to every rendered overlay state.
 * Future extension notes: Native focus handoff can plug into captureFocus and restoreFocus.
 */
class VoiceAccessibility {
  /**
   * Create accessibility helper.
   * @param {{reducedMotion?: boolean, highContrast?: boolean, largeText?: boolean, restoreFocus?: boolean}} options Accessibility options.
   */
  constructor(options = {}) {
    this.options = {
      reducedMotion: options.reducedMotion === true,
      highContrast: options.highContrast === true,
      largeText: options.largeText === true,
      restoreFocus: options.restoreFocus !== false
    };
    this.previousFocus = null;
  }

  /**
   * Apply accessibility metadata to a view model.
   * @param {object} viewModel State view model.
   * @returns {object}
   */
  apply(viewModel = {}) {
    if (!viewModel || typeof viewModel !== 'object') {
      throw new AccessibilityFailure('Voice accessibility view model is invalid.');
    }
    return Object.freeze({
      role: 'status',
      live: viewModel.state === 'LISTENING' ? 'polite' : 'assertive',
      label: viewModel.ariaLabel || viewModel.statusText || 'Voice status',
      tabIndex: 0,
      reducedMotion: this.options.reducedMotion,
      highContrast: this.options.highContrast,
      largeText: this.options.largeText,
      restoreFocus: this.options.restoreFocus
    });
  }

  /**
   * Store a focus token for later restoration.
   * @param {object|string|null} focusToken Focus token.
   * @returns {object|string|null}
   */
  captureFocus(focusToken) {
    this.previousFocus = focusToken || null;
    return this.previousFocus;
  }

  /**
   * Return and clear the previous focus token.
   * @returns {object|string|null}
   */
  restoreFocus() {
    const focus = this.previousFocus;
    this.previousFocus = null;
    return focus;
  }
}

module.exports = VoiceAccessibility;
