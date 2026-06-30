'use strict';

/**
 * Purpose: Defines the future Voice overlay presentation boundary.
 * Responsibility: Keep UI lifecycle concepts separate from Electron windows and IPC.
 * Dependencies: None in Phase 1.
 * Future implementation notes: A renderer or native overlay can later implement this interface.
 */
class VoiceOverlay {
  /**
   * Placeholder show method.
   * @returns {{visible: boolean}}
   */
  show() {
    return { visible: false };
  }

  /**
   * Placeholder hide method.
   * @returns {{visible: boolean}}
   */
  hide() {
    return { visible: false };
  }

  /**
   * Placeholder status update.
   * @param {string} state Future voice state.
   * @returns {{updated: boolean, state: string}}
   */
  updateState(state) {
    return { updated: false, state: String(state || '') };
  }
}

module.exports = VoiceOverlay;
