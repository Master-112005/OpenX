'use strict';

/**
 * Purpose: Centralizes Voice subsystem event and error names.
 * Responsibility: Provide stable string constants for session orchestration.
 * Dependencies: None.
 * Future implementation notes: Event emitters and diagnostics should import these constants instead of duplicating strings.
 */

const SESSION_EVENTS = Object.freeze({
  VOICE_SESSION_CREATED: 'voice.session.created',
  VOICE_SESSION_INITIALIZED: 'voice.session.initialized',
  VOICE_SESSION_STARTED: 'voice.session.started',
  VOICE_SESSION_FINISHED: 'voice.session.finished',
  VOICE_SESSION_CANCELLED: 'voice.session.cancelled',
  VOICE_SESSION_CLOSED: 'voice.session.closed',
  VOICE_STATE_CHANGED: 'voice.state.changed',
  VOICE_TIMEOUT: 'voice.timeout',
  VOICE_ERROR: 'voice.error'
});

const VOICE_ERROR_TYPES = Object.freeze({
  MICROPHONE_UNAVAILABLE: 'MicrophoneUnavailable',
  PERMISSION_DENIED: 'PermissionDenied',
  RECOGNITION_FAILED: 'RecognitionFailed',
  INVALID_TRANSITION: 'InvalidTransition',
  SESSION_BUSY: 'SessionBusy',
  TIMEOUT: 'Timeout',
  SESSION_CANCELLED: 'SessionCancelled'
});

module.exports = {
  SESSION_EVENTS,
  VOICE_ERROR_TYPES
};
