'use strict';

/**
 * Purpose: Centralizes transcript normalization event names.
 * Responsibility: Provide stable constants for transcript receipt, cleaning, validation, completion, and errors.
 * Dependencies: None.
 * Pipeline position: Shared by the TranscriptProcessor and future observers.
 * Future extension notes: UI or diagnostics can subscribe later without changing the normalization pipeline.
 */

const NORMALIZATION_EVENTS = Object.freeze({
  TRANSCRIPT_RECEIVED: 'normalization.transcript.received',
  TEXT_CLEANED: 'normalization.text.cleaned',
  NORMALIZATION_STARTED: 'normalization.started',
  NORMALIZATION_COMPLETED: 'normalization.completed',
  VALIDATION_PASSED: 'normalization.validation.passed',
  VALIDATION_FAILED: 'normalization.validation.failed',
  NORMALIZED_TRANSCRIPT_READY: 'normalization.transcript.ready',
  NORMALIZATION_ERROR: 'normalization.error'
});

module.exports = NORMALIZATION_EVENTS;
