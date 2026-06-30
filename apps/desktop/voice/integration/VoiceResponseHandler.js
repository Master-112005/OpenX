'use strict';

const EventEmitter = require('events');
const EVENTS = require('./VoiceIntegrationEvents');

/**
 * Purpose: Forwards assistant responses from voice dispatch unchanged.
 * Responsibility: Emit response-ready coordination events and preserve the exact assistant response structure.
 * Dependencies: Optional logger.
 * Lifecycle: Called after AssistantDispatcher resolves.
 * Future extension notes: Do not add voice-specific responses or mutate assistant result objects.
 */
class VoiceResponseHandler extends EventEmitter {
  /**
   * Create response handler.
   * @param {{logger?: object}} dependencies Handler dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.logger = dependencies.logger || null;
    this.responseCount = 0;
  }

  /**
   * Forward an assistant result unchanged.
   * @param {object} result Assistant result.
   * @returns {object}
   */
  handle(result) {
    this.responseCount += 1;
    this.emit(EVENTS.VOICE_RESPONSE_READY, Object.freeze({ result }));
    this._log('Response Returned', { success: Boolean(result?.success) });
    return result;
  }

  /**
   * Return response metrics.
   * @returns {{responseCount: number}}
   */
  getMetrics() {
    return { responseCount: this.responseCount };
  }

  /**
   * Write structured response logs.
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

module.exports = VoiceResponseHandler;
