'use strict';

const EventEmitter = require('events');
const AUDIO_EVENTS = require('./AudioEvents');
const { PermissionDeniedError } = require('./AudioErrors');

/**
 * Purpose: Centralizes microphone permission state for the Audio Layer.
 * Responsibility: Verify, report, and detect denied or revoked microphone access without invoking Electron UI prompts.
 * Dependencies: AudioEvents and AudioErrors; permission checks are injected through a provider.
 * Thread ownership: The latest permission snapshot is owned by this object.
 * Future integration notes: Windows privacy APIs or Electron permission handlers should be adapted behind the provider interface.
 */
class AudioPermissions {
  /**
   * Create a permission manager.
   * @param {{provider?: object, logger?: object}} dependencies Permission dependencies.
   */
  constructor(dependencies = {}) {
    this.provider = dependencies.provider || {};
    this.logger = dependencies.logger || null;
    this.events = new EventEmitter();
    this.lastStatus = {
      granted: false,
      state: 'unknown',
      reason: 'Microphone permission has not been checked.'
    };
    this.metrics = {
      permissionFailures: 0,
      revocations: 0
    };
  }

  /**
   * Subscribe to permission events.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioPermissions}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a permission event listener.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioPermissions}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Return current microphone permission status.
   * @returns {{granted: boolean, state: string, reason: string}}
   */
  getMicrophonePermissionStatus() {
    const status = typeof this.provider.getMicrophonePermissionStatus === 'function'
      ? this.provider.getMicrophonePermissionStatus()
      : this.lastStatus;
    return this.reportPermissionState(status);
  }

  /**
   * Verify that microphone access is granted.
   * @returns {{granted: boolean, state: string, reason: string}}
   */
  verifyMicrophonePermission() {
    const status = this.getMicrophonePermissionStatus();
    if (!status.granted) {
      this.metrics.permissionFailures += 1;
      this.events.emit(AUDIO_EVENTS.AUDIO_PERMISSION_DENIED, status);
      this._log('Permission Denied', status);
      throw new PermissionDeniedError(status.reason || 'Microphone permission denied.', { details: status });
    }
    this.events.emit(AUDIO_EVENTS.AUDIO_PERMISSION_GRANTED, status);
    this._log('Permission Granted', status);
    return status;
  }

  /**
   * Request permission through an injected provider only.
   * @returns {{granted: boolean, requested: boolean, state: string, reason: string}}
   */
  requestMicrophonePermission() {
    if (typeof this.provider.requestMicrophonePermission !== 'function') {
      return { ...this.lastStatus, requested: false };
    }
    const status = this.provider.requestMicrophonePermission();
    return { ...this.reportPermissionState(status), requested: true };
  }

  /**
   * Store and emit a normalized permission state.
   * @param {object} status Permission status.
   * @returns {{granted: boolean, state: string, reason: string}}
   */
  reportPermissionState(status = {}) {
    const previousGranted = this.lastStatus.granted;
    this.lastStatus = {
      granted: Boolean(status.granted),
      state: String(status.state || (status.granted ? 'granted' : 'denied')),
      reason: String(status.reason || '')
    };
    if (previousGranted && !this.lastStatus.granted) {
      this.metrics.revocations += 1;
      this.events.emit(AUDIO_EVENTS.AUDIO_PERMISSION_REVOKED, this.lastStatus);
    }
    return { ...this.lastStatus };
  }

  /**
   * Return whether the latest state is denied.
   * @returns {boolean}
   */
  detectDeniedAccess() {
    return !this.getMicrophonePermissionStatus().granted;
  }

  /**
   * Return whether access has been revoked since the previous granted state.
   * @returns {boolean}
   */
  detectRevokedPermission() {
    const before = this.lastStatus.granted;
    const after = this.getMicrophonePermissionStatus().granted;
    return before && !after;
  }

  /**
   * Return permission metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Write a structured audio log when a logger is provided.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Audio] ${message}`, metadata);
    }
  }
}

module.exports = AudioPermissions;
