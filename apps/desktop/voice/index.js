'use strict';

/**
 * Purpose: Public entry point for the OpenX Voice subsystem.
 * Responsibility: Export Voice architecture surfaces while keeping internal file paths encapsulated.
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
const AudioConfiguration = require('./audio/AudioConfiguration');
const AudioFrame = require('./audio/AudioFrame');
const AUDIO_EVENTS = require('./audio/AudioEvents');
const AudioErrors = require('./audio/AudioErrors');

const AudioProcessor = require('./preprocessing/AudioProcessor');
const AudioPipeline = require('./preprocessing/AudioPipeline');
const AudioFrameProcessor = require('./preprocessing/AudioFrameProcessor');
const VoiceActivityDetector = require('./preprocessing/VoiceActivityDetector');
const RNNoiseProcessor = require('./preprocessing/RNNoiseProcessor');
const ProcessedAudioFrame = require('./preprocessing/ProcessedAudioFrame');
const ProcessingConfiguration = require('./preprocessing/ProcessingConfiguration');
const AUDIO_PROCESSING_EVENTS = require('./preprocessing/AudioProcessingEvents');
const AudioProcessingErrors = require('./preprocessing/AudioProcessingErrors');

const {
  STTEngine,
  STTConfiguration,
  TranscriptSegment,
  TranscriptResult,
  STT_EVENTS,
  ...STTErrors
} = require('./stt');

const {
  TranscriptProcessor,
  TranscriptNormalizer,
  NormalizedTranscript,
  NormalizationConfiguration,
  NORMALIZATION_EVENTS,
  ...NormalizationErrors
} = require('./normalization');
const {
  VoiceOverlay,
  VoiceWindowController
} = require('./ui');
const {
  AssistantInputAdapter,
  VoiceAssistantBridge
} = require('./integration');
const { DiagnosticsManager } = require('./diagnostics');
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
  AudioConfiguration,
  AudioFrame,
  AUDIO_EVENTS,
  ...AudioErrors,
  AudioProcessor,
  AudioPipeline,
  AudioFrameProcessor,
  VoiceActivityDetector,
  RNNoiseProcessor,
  ProcessedAudioFrame,
  ProcessingConfiguration,
  AUDIO_PROCESSING_EVENTS,
  ...AudioProcessingErrors,
  STTEngine,
  STTConfiguration,
  TranscriptSegment,
  TranscriptResult,
  STT_EVENTS,
  ...STTErrors,
  TranscriptProcessor,
  TranscriptNormalizer,
  NormalizedTranscript,
  NormalizationConfiguration,
  NORMALIZATION_EVENTS,
  ...NormalizationErrors,
  VoiceOverlay,
  VoiceWindowController,
  AssistantInputAdapter,
  VoiceAssistantBridge,
  DiagnosticsManager,
  VoiceSettings,
  VoiceLogger,
  VoiceMetrics
};
