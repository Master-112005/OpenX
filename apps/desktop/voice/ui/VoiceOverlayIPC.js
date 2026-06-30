'use strict';

const { IPCFailure } = require('./VoiceUIErrors');

const ALLOWED_OPERATIONS = Object.freeze({
  SHOW_OVERLAY: 'showOverlay',
  HIDE_OVERLAY: 'hideOverlay',
  UPDATE_TRANSCRIPT: 'updateTranscript',
  UPDATE_STATE: 'updateState',
  DISPLAY_ERROR: 'displayError'
});

/**
 * Purpose: Provides a minimal Voice overlay IPC boundary.
 * Responsibility: Send presentation-only events to the renderer and reject unrelated operations.
 * Dependencies: Optional Electron webContents-compatible object.
 * Lifecycle: Owned by VoiceWindowController.
 * Future extension notes: Keep this allowlist small; never expose STT, microphone, NLP, or automation operations.
 */
class VoiceOverlayIPC {
  /**
   * Create IPC helper.
   * @param {{channel?: string, webContents?: object, logger?: object}} options IPC options.
   */
  constructor(options = {}) {
    this.channel = options.channel || 'voiceOverlay:event';
    this.webContents = options.webContents || null;
    this.logger = options.logger || null;
  }

  /**
   * Update target webContents.
   * @param {object} webContents Electron webContents-like object.
   * @returns {VoiceOverlayIPC}
   */
  attach(webContents) {
    this.webContents = webContents || null;
    return this;
  }

  /**
   * Send an allowed UI operation.
   * @param {string} operation Operation name.
   * @param {object} payload Operation payload.
   * @returns {{sent: boolean, operation: string, payload: object}}
   */
  send(operation, payload = {}) {
    if (!Object.values(ALLOWED_OPERATIONS).includes(operation)) {
      throw new IPCFailure('Voice overlay IPC operation is not allowed.', { details: { operation } });
    }
    if (!this.webContents || typeof this.webContents.send !== 'function') {
      throw new IPCFailure('Voice overlay renderer is unavailable.', { code: 'RendererUnavailable' });
    }
    const message = Object.freeze({ operation, payload: Object.freeze({ ...payload }) });
    this.webContents.send(this.channel, message);
    this._log('IPC Sent', message);
    return { sent: true, operation, payload: message.payload };
  }

  /**
   * Return operation constants.
   * @returns {object}
   */
  static get OPERATIONS() {
    return ALLOWED_OPERATIONS;
  }

  /**
   * Write structured IPC logs.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Voice UI] ${message}`, metadata);
    }
  }
}

module.exports = VoiceOverlayIPC;
