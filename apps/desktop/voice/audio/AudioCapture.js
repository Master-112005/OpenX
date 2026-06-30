'use strict';

/**
 * Purpose: Defines the future audio capture boundary.
 * Responsibility: Expose capture lifecycle placeholders without touching microphone APIs.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Platform-specific microphone access belongs behind this interface in a later phase.
 */
class AudioCapture {
  /**
   * Prepare the capture boundary without opening devices.
   * @param {object} settings Future audio settings.
   * @returns {{ready: boolean, settings: object}}
   */
  configure(settings = {}) {
    return { ready: false, settings: { ...settings } };
  }

  /**
   * Placeholder start method.
   * @throws {Error} Always not implemented in Phase 1.
   */
  start() {
    throw new Error('Audio capture is not implemented in Phase 1.');
  }

  /**
   * Placeholder stop method.
   * @returns {{stopped: boolean}}
   */
  stop() {
    return { stopped: false };
  }

  /**
   * Return passive capture status.
   * @returns {{available: boolean, capturing: boolean}}
   */
  getStatus() {
    return { available: false, capturing: false };
  }
}

module.exports = AudioCapture;
