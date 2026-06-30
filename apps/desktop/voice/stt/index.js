'use strict';

/**
 * Purpose: Public package boundary for OpenX Speech-to-Text.
 * Responsibility: Export the generic STTEngine facade and stable transcript/config/event/error types while keeping Parakeet and Sherpa internal.
 * Dependencies: STT package modules only.
 * Lifecycle: VoiceSessionManager imports STTEngine from this boundary and never imports SherpaRuntime.
 * Future extension notes: Do not export runtime adapters from this package index; replaceable engines must remain behind STTEngine.
 */

const STTEngine = require('./STTEngine');
const STTConfiguration = require('./STTConfiguration');
const TranscriptSegment = require('./TranscriptSegment');
const TranscriptResult = require('./TranscriptResult');
const STT_EVENTS = require('./STTEvents');
const STTErrors = require('./STTErrors');

module.exports = {
  STTEngine,
  STTConfiguration,
  TranscriptSegment,
  TranscriptResult,
  STT_EVENTS,
  ...STTErrors
};
