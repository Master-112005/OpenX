'use strict';

/**
 * Purpose: Represents the future audio-buffer abstraction.
 * Responsibility: Define metadata and buffer-shape APIs without storing real audio frames.
 * Dependencies: None.
 * Future implementation notes: Raw PCM, encoded audio, and streaming chunks should be introduced behind this API later.
 */
class AudioBuffer {
  /**
   * Create metadata-only audio buffer placeholder.
   * @param {{sampleRate?: number, channels?: number, durationMs?: number}} metadata Buffer metadata.
   */
  constructor(metadata = {}) {
    this.sampleRate = Number(metadata.sampleRate) || 0;
    this.channels = Number(metadata.channels) || 0;
    this.durationMs = Number(metadata.durationMs) || 0;
  }

  /**
   * Return true when this placeholder contains no audio frames.
   * @returns {boolean}
   */
  isEmpty() {
    return true;
  }

  /**
   * Return JSON-safe metadata.
   * @returns {{sampleRate: number, channels: number, durationMs: number}}
   */
  toJSON() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      durationMs: this.durationMs
    };
  }
}

module.exports = AudioBuffer;
