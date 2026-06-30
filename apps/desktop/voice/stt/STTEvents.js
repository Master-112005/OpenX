'use strict';

/**
 * Purpose: Centralizes Speech-to-Text lifecycle and streaming event names.
 * Responsibility: Provide stable constants for model loading, decoder state, partial/final transcripts, and STT errors.
 * Dependencies: None.
 * Lifecycle: Events are emitted by STTEngine and internal model strategies during streaming recognition.
 * Future extension notes: Future UI or diagnostics should subscribe through these constants without knowing engine/runtime details.
 */

const STT_EVENTS = Object.freeze({
  STT_INITIALIZED: 'stt.initialized',
  MODEL_LOADING: 'stt.model.loading',
  MODEL_READY: 'stt.model.ready',
  DECODING_STARTED: 'stt.decoding.started',
  PARTIAL_RESULT: 'stt.partial.result',
  FINAL_RESULT: 'stt.final.result',
  DECODING_STOPPED: 'stt.decoding.stopped',
  MODEL_UNLOADED: 'stt.model.unloaded',
  STT_CANCELLED: 'stt.cancelled',
  STT_RESET: 'stt.reset',
  STT_ERROR: 'stt.error'
});

module.exports = STT_EVENTS;
