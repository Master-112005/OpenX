'use strict';

/**
 * Purpose: Defines the future Voice diagnostics logging boundary.
 * Responsibility: Provide a no-op logger interface for Voice-specific messages.
 * Dependencies: None in Phase 1.
 * Future implementation notes: This can later adapt to OpenX Logger without coupling Voice modules to it.
 */
class VoiceLogger {
  /**
   * No-op info log placeholder.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  info(message, metadata = {}) {
    return { logged: false, message: String(message || ''), metadata: { ...metadata } };
  }

  /**
   * No-op warning log placeholder.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  warn(message, metadata = {}) {
    return { logged: false, message: String(message || ''), metadata: { ...metadata } };
  }

  /**
   * No-op error log placeholder.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  error(message, metadata = {}) {
    return { logged: false, message: String(message || ''), metadata: { ...metadata } };
  }
}

module.exports = VoiceLogger;
