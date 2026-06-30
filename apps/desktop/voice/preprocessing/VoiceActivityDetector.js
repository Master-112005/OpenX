'use strict';

/**
 * Purpose: Defines the future Voice Activity Detection boundary.
 * Responsibility: Provide a replaceable VAD interface without analyzing audio.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Any future VAD model must return decisions through this stable API.
 */
class VoiceActivityDetector {
  /**
   * Placeholder voice detection call.
   * @param {object} audioBuffer Future audio buffer.
   * @returns {{hasVoice: boolean, confidence: number, audioBuffer: object}}
   */
  detect(audioBuffer) {
    return { hasVoice: false, confidence: 0, audioBuffer };
  }
}

module.exports = VoiceActivityDetector;
