'use strict';

const EventEmitter = require('events');
const NormalizationConfiguration = require('./NormalizationConfiguration');
const NormalizedTranscript = require('./NormalizedTranscript');
const TextCleaner = require('./TextCleaner');
const TranscriptNormalizer = require('./TranscriptNormalizer');
const CommandNormalizer = require('./CommandNormalizer');
const ApplicationNormalizer = require('./ApplicationNormalizer');
const TechnologyNormalizer = require('./TechnologyNormalizer');
const AcronymNormalizer = require('./AcronymNormalizer');
const DictionaryNormalizer = require('./DictionaryNormalizer');
const TextValidator = require('./TextValidator');
const EVENTS = require('./NormalizationEvents');
const { NormalizationFailureError } = require('./NormalizationErrors');

/**
 * Purpose: Coordinates deterministic transcript processing between STT and future NLP.
 * Responsibility: Receive TranscriptResult objects, run the normalization pipeline, validate output, emit events, and produce NormalizedTranscript objects.
 * Dependencies: NormalizationConfiguration, TextCleaner, stage normalizers, TextValidator, NormalizedTranscript, and normalization events/errors.
 * Pipeline position: Owns Raw Transcript -> TextCleaner -> TranscriptNormalizer -> CommandNormalizer -> ApplicationNormalizer -> TechnologyNormalizer -> AcronymNormalizer -> DictionaryNormalizer -> TextValidator -> NormalizedTranscript.
 * Future extension notes: This class must never perform intent recognition, NLU, routing, or command execution.
 */
class TranscriptProcessor {
  /**
   * Create a transcript processor.
   * @param {{configuration?: NormalizationConfiguration|object, cleaner?: TextCleaner, transcriptNormalizer?: TranscriptNormalizer, commandNormalizer?: CommandNormalizer, applicationNormalizer?: ApplicationNormalizer, technologyNormalizer?: TechnologyNormalizer, acronymNormalizer?: AcronymNormalizer, dictionaryNormalizer?: DictionaryNormalizer, validator?: TextValidator, logger?: object, metrics?: object, clock?: () => Date}} dependencies Processor dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof NormalizationConfiguration
      ? dependencies.configuration
      : new NormalizationConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.dictionaryNormalizer = dependencies.dictionaryNormalizer || new DictionaryNormalizer();
    this.cleaner = dependencies.cleaner || new TextCleaner({ removeRepeatedWords: this.configuration.removeRepeatedWords });
    this.transcriptNormalizer = dependencies.transcriptNormalizer || new TranscriptNormalizer({
      removeFillers: this.configuration.removeFillers,
      capitalizationRules: this.configuration.capitalizationRules
    });
    this.commandNormalizer = dependencies.commandNormalizer || new CommandNormalizer({
      dictionary: this.dictionaryNormalizer.getCategory('commands')
    });
    this.applicationNormalizer = dependencies.applicationNormalizer || new ApplicationNormalizer({
      dictionary: this.dictionaryNormalizer.getCategory('applications')
    });
    this.technologyNormalizer = dependencies.technologyNormalizer || new TechnologyNormalizer({
      dictionary: this.dictionaryNormalizer.getCategory('technologies')
    });
    this.acronymNormalizer = dependencies.acronymNormalizer || new AcronymNormalizer({
      dictionary: this.dictionaryNormalizer.getCategory('acronyms')
    });
    this.validator = dependencies.validator || new TextValidator({
      maximumTranscriptLength: this.configuration.maximumTranscriptLength,
      confidenceThreshold: this.configuration.confidenceThreshold
    });
    this.events = new EventEmitter();
    this.metrics = {
      transcriptsProcessed: 0,
      validationFailures: 0,
      rulesApplied: 0,
      dictionaryHits: 0,
      applicationReplacements: 0,
      technologyReplacements: 0,
      processingLatencyMs: 0
    };
  }

  /**
   * Subscribe to transcript processing events.
   * @param {string} eventName Event name from NormalizationEvents.
   * @param {Function} listener Event listener.
   * @returns {TranscriptProcessor}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a transcript processing listener.
   * @param {string} eventName Event name.
   * @param {Function} listener Event listener.
   * @returns {TranscriptProcessor}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Process a TranscriptResult or compatible transcript object.
   * @param {TranscriptResult|object|string} transcriptResult STT transcript result.
   * @returns {NormalizedTranscript}
   */
  process(transcriptResult) {
    const startedAt = this.clock();
    const source = this._extractTranscript(transcriptResult);
    this.events.emit(EVENTS.TRANSCRIPT_RECEIVED, { transcript: source.originalTranscript });
    this.events.emit(EVENTS.NORMALIZATION_STARTED, { transcript: source.originalTranscript });

    try {
      const transformations = [];
      const cleaned = this.cleaner.clean(source.originalTranscript);
      transformations.push(...cleaned.transformations);
      this.events.emit(EVENTS.TEXT_CLEANED, { text: cleaned.text, transformations: cleaned.transformations });

      let current = cleaned.text;
      current = this._runStage('transcript', current, this.transcriptNormalizer.normalizeWithMetadata.bind(this.transcriptNormalizer), transformations).text;
      current = this._maybeRunStage('command', current, this.commandNormalizer, transformations, true).text;
      current = this._maybeRunStage('application', current, this.applicationNormalizer, transformations, this.configuration.applicationNormalization).text;
      current = this._maybeRunStage('technology', current, this.technologyNormalizer, transformations, this.configuration.technologyNormalization).text;
      current = this._maybeRunStage('acronym', current, this.acronymNormalizer, transformations, this.configuration.acronymNormalization).text;
      if (this.configuration.dictionaryReplacement) {
        current = this._runStage('dictionary', current, this.dictionaryNormalizer.normalize.bind(this.dictionaryNormalizer), transformations).text;
      }

      const validation = this.configuration.validationEnabled
        ? this.validator.assertValid(current, { confidence: source.confidence })
        : { valid: true, errors: [], warnings: [] };
      this.events.emit(EVENTS.VALIDATION_PASSED, { validation });
      const normalized = new NormalizedTranscript({
        originalTranscript: source.originalTranscript,
        cleanedTranscript: cleaned.text,
        normalizedTranscript: current,
        validation,
        timestamp: this.clock(),
        metadata: {
          confidence: source.confidence,
          partial: source.partial,
          source: 'stt',
          durationMs: source.durationMs
        },
        transformations
      });
      this._recordMetrics(transformations, startedAt);
      this.events.emit(EVENTS.NORMALIZATION_COMPLETED, normalized.toJSON());
      this.events.emit(EVENTS.NORMALIZED_TRANSCRIPT_READY, { normalizedTranscript: normalized });
      this._log('Transcript normalized', {
        original: normalized.originalTranscript,
        normalized: normalized.normalizedTranscript
      });
      return normalized;
    } catch (error) {
      this.metrics.validationFailures += 1;
      const normalizedError = error && typeof error.toJSON === 'function'
        ? error
        : new NormalizationFailureError('Transcript normalization failed.', { details: this._normalizeError(error) });
      this.events.emit(EVENTS.VALIDATION_FAILED, { error: normalizedError.toJSON ? normalizedError.toJSON() : normalizedError });
      this.events.emit(EVENTS.NORMALIZATION_ERROR, { error: normalizedError.toJSON ? normalizedError.toJSON() : normalizedError });
      throw normalizedError;
    }
  }

