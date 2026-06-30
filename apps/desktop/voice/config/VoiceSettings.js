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
    bitDepth: 16,
    frameSize: 320,
    bufferSize: 100,
    latencyTargetMs: 50,
    deviceId: '',
    preferredDeviceId: '',
    autoDeviceSwitching: true,
    noiseSuppression: false,
    vadEnabled: false,
    sttReady: false,
    encoding: 'PCM',
    endianness: 'LE'
  }),
  recognition: Object.freeze({
    engine: 'none',
    language: 'en-US',
    partialResults: false,
    activeEngine: 'parakeet',
    modelPath: 'models/stt/parakeet-tdt-v3',
    modelName: 'nvidia-parakeet-tdt-v3',
    beamWidth: 4,
    decodingStrategy: 'streaming-greedy',
    partialResultIntervalMs: 120,
    confidenceThreshold: 0.01,
    streamingEnabled: true,
    gpuEnabled: false,
    cpuFallback: true
  }),
  normalization: Object.freeze({
    normalizationEnabled: true,
    applicationNormalization: true,
    technologyNormalization: true,
    acronymNormalization: true,
    dictionaryReplacement: true,
    capitalizationRules: true,
    maximumTranscriptLength: 1000,
    validationEnabled: true,
    loggingEnabled: true
  }),
  preprocessing: Object.freeze({
    pipelineEnabled: true,
    rnnoiseEnabled: true,
    rnnoiseAggressiveness: 0.6,
    vadEnabled: true,
    speechThreshold: 0.08,
    silenceThreshold: 0.025,
    minimumSpeechDurationMs: 120,
    maximumSilenceDurationMs: 500,
    endpointSilenceDurationMs: 800,
    frameSizeMs: 20,
    frameSize: 320,
    sttCompatibilityMode: 'processed-pcm'
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
    overlayEnabled: true,
    showPartialTranscript: true,
    animationDurationMs: 180,
    fadeDurationMs: 160,
    autoCloseDelayMs: 900,
    size: Object.freeze({ width: 420, height: 176 }),
    position: Object.freeze({ horizontal: 'center', vertical: 'above-center', yOffset: -96 }),
    accessibility: Object.freeze({
      reducedMotion: false,
      highContrast: false,
      largeText: false,
      restoreFocus: true
    })
  }),
  diagnostics: Object.freeze({
    loggingEnabled: false,
    metricsEnabled: false
  })
});

module.exports = VoiceSettings;
