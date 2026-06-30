'use strict';

/**
 * Purpose: Public package boundary for OpenX Voice transcript normalization.
 * Responsibility: Export TranscriptProcessor as the integration surface and keep stage classes available for focused unit tests.
 * Dependencies: Normalization package modules only.
 * Pipeline position: Sits between STTEngine TranscriptResult output and future NLP text input.
 * Future extension notes: VoiceSessionManager should communicate with TranscriptProcessor, not individual stages.
 */

const TranscriptProcessor = require('./TranscriptProcessor');
const TranscriptNormalizer = require('./TranscriptNormalizer');
const CommandNormalizer = require('./CommandNormalizer');
const DictionaryNormalizer = require('./DictionaryNormalizer');
const AcronymNormalizer = require('./AcronymNormalizer');
const ApplicationNormalizer = require('./ApplicationNormalizer');
const TechnologyNormalizer = require('./TechnologyNormalizer');
const TextCleaner = require('./TextCleaner');
const TextValidator = require('./TextValidator');
const NormalizedTranscript = require('./NormalizedTranscript');
const NormalizationConfiguration = require('./NormalizationConfiguration');
const NORMALIZATION_EVENTS = require('./NormalizationEvents');
const NormalizationErrors = require('./NormalizationErrors');

module.exports = {
  TranscriptProcessor,
  TranscriptNormalizer,
  CommandNormalizer,
  DictionaryNormalizer,
  AcronymNormalizer,
  ApplicationNormalizer,
  TechnologyNormalizer,
  TextCleaner,
  TextValidator,
  NormalizedTranscript,
  NormalizationConfiguration,
  NORMALIZATION_EVENTS,
  ...NormalizationErrors
};
