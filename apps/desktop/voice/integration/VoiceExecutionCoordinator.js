'use strict';

const EventEmitter = require('events');
const VoiceIntegrationConfiguration = require('./VoiceIntegrationConfiguration');
const EVENTS = require('./VoiceIntegrationEvents');
const { SESSION_EVENTS } = require('../session/SessionEvents');

/**
 * Purpose: Coordinates voice execution lifecycle around assistant dispatch.
 * Responsibility: Advance VoiceSessionManager states and synchronize assistant dispatch with TTS completion.
 * Dependencies: Optional VoiceSessionManager-like object, optional TextToSpeech-like object, and configuration.
 * Lifecycle: Called by VoiceAssistantBridge before and after adapter dispatch.
 * Future extension notes: This class must not inspect or alter assistant results.
 */
class VoiceExecutionCoordinator extends EventEmitter {
  /**
   * Create execution coordinator.
   * @param {{manager?: object, textToSpeech?: object, configuration?: object|VoiceIntegrationConfiguration, logger?: object}} dependencies Coordinator dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.manager = null;
    this.textToSpeech = dependencies.textToSpeech || null;
    this.configuration = dependencies.configuration instanceof VoiceIntegrationConfiguration
      ? dependencies.configuration
      : new VoiceIntegrationConfiguration(dependencies.configuration || {});
    this.logger = dependencies.logger || null;
    this.metrics = {
      completedExecutions: 0,
      cancelledCommands: 0,
      ttsStarted: 0,
      ttsCompleted: 0,
      ttsCancelled: 0,
      ttsFailed: 0,
      resumedAfterTts: 0,
      duplicateResumeSuppressed: 0
    };
    this.activeTurn = null;
    this.managerSubscriptions = [];
    if (dependencies.manager) this.attachToSessionManager(dependencies.manager);
  }

  /**
   * Attach manager cancellation observation for deterministic TTS cleanup.
   * @param {object} manager VoiceSessionManager-like object.
   * @returns {VoiceExecutionCoordinator}
   */
  attachToSessionManager(manager) {
    this.detachFromSessionManager();
    this.manager = manager || null;
    if (this.manager && typeof this.manager.on === 'function') {
      const listener = event => this._handleSessionCancelled(event);
      this.manager.on(SESSION_EVENTS.VOICE_SESSION_CANCELLED, listener);
      this.managerSubscriptions.push({
        manager: this.manager,
        eventName: SESSION_EVENTS.VOICE_SESSION_CANCELLED,
        listener
      });
    }
    return this;
  }

