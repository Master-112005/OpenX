'use strict';

/**
 * Purpose: Centralizes Audio Layer event names.
 * Responsibility: Provide stable event constants for capture, buffering, permissions, and device changes.
 * Dependencies: None.
 * Thread ownership: Event names are immutable and safe to share across future asynchronous capture code.
 * Future integration notes: VoiceSessionManager and future UI layers should subscribe to these constants instead of duplicating strings.
 */

const AUDIO_EVENTS = Object.freeze({
  AUDIO_INITIALIZED: 'audio.initialized',
  AUDIO_STARTED: 'audio.started',
  AUDIO_STOPPED: 'audio.stopped',
  AUDIO_PAUSED: 'audio.paused',
  AUDIO_RESUMED: 'audio.resumed',
  AUDIO_CLOSED: 'audio.closed',
  AUDIO_FRAME: 'audio.frame',
  AUDIO_DEVICE_CHANGED: 'audio.device.changed',
  AUDIO_DEVICE_LOST: 'audio.device.lost',
  AUDIO_DEVICE_RECONNECTED: 'audio.device.reconnected',
  AUDIO_DEFAULT_DEVICE_CHANGED: 'audio.device.default.changed',
  AUDIO_PERMISSION_GRANTED: 'audio.permission.granted',
  AUDIO_PERMISSION_DENIED: 'audio.permission.denied',
  AUDIO_PERMISSION_REVOKED: 'audio.permission.revoked',
  AUDIO_BUFFER_READY: 'audio.buffer.ready',
  AUDIO_BUFFER_FLUSHED: 'audio.buffer.flushed',
  AUDIO_ERROR: 'audio.error'
});

module.exports = AUDIO_EVENTS;
