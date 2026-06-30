'use strict';

/**
 * Purpose: Defines structured Voice integration errors.
 * Responsibility: Keep adapter and bridge failures separate from assistant failures.
 * Dependencies: None.
 * Lifecycle: Thrown before Assistant.processCommand when transcript or bridge state is invalid.
 * Future extension notes: Never include audio, STT metadata, or assistant internals in serialized errors.
 */
class VoiceIntegrationError extends Error {
  /**
   * Create a Voice integration error.
   * @param {string} message Safe error message.
   * @param {{code?: string, details?: object}} options Error metadata.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || this.constructor.name;
    this.details = Object.freeze({ ...(options.details || {}) });
  }

  /**
   * Return JSON-safe error metadata.
   * @returns {{name: string, code: string, message: string, details: object}}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: { ...this.details }
    };
  }
}

class EmptyVoiceCommandError extends VoiceIntegrationError {}
class InvalidNormalizedTranscriptError extends VoiceIntegrationError {}
class AssistantUnavailableError extends VoiceIntegrationError {}
class DispatchFailedError extends VoiceIntegrationError {}
class BridgeAttachmentFailedError extends VoiceIntegrationError {}
class VoiceExecutionCancelledError extends VoiceIntegrationError {}
class VoiceIntegrationConfigurationError extends VoiceIntegrationError {}

module.exports = {
  VoiceIntegrationError,
  EmptyVoiceCommandError,
  InvalidNormalizedTranscriptError,
  AssistantUnavailableError,
  DispatchFailedError,
  BridgeAttachmentFailedError,
  VoiceExecutionCancelledError,
  VoiceIntegrationConfigurationError
};