  /**
   * Detach manager observation.
   * @returns {VoiceExecutionCoordinator}
   */
  detachFromSessionManager() {
    for (const subscription of this.managerSubscriptions) {
      const remove = subscription.manager.off || subscription.manager.removeListener;
      if (typeof remove === 'function') {
        remove.call(subscription.manager, subscription.eventName, subscription.listener);
      }
    }
    this.managerSubscriptions = [];
    return this;
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
  async finishExecution(result) {
    this.metrics.completedExecutions += 1;
    const turn = this._createTurn(result);
    let sessionTransition = null;
    let ttsOutcome = { outcome: 'skipped', reason: 'no-spoken-response' };

    try {
      ttsOutcome = await this._speakAssistantResponse(turn, result);
    } finally {
      sessionTransition = this._resumeAfterAssistantTurn(turn, ttsOutcome);
    }

    this.emit(EVENTS.VOICE_EXECUTION_FINISHED, Object.freeze({ result }));
    this._log('Execution Finished', {
      success: Boolean(result?.success),
      sessionState: sessionTransition?.state,
      resumedListening: Boolean(sessionTransition?.resumed),
      ttsOutcome: ttsOutcome.outcome
    });
    return { finished: true, result };
  }

  /**
   * Record a cancelled command.
   * @param {string} reason Cancellation reason.
   * @returns {{cancelled: boolean, reason: string}}
   */
  cancel(reason = 'Voice command cancelled.') {
    this.metrics.cancelledCommands += 1;
    this._stopTextToSpeech(reason);
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
   * Create metadata for one assistant-owned turn.
   * @param {object} result Assistant result.
   * @returns {object}
   * @private
   */
  _createTurn(result = {}) {
    const turn = {
      id: `voice-turn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      completed: false,
      result
    };
    this.activeTurn = turn;
    return turn;
  }

  /**
   * Speak the assistant response and wait for the TTS lifecycle to terminate.
   * @param {object} turn Conversation turn.
   * @param {object} result Assistant result.
   * @returns {Promise<{outcome: string, reason?: string}>}
   * @private
   */
  async _speakAssistantResponse(turn, result = {}) {
    const text = this._extractSpokenResponse(result);
    if (!text) return { outcome: 'skipped', reason: 'empty-response' };
    if (!this.textToSpeech || typeof this.textToSpeech.speakAsync !== 'function') {
      return { outcome: 'skipped', reason: 'tts-unavailable' };
    }

    if (this.configuration.autoTransitionSession && this.manager && typeof this.manager.beginSpeaking === 'function') {
      try {
        this.manager.beginSpeaking('assistant-response-ready');
      } catch (error) {
        this._log('Speaking State Skipped', { error: error.message });
      }
    }

    this.metrics.ttsStarted += 1;
    this.emit(EVENTS.TTS_STARTED, Object.freeze({ turnId: turn.id }));
    this._log('TTS Started', { turnId: turn.id, responseLength: text.length });

    try {
      const ttsResult = await this.textToSpeech.speakAsync(text);
      if (turn.cancelled || ttsResult?.outcome === 'cancelled') {
        this.metrics.ttsCancelled += 1;
        this._recordManagerSpeakingCompletion('cancelled', { turnId: turn.id });
        this.emit(EVENTS.TTS_CANCELLED, Object.freeze({ turnId: turn.id }));
        return { outcome: 'cancelled' };
      }
      if (ttsResult?.outcome === 'failed') {
        this.metrics.ttsFailed += 1;
        this._recordManagerSpeakingCompletion('failed', { turnId: turn.id, error: ttsResult?.error?.message });
        this.emit(EVENTS.TTS_FAILED, Object.freeze({ turnId: turn.id, error: this._normalizeError(ttsResult.error) }));
        return { outcome: 'failed', error: ttsResult.error };
      }
      this.metrics.ttsCompleted += 1;
      this._recordManagerSpeakingCompletion('completed', { turnId: turn.id });
      this.emit(EVENTS.TTS_COMPLETED, Object.freeze({ turnId: turn.id }));
      this._log('TTS Completed', { turnId: turn.id });
      return { outcome: 'completed' };
    } catch (error) {
      this.metrics.ttsFailed += 1;
      this._recordManagerSpeakingCompletion('failed', { turnId: turn.id, error: error.message });
      this.emit(EVENTS.TTS_FAILED, Object.freeze({ turnId: turn.id, error: this._normalizeError(error) }));
      this._log('TTS Failed', { turnId: turn.id, error: error.message });
      return { outcome: 'failed', error };
    }
  }

  /**
   * Resume recognition exactly once after the assistant turn ends.
   * @param {object} turn Conversation turn.
   * @param {object} ttsOutcome TTS result.
   * @returns {object|null}
   * @private
   */
  _resumeAfterAssistantTurn(turn, ttsOutcome = {}) {
    if (!this.configuration.autoTransitionSession || !this.manager || typeof this.manager.resumeListeningCycle !== 'function') {
      return null;
    }
    if (!turn || turn.completed) {
      this.metrics.duplicateResumeSuppressed += 1;
      this.manager?.recordDuplicateConversationResume?.('turn-already-completed');
      return null;
    }
    turn.completed = true;
    if (this.activeTurn === turn) this.activeTurn = null;
    try {
      const transition = this.manager.resumeListeningCycle(`assistant-tts-${ttsOutcome.outcome || 'complete'}`);
      if (transition?.resumed) this.metrics.resumedAfterTts += 1;
      this._log('Recognition Resumed After Assistant Turn', {
        turnId: turn.id,
        ttsOutcome: ttsOutcome.outcome,
        resumed: Boolean(transition?.resumed),
        state: transition?.state
      });
      return transition;
    } catch (error) {
      this._log('Recognition Resume Failed After Assistant Turn', {
        turnId: turn.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Extract the assistant response text without changing the result object.
   * @param {object} result Assistant result.
   * @returns {string}
   * @private
   */
  _extractSpokenResponse(result = {}) {
    return String(result?.response || result?.message || '').trim();
  }

  /**
   * Record manager-side speaking completion when supported.
   * @param {string} outcome TTS outcome.
   * @param {object} metadata Metadata.
   * @returns {void}
   * @private
   */
  _recordManagerSpeakingCompletion(outcome, metadata = {}) {
    if (this.manager && typeof this.manager.completeSpeakingTurn === 'function') {
      this.manager.completeSpeakingTurn(outcome, metadata);
    }
  }

  /**
   * Stop active TTS if supported.
   * @param {string} reason Stop reason.
   * @returns {boolean}
   * @private
   */
  _stopTextToSpeech(reason = 'conversation-cancelled') {
    if (!this.textToSpeech || typeof this.textToSpeech.stop !== 'function') return false;
    const hasActiveTurn = Boolean(this.activeTurn);
    const isSpeaking = Boolean(this.textToSpeech.isSpeaking || this.textToSpeech.activeProcess);
    if (!hasActiveTurn && !isSpeaking) return false;
    try {
      if (this.activeTurn) this.activeTurn.cancelled = true;
      this.textToSpeech.stop();
      if (!hasActiveTurn) {
        this.metrics.ttsCancelled += 1;
        this.emit(EVENTS.TTS_CANCELLED, Object.freeze({ reason }));
      }
      this._log('TTS Cancelled', { reason });
      return true;
    } catch (error) {
      this.metrics.ttsFailed += 1;
      this._log('TTS Cancellation Failed', { reason, error: error.message });
      return false;
    }
  }

  /**
   * Stop TTS when the active voice session is cancelled.
   * @param {object} event Cancel event.
   * @returns {void}
   * @private
   */
  _handleSessionCancelled(event = {}) {
    this._stopTextToSpeech(event?.session?.reason || 'voice-session-cancelled');
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
