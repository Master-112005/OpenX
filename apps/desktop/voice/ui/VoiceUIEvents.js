'use strict';

/**
 * Purpose: Defines stable Voice UI event names.
 * Responsibility: Provide analytics-friendly event constants for the overlay presentation layer.
 * Dependencies: None.
 * Lifecycle: Emitted by VoiceOverlay, VoiceWindowController, TranscriptPublisher, and animation helpers.
 * Future extension notes: Add UI-only events here without importing voice recognition or assistant routing modules.
 */
const VOICE_UI_EVENTS = Object.freeze({
  OVERLAY_OPENED: 'voice.ui.overlay.opened',
  OVERLAY_CLOSED: 'voice.ui.overlay.closed',
  TRANSCRIPT_UPDATED: 'voice.ui.transcript.updated',
  VOICE_STATE_CHANGED: 'voice.ui.state.changed',
  ERROR_DISPLAYED: 'voice.ui.error.displayed',
  EXECUTION_STARTED: 'voice.ui.execution.started',
  EXECUTION_COMPLETED: 'voice.ui.execution.completed',
  ASSISTANT_RESULT_DISPLAYED: 'voice.ui.assistant.result.displayed',
  ANIMATION_TRIGGERED: 'voice.ui.animation.triggered',
  CANCELLATION_REQUESTED: 'voice.ui.cancellation.requested',
  THEME_CHANGED: 'voice.ui.theme.changed',
  ACCESSIBILITY_UPDATED: 'voice.ui.accessibility.updated'
});

module.exports = VOICE_UI_EVENTS;
