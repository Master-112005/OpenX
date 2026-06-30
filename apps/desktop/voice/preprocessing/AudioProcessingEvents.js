'use strict';

/**
 * Purpose: Centralizes Audio Processing Layer event names.
 * Responsibility: Provide stable constants for RNNoise, VAD, pipeline, and processed-frame events.
 * Dependencies: None.
 * Thread ownership: Constants are immutable and safe for future asynchronous processing.
 * Future integration notes: Future STT and UI layers should subscribe through these names instead of duplicating strings.
 */

const AUDIO_PROCESSING_EVENTS = Object.freeze({
  PROCESSING_INITIALIZED: 'audio.processing.initialized',
  PROCESSING_SHUTDOWN: 'audio.processing.shutdown',
  RNNOISE_INITIALIZED: 'audio.processing.rnnoise.initialized',
  RNNOISE_FAILED: 'audio.processing.rnnoise.failed',
  VAD_INITIALIZED: 'audio.processing.vad.initialized',
  VAD_FAILED: 'audio.processing.vad.failed',
  FRAME_PROCESSED: 'audio.processing.frame.processed',
  SPEECH_STARTED: 'audio.processing.speech.started',
  SPEECH_ENDED: 'audio.processing.speech.ended',
  SILENCE_DETECTED: 'audio.processing.silence.detected',
  ENDPOINT_DETECTED: 'audio.processing.endpoint.detected',
  PIPELINE_RESET: 'audio.processing.pipeline.reset',
  PROCESSING_ERROR: 'audio.processing.error'
});

module.exports = AUDIO_PROCESSING_EVENTS;
