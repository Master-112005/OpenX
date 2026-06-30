'use strict';

const EventEmitter = require('events');
const VoiceIntegrationConfiguration = require('./VoiceIntegrationConfiguration');
const EVENTS = require('./VoiceIntegrationEvents');
const { AssistantUnavailableError, DispatchFailedError } = require('./VoiceIntegrationErrors');

/**
 * Purpose: Dispatches normalized text to the existing OpenX Assistant.
 * Responsibility: Call the same Assistant.processCommand(text) public API used by chat and return the result unchanged.
 * Dependencies: Existing assistant instance or processCommand-compatible object.
 * Lifecycle: Used by AssistantInputAdapter after it extracts a valid command string.
 * Future extension notes: Do not duplicate Assistant.processCommand, NLP, NLU, router, automation, or response generation.
 */
class AssistantDispatcher extends EventEmitter {
  /**
   * Create dispatcher.
   * @param {{assistant?: object, configuration?: object|VoiceIntegrationConfiguration, logger?: object, clock?: Function}} dependencies Dispatcher dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.assistant = dependencies.assistant || null;
    this.configuration = dependencies.configuration instanceof VoiceIntegrationConfiguration
      ? dependencies.configuration
      : new VoiceIntegrationConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.clock = dependencies.clock || (() => new Date());
    this.metrics = {
      dispatchCount: 0,
      successCount: 0,
      failureCount: 0,
      dispatchLatencyMs: 0,
      assistantExecutionLatencyMs: 0
    };
  }

  /**
   * Set or replace the assistant target.
   * @param {object} assistant Assistant with processCommand(text).
   * @returns {AssistantDispatcher}
   */
  setAssistant(assistant) {
    this.assistant = assistant || null;
    return this;
  }

  /**
   * Dispatch plain text to Assistant.processCommand(text).
   * @param {string} text Normalized command text.
   * @returns {Promise<object>} Assistant result, unchanged.
   */
  async dispatch(text) {
    if (!this.assistant || typeof this.assistant.processCommand !== 'function') {
      throw new AssistantUnavailableError('Assistant is unavailable for voice command dispatch.');
    }

    const commandText = String(text || '');
    const startedAt = this.clock();
    this.metrics.dispatchCount += 1;
    this.emit(EVENTS.VOICE_COMMAND_DISPATCHED, Object.freeze({ text: commandText }));
    this.emit(EVENTS.ASSISTANT_STARTED, Object.freeze({ text: commandText }));
    this._log('Assistant Called', { text: commandText });

    try {
      const result = await this.assistant.processCommand(commandText);
      const latency = Math.max(0, this.clock().getTime() - startedAt.getTime());
      this.metrics.successCount += 1;
      this.metrics.dispatchLatencyMs += latency;
      this.metrics.assistantExecutionLatencyMs += latency;
      this.emit(EVENTS.ASSISTANT_COMPLETED, Object.freeze({ result }));
      this._log('Execution Completed', { success: Boolean(result?.success) });
      return result;
    } catch (error) {
      this.metrics.failureCount += 1;
      this.emit(EVENTS.ASSISTANT_FAILED, Object.freeze({ error: this._normalizeError(error) }));
      throw new DispatchFailedError('Voice command dispatch failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Return dispatcher metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Normalize error metadata.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'DispatchError', message: String(error || 'Dispatch failed.') };
  }

  /**
   * Write structured integration logs.
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

module.exports = AssistantDispatcher;
