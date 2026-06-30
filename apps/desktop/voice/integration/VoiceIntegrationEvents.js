'use strict';

/**
 * Purpose: Defines Voice-to-assistant integration event names.
 * Responsibility: Provide stable coordination events without exposing voice internals to the assistant.
 * Dependencies: None.
 * Lifecycle: Emitted by the adapter, bridge, dispatcher, coordinator, and response handler.
 * Future extension notes: Keep events at the integration boundary; do not mirror NLP, router, or automation events here.
 */
const VOICE_INTEGRATION_EVENTS = Object.freeze({
  VOICE_COMMAND_READY: 'voice.integration.command.ready',
  VOICE_COMMAND_DISPATCHED: 'voice.integration.command.dispatched',
  ASSISTANT_STARTED: 'voice.integration.assistant.started',
  ASSISTANT_COMPLETED: 'voice.integration.assistant.completed',
  ASSISTANT_FAILED: 'voice.integration.assistant.failed',
  VOICE_RESPONSE_READY: 'voice.integration.response.ready',
  VOICE_EXECUTION_FINISHED: 'voice.integration.execution.finished',
  VOICE_COMMAND_CANCELLED: 'voice.integration.command.cancelled',
  TTS_STARTED: 'voice.integration.tts.started',
  TTS_COMPLETED: 'voice.integration.tts.completed',
  TTS_CANCELLED: 'voice.integration.tts.cancelled',
  TTS_FAILED: 'voice.integration.tts.failed'
});

module.exports = VOICE_INTEGRATION_EVENTS;
