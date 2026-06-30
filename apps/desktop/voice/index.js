'use strict';

/**
 * Purpose: Public entry point for the OpenX Voice subsystem.
 * Responsibility: Export Phase 1 architecture surfaces while keeping internal file paths encapsulated.
 * Dependencies: Voice subsystem modules only.
 * Future implementation notes: Production code should import Voice types from this file instead of deep internal paths.
 */

const VoiceSessionManager = require('./session/VoiceSessionManager');
const VoiceSession = require('./session/VoiceSession');
const VoiceStateMachine = require('./session/VoiceStateMachine');
const { SESSION_EVENTS, VOICE_ERROR_TYPES } = require('./session/SessionEvents');

const AudioCapture = require('./audio/AudioCapture');
const AudioDeviceManager = require('./audio/AudioDeviceManager');
const AudioBuffer = require('./audio/AudioBuffer');
const AudioPermissions = require('./audio/AudioPermissions');

const AudioPipeline = require('./preprocessing/AudioPipeline');
const VoiceActivityDetector = require('./preprocessing/VoiceActivityDetector');
const RNNoiseProcessor = require('./preprocessing/RNNoiseProcessor');

const STTEngine = require('./stt/STTEngine');
const ParakeetEngine = require('./stt/ParakeetEngine');
const SherpaRuntime = require('./stt/SherpaRuntime');
const TranscriptAssembler = require('./stt/TranscriptAssembler');

const TranscriptNormalizer = require('./normalization/TranscriptNormalizer');
const VoiceOverlay = require('./ui/VoiceOverlay');
const TranscriptPublisher = require('./ui/TranscriptPublisher');
const VoiceSettings = require('./config/VoiceSettings');
const VoiceLogger = require('./diagnostics/VoiceLogger');
const VoiceMetrics = require('./diagnostics/VoiceMetrics');

module.exports = {
  VoiceSessionManager,
  VoiceSession,
  VoiceStateMachine,
  SESSION_EVENTS,
  VOICE_ERROR_TYPES,
  AudioCapture,
  AudioDeviceManager,
  AudioBuffer,
  AudioPermissions,
  AudioPipeline,
  VoiceActivityDetector,
  RNNoiseProcessor,
  STTEngine,
  ParakeetEngine,
  SherpaRuntime,
  TranscriptAssembler,
  TranscriptNormalizer,
  VoiceOverlay,
  TranscriptPublisher,
  VoiceSettings,
  VoiceLogger,
  VoiceMetrics
};
