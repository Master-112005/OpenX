'use strict';

const EventEmitter = require('events');
const AssistantDispatcher = require('./AssistantDispatcher');
const VoiceResponseHandler = require('./VoiceResponseHandler');
const VoiceIntegrationConfiguration = require('./VoiceIntegrationConfiguration');
const EVENTS = require('./VoiceIntegrationEvents');
const {
  EmptyVoiceCommandError,
  InvalidNormalizedTranscriptError
} = require('./VoiceIntegrationErrors');

/**
 * Purpose: Converts NormalizedTranscript output into the existing Assistant text input boundary.
 * Responsibility: Extract normalized text, validate it, and call the existing assistant through AssistantDispatcher.
 * Dependencies: AssistantDispatcher, VoiceResponseHandler, configuration, and optional logger.
 * Lifecycle: Called when transcript normalization produces a final normalized command.
 * Future extension notes: Never modify NLP, NLU, router, automation, active learning, context, planner, scheduler, or assistant responses here.
 */
class AssistantInputAdapter extends EventEmitter {
  /**
   * Create adapter.
   * @param {{assistant?: object, dispatcher?: AssistantDispatcher, responseHandler?: VoiceResponseHandler, configuration?: object|VoiceIntegrationConfiguration, logger?: object}} dependencies Adapter dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.configuration = dependencies.configuration instanceof VoiceIntegrationConfiguration
      ? dependencies.configuration
      : new VoiceIntegrationConfiguration(dependencies.configuration || {});
    this.dispatcher = dependencies.dispatcher || new AssistantDispatcher({
      assistant: dependencies.assistant,
      configuration: this.configuration,
      logger: dependencies.logger
    });
    this.responseHandler = dependencies.responseHandler || new VoiceResponseHandler({ logger: dependencies.logger });
    this.logger = dependencies.logger || null;
    this.metrics = {
      voiceCommandsExecuted: 0,
      successCount: 0,
      failureCount: 0,
      emptyRejected: 0
    };
  }

  /**
   * Process a NormalizedTranscript and return the assistant result unchanged.
   * @param {object|string} normalizedTranscript Normalized transcript or string.
   * @returns {Promise<object>} Assistant result.
   */
  async handle(normalizedTranscript) {
    const text = this.extractText(normalizedTranscript);
    this.validateText(text);
    this.emit(EVENTS.VOICE_COMMAND_READY, Object.freeze({ text }));
    this._log('Normalized Transcript', { text });
    try {
      const result = await this.dispatcher.dispatch(text);
      this.metrics.voiceCommandsExecuted += 1;
      this.metrics.successCount += 1;
      this.emit(EVENTS.ASSISTANT_COMPLETED, Object.freeze({ result }));
      return this.responseHandler.handle(result);
    } catch (error) {
      this.metrics.failureCount += 1;
      this.emit(EVENTS.ASSISTANT_FAILED, Object.freeze({ error: this._normalizeError(error) }));
      throw error;
    }
  }

  /**
   * Extract only the normalized text string from supported inputs.
   * @param {object|string} normalizedTranscript Normalized transcript or text.
   * @returns {string}
   */
  extractText(normalizedTranscript) {
    if (typeof normalizedTranscript === 'string') {
      return this.configuration.trimInput ? normalizedTranscript.trim() : normalizedTranscript;
    }
    if (!normalizedTranscript || typeof normalizedTranscript !== 'object') {
      throw new InvalidNormalizedTranscriptError('Normalized transcript is invalid.');
    }
    const payload = typeof normalizedTranscript.toJSON === 'function'
      ? normalizedTranscript.toJSON()
      : { ...normalizedTranscript };
    const text = String(payload.normalizedTranscript || '');
    return this.configuration.trimInput ? text.trim() : text;
  }

  /**
   * Validate command text before assistant dispatch.
   * @param {string} text Command text.
   * @returns {true}
   */
  validateText(text) {
    if (!text || String(text).trim().length === 0) {
      this.metrics.emptyRejected += 1;
      throw new EmptyVoiceCommandError('Voice transcript did not contain a command.');
    }
    if (String(text).length > this.configuration.maximumCommandLength) {
      throw new InvalidNormalizedTranscriptError('Voice command is too long.');
    }
    return true;
  }

  /**
   * Return adapter metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      dispatcher: this.dispatcher.getMetrics(),
      responses: this.responseHandler.getMetrics()
    };
  }

  /**
   * Normalize error metadata.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error && typeof error.toJSON === 'function') return error.toJSON();
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'VoiceIntegrationError', message: String(error || 'Voice integration failed.') };
  }

  /**
   * Write structured adapter logs.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Voice Integration] ${message}`, metadata);
    }
  }
}

module.exports = AssistantInputAdapter;
