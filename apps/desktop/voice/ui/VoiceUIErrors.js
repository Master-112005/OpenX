'use strict';

/**
 * Purpose: Defines structured Voice UI errors.
 * Responsibility: Keep overlay failures serializable and user safe.
 * Dependencies: None.
 * Lifecycle: Thrown by UI presentation classes only.
 * Future extension notes: Do not include stack traces or recognition internals in serialized errors.
 */
class VoiceUIError extends Error {
  /**
   * Create a Voice UI error.
   * @param {string} message User-safe message.
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

class OverlayCreationFailed extends VoiceUIError {}
class RendererUnavailable extends VoiceUIError {}
class IPCFailure extends VoiceUIError {}
class ThemeLoadFailure extends VoiceUIError {}
class AnimationFailure extends VoiceUIError {}
class AccessibilityFailure extends VoiceUIError {}

module.exports = {
  VoiceUIError,
  OverlayCreationFailed,
  RendererUnavailable,
  IPCFailure,
  ThemeLoadFailure,
  AnimationFailure,
  AccessibilityFailure
};
