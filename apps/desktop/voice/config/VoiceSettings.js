'use strict';

/**
 * Purpose: Centralizes default Voice subsystem configuration.
 * Responsibility: Provide organized immutable defaults only.
 * Dependencies: None.
 * Future implementation notes: Runtime settings can merge with this object without adding processing logic here.
 */

const VoiceSettings = Object.freeze({
  general: Object.freeze({
    enabled: false,
    inputSource: 'future-voice'
  }),
  audio: Object.freeze({
    sampleRate: 16000,
    channels: 1,
    deviceId: ''
  }),
  recognition: Object.freeze({
    engine: 'none',
    language: 'en-US',
    partialResults: false
  }),
  session: Object.freeze({
    timeouts: Object.freeze({
      initializationMs: 10000,
      listeningMs: 30000,
      processingMs: 15000,
      executionMs: 30000,
      overallMs: 60000
    })
  }),
  ui: Object.freeze({
    overlayEnabled: false,
    showPartialTranscript: false
  }),
  diagnostics: Object.freeze({
    loggingEnabled: false,
    metricsEnabled: false
  })
});

module.exports = VoiceSettings;