  /**
   * Return processor status.
   * @returns {{enabled: boolean, configuration: object, metrics: object}}
   */
  getStatus() {
    return {
      enabled: this.configuration.normalizationEnabled,
      configuration: this.configuration.toJSON(),
      metrics: this.getMetrics()
    };
  }

  /**
   * Return processor metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Extract raw transcript text from supported inputs.
   * @param {TranscriptResult|object|string} transcriptResult Input transcript.
   * @returns {{originalTranscript: string, confidence: number|null, partial: boolean, durationMs: number}}
   * @private
   */
  _extractTranscript(transcriptResult) {
    if (typeof transcriptResult === 'string') {
      return { originalTranscript: transcriptResult, confidence: null, partial: false, durationMs: 0 };
    }
    const payload = transcriptResult && typeof transcriptResult.toJSON === 'function'
      ? transcriptResult.toJSON()
      : { ...(transcriptResult || {}) };
    return {
      originalTranscript: String(payload.finalTranscript || payload.transcript || payload.text || ''),
      confidence: Number.isFinite(payload.confidence) ? payload.confidence : null,
      partial: Boolean(payload.partial),
      durationMs: Number(payload.durationMs) || 0
    };
  }

  /**
   * Conditionally run a normalization stage.
   * @param {string} name Stage name.
   * @param {string} text Current text.
   * @param {{normalize: Function}} stage Stage object.
   * @param {object[]} transformations Transformation list.
   * @param {boolean} enabled Whether stage is enabled.
   * @returns {{text: string}}
   * @private
   */
  _maybeRunStage(name, text, stage, transformations, enabled) {
    if (!enabled) return { text };
    return this._runStage(name, text, stage.normalize.bind(stage), transformations);
  }

  /**
   * Run one normalization stage and append metadata.
   * @param {string} name Stage name.
   * @param {string} text Current text.
   * @param {Function} fn Stage function.
   * @param {object[]} transformations Transformation list.
   * @returns {{text: string}}
   * @private
   */
  _runStage(name, text, fn, transformations) {
    const result = fn(text);
    const next = typeof result === 'string' ? { text: result, transformations: [] } : result;
    for (const transformation of next.transformations || []) {
      transformations.push({ stage: name, ...transformation });
    }
    return { text: next.text };
  }

  /**
   * Record normalization metrics.
   * @param {object[]} transformations Transformations.
   * @param {Date} startedAt Start timestamp.
   * @returns {void}
   * @private
   */
  _recordMetrics(transformations, startedAt) {
    this.metrics.transcriptsProcessed += 1;
    this.metrics.rulesApplied += transformations.length;
    this.metrics.dictionaryHits += transformations.filter(item => item.stage === 'dictionary').length;
    this.metrics.applicationReplacements += transformations.filter(item => item.stage === 'application').length;
    this.metrics.technologyReplacements += transformations.filter(item => item.stage === 'technology').length;
    this.metrics.processingLatencyMs += Math.max(0, this.clock().getTime() - startedAt.getTime());
    if (this.metricsRecorder && typeof this.metricsRecorder.increment === 'function') {
      this.metricsRecorder.increment('voice.transcript.normalized', 1);
    }
  }

  /**
   * Normalize error metadata.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'NormalizationError', message: String(error || 'Normalization failed.') };
  }

  /**
   * Write structured transcript logs when available.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Transcript] ${message}`, metadata);
    }
  }
}

module.exports = TranscriptProcessor;
