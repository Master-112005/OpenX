'use strict';

const EventEmitter = require('events');
const VoiceIntegrationConfiguration = require('./VoiceIntegrationConfiguration');
const EVENTS = require('./VoiceIntegrationEvents');

/**
 * Purpose: Coordinates voice execution lifecycle around assistant dispatch.
 * Responsibility: Optionally advance VoiceSessionManager states while keeping assistant behavior untouched.
 * Dependencies: Optional VoiceSessionManager-like object and configuration.
 * Lifecycle: Called by VoiceAssistantBridge before and after adapter dispatch.
 * Future extension notes: This class must not inspect or alter assistant results.
 */
class VoiceExecutionCoordinator extends EventEmitter {
  /**
   * Create execution coordinator.
   * @param {{manager?: object, configuration?: object|VoiceIntegrationConfiguration, logger?: object}} dependencies Coordinator dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.manager = dependencies.manager || null;
    this.configuration = dependencies.configuration instanceof VoiceIntegrationConfiguration
      ? dependencies.configuration
      : new VoiceIntegrationConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metrics = {
      completedExecutions: 0,
      cancelledCommands: 0
    };
  }

  /**
   * Start execution presentation state if possible.
   * @returns {{started: boolean}}
   */
  startExecution() {
    if (this.configuration.autoTransitionSession && this.manager && typeof this.manager.beginExecution === 'function') {
      try {
        this.manager.beginExecution();
      } catch (_) {
        // The manager may already be in a compatible state. UI state remains manager-owned.
      }
    }
    this.emit(EVENTS.ASSISTANT_STARTED, Object.freeze({}));
    this._log('Execution Started');
    return { started: true };
  }

  /**
   * Finish execution presentation state if possible.
   * @param {object} result Assistant result.
   * @returns {{finished: boolean, result: object}}
   */
  finishExecution(result) {
    this.metrics.completedExecutions += 1;
    if (this.configuration.autoTransitionSession && this.manager && typeof this.manager.finishSession === 'function') {
      try {
        this.manager.finishSession();
      } catch (_) {
        // Session lifecycle is best-effort presentation coordination here.
      }
    }
    this.emit(EVENTS.VOICE_EXECUTION_FINISHED, Object.freeze({ result }));
    this._log('Execution Finished', { success: Boolean(result?.success) });
    return { finished: true, result };
  }

  /**
   * Record a cancelled command.
   * @param {string} reason Cancellation reason.
   * @returns {{cancelled: boolean, reason: string}}
   */
  cancel(reason = 'Voice command cancelled.') {
    this.metrics.cancelledCommands += 1;
    this.emit(EVENTS.VOICE_COMMAND_CANCELLED, Object.freeze({ reason }));
    return { cancelled: true, reason };
  }

  /**
   * Return coordinator metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Write structured logs.
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

module.exports = VoiceExecutionCoordinator;
