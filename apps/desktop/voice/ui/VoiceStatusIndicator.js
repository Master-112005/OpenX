'use strict';

/**
 * Purpose: Builds compact status indicator metadata for the Voice overlay.
 * Responsibility: Convert rendered states into icon, label, class, and activity flags.
 * Dependencies: None.
 * Lifecycle: Used by VoiceOverlay before sending UI updates to the renderer.
 * Future extension notes: Keep icon selection declarative and independent of business logic.
 */
class VoiceStatusIndicator {
  /**
   * Render status indicator metadata.
   * @param {object} viewModel State renderer output.
   * @returns {{icon: string, label: string, active: boolean, className: string, ariaLabel: string}}
   */
  render(viewModel = {}) {
    const state = String(viewModel.state || 'HIDDEN').toLowerCase();
    return Object.freeze({
      icon: String(viewModel.icon || 'dot'),
      label: String(viewModel.statusText || ''),
      active: ['listening', 'processing', 'executing'].includes(state),
      className: `voice-status voice-status-${state}`,
      ariaLabel: String(viewModel.ariaLabel || viewModel.statusText || 'Voice status')
    });
  }
}

module.exports = VoiceStatusIndicator;
