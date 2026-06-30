'use strict';

/**
 * Purpose: Defines future audio-permission checks.
 * Responsibility: Keep permission concepts separate from capture and UI code.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Windows privacy settings and Electron permission prompts can be adapted here later.
 */
class AudioPermissions {
  /**
   * Return placeholder microphone permission status.
   * @returns {{granted: boolean, reason: string}}
   */
  getMicrophonePermissionStatus() {
    return {
      granted: false,
      reason: 'Microphone permission checks are not implemented in Phase 1.'
    };
  }

  /**
   * Placeholder permission request.
   * @returns {{granted: boolean, requested: boolean}}
   */
  requestMicrophonePermission() {
    return { granted: false, requested: false };
  }
}

module.exports = AudioPermissions;
