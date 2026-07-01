'use strict';

const EventEmitter = require('events');
const { SESSION_EVENTS } = require('../session/SessionEvents');
const AssistantInputAdapter = require('./AssistantInputAdapter');
const VoiceExecutionCoordinator = require('./VoiceExecutionCoordinator');
const VoiceIntegrationConfiguration = require('./VoiceIntegrationConfiguration');
const EVENTS = require('./VoiceIntegrationEvents');
const { BridgeAttachmentFailedError } = require('./VoiceIntegrationErrors');

/**
 * Purpose: Connects VoiceSessionManager normalized transcript events to AssistantInputAdapter.
 * Responsibility: Listen for final normalized voice commands and hand them to the adapter.
 * Dependencies: VoiceSessionManager event source, AssistantInputAdapter, optional coordinator, and logger.
 * Lifecycle: Attached when desktop runtime wires voice to the existing assistant and detached during cleanup.
 * Future extension notes: Do not add assistant logic, NLP, router, automation, or response rewriting here.
 */
class VoiceAssistantBridge extends EventEmitter {
  /**
   * Create bridge.
   * @param {{manager?: object, adapter?: AssistantInputAdapter, assistant?: object, coordinator?: VoiceExecutionCoordinator, textToSpeech?: object, configuration?: object|VoiceIntegrationConfiguration, logger?: object}} dependencies Bridge dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.configuration = dependencies.configuration instanceof VoiceIntegrationConfiguration
      ? dependencies.configuration
      : new VoiceIntegrationConfiguration(dependencies.configuration || {});
    this.adapter = dependencies.adapter || new AssistantInputAdapter({
      assistant: dependencies.assistant,
      configuration: this.configuration,
      logger: dependencies.logger
    });
    this.coordinator = dependencies.coordinator || new VoiceExecutionCoordinator({
      manager: dependencies.manager,
      textToSpeech: dependencies.textToSpeech,
      configuration: this.configuration,
      logger: dependencies.logger
    });
    this.logger = dependencies.logger || null;
    this.manager = null;
    this.subscriptions = [];
    this.metrics = {
      commandsReceived: 0,
      commandsDispatched: 0,
      failures: 0
    };
    if (dependencies.manager) {
      this.attachToSessionManager(dependencies.manager);
    }
  }

  /**
   * Attach to VoiceSessionManager normalized transcript events.
   * @param {{on: Function, off?: Function, removeListener?: Function}} manager VoiceSessionManager-like source.
   * @returns {VoiceAssistantBridge}
   */
  attachToSessionManager(manager) {
    if (!manager || typeof manager.on !== 'function') {
      throw new BridgeAttachmentFailedError('VoiceSessionManager event source is invalid.');
    }
    this.detach();
    this.manager = manager;
    if (this.coordinator && typeof this.coordinator.attachToSessionManager === 'function') {
      this.coordinator.attachToSessionManager(manager);
    } else {
      this.coordinator.manager = manager;
    }
    const listener = event => {
      this.handleNormalizedTranscript(event).catch(error => {
        this.metrics.failures += 1;
        this.emit(EVENTS.ASSISTANT_FAILED, Object.freeze({ error: this._normalizeError(error) }));
      });
    };
    manager.on(SESSION_EVENTS.VOICE_NORMALIZED_TRANSCRIPT, listener);
    this.subscriptions.push({ manager, eventName: SESSION_EVENTS.VOICE_NORMALIZED_TRANSCRIPT, listener });
    return this;
  }

  /**
   * Detach manager subscriptions.
   * @returns {VoiceAssistantBridge}
   */
  detach() {
    for (const subscription of this.subscriptions) {
      const remove = subscription.manager.off || subscription.manager.removeListener;
      if (typeof remove === 'function') {
        remove.call(subscription.manager, subscription.eventName, subscription.listener);
      }
    }
    this.subscriptions = [];
    if (this.coordinator && typeof this.coordinator.detachFromSessionManager === 'function') {
      this.coordinator.detachFromSessionManager();
    }
    this.manager = null;
    return this;
  }

  /**
   * Handle a normalized transcript event.
   * @param {object|string} event Event payload or normalized transcript.
   * @returns {Promise<object>} Assistant result.
   */
  async handleNormalizedTranscript(event) {
    const normalizedTranscript = event?.normalizedTranscript || event;
    const metadata = normalizedTranscript && typeof normalizedTranscript.toJSON === 'function'
      ? normalizedTranscript.toJSON().metadata
      : normalizedTranscript?.metadata;
    if (metadata?.partial) {
      return null;
    }
    this.metrics.commandsReceived += 1;
    this.emit(EVENTS.VOICE_COMMAND_READY, Object.freeze({ normalizedTranscript }));
    this.coordinator.startExecution();
    try {
      const result = await this.adapter.handle(normalizedTranscript);
      this.metrics.commandsDispatched += 1;
      this.emit(EVENTS.VOICE_RESPONSE_READY, Object.freeze({ result }));
      await this.coordinator.finishExecution(result);
      this.emit(EVENTS.VOICE_EXECUTION_FINISHED, Object.freeze({ result }));
      return result;
    } catch (error) {
      await this.coordinator.finishExecution({
        success: false,
        error: this._normalizeError(error)
      });
      throw error;
    }
  }

  /**
   * Return bridge metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      adapter: this.adapter.getMetrics(),
      coordinator: this.coordinator.getMetrics()
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
}

module.exports = VoiceAssistantBridge;
