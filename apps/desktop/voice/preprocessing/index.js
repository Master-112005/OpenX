'use strict';

/**
 * Purpose: Public entry point for OpenX Voice Audio Processing modules.
 * Responsibility: Export the processor, pipeline, frame processor, RNNoise, VAD, processed frame, configuration, events, and errors.
 * Dependencies: Preprocessing modules only.
 * Thread ownership: Importers should use AudioProcessor, AudioPipeline, and ProcessingConfiguration instead of deep internal paths.
 * Future integration notes: Future STT should depend on ProcessedAudioFrame output from this package.
 */

const AudioProcessor = require('./AudioProcessor');
const AudioPipeline = require('./AudioPipeline');
const AudioFrameProcessor = require('./AudioFrameProcessor');
const RNNoiseProcessor = require('./RNNoiseProcessor');
const VoiceActivityDetector = require('./VoiceActivityDetector');
const ProcessedAudioFrame = require('./ProcessedAudioFrame');
const ProcessingConfiguration = require('./ProcessingConfiguration');
const AUDIO_PROCESSING_EVENTS = require('./AudioProcessingEvents');
const AudioProcessingErrors = require('./AudioProcessingErrors');

module.exports = {
  AudioProcessor,
  AudioPipeline,
  AudioFrameProcessor,
  RNNoiseProcessor,
  VoiceActivityDetector,
  ProcessedAudioFrame,
  ProcessingConfiguration,
  AUDIO_PROCESSING_EVENTS,
  ...AudioProcessingErrors
};
