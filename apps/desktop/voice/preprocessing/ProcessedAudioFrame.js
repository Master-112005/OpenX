'use strict';

const AudioFrame = require('../audio/AudioFrame');
const ProcessingConfiguration = require('./ProcessingConfiguration');

/**
 * Purpose: Represents one cleaned, speech-annotated PCM audio frame.
 * Responsibility: Preserve the original AudioFrame reference, cleaned PCM bytes, speech state, confidence, endpoint metadata, and processing metadata.
 * Dependencies: AudioFrame and ProcessingConfiguration for default PCM metadata.
 * Thread ownership: Instances are immutable snapshots after construction.
 * Future integration notes: Future STT engines should consume ProcessedAudioFrame objects, not raw AudioFrame objects.
 */
class ProcessedAudioFrame {
  /**
   * Create a processed audio frame.
   * @param {{originalFrame: AudioFrame, cleanedPcm?: Buffer|Uint8Array|Array<number>, speechActivityState?: string, speechConfidence?: number, endpointCandidate?: boolean, processingMetadata?: object}} options Processed frame options.
   */
  constructor(options = {}) {
    if (!(options.originalFrame instanceof AudioFrame)) {
      throw new Error('ProcessedAudioFrame requires an original AudioFrame.');
    }
    const config = ProcessingConfiguration.defaults();
    this.originalFrame = options.originalFrame;
    this.cleanedPcm = AudioFrame.normalizePcm(options.cleanedPcm || options.originalFrame.getPcmBuffer());
    this.timestamp = new Date(options.originalFrame.timestamp);
    this.speechActivityState = String(options.speechActivityState || 'UNKNOWN');
    this.speechConfidence = ProcessedAudioFrame._clamp(Number(options.speechConfidence) || 0, 0, 1);
    this.endpointCandidate = Boolean(options.endpointCandidate);
    this.sampleRate = Number(options.sampleRate) || options.originalFrame.sampleRate || config.sampleRate;
    this.channels = Number(options.channels) || options.originalFrame.channels || config.channels;
    this.processingMetadata = {
      rnnoiseApplied: false,
      vadApplied: false,
      latencyMs: 0,
      ...(options.processingMetadata || {})
    };
    Object.freeze(this.processingMetadata);
    Object.freeze(this);
  }

  /**
   * Return a copy of cleaned PCM bytes.
   * @returns {Buffer}
   */
  getPcmBuffer() {
    return Buffer.from(this.cleanedPcm);
  }

  /**
   * Return metadata without PCM bytes.
   * @returns {object}
   */
  toMetadata() {
    return {
      frameIndex: this.originalFrame.frameIndex,
      timestamp: this.timestamp.toISOString(),
      sampleCount: this.originalFrame.sampleCount,
      durationMs: this.originalFrame.durationMs,
      sampleRate: this.sampleRate,
      channels: this.channels,
      byteLength: this.cleanedPcm.length,
      originalFrame: this.originalFrame.toMetadata(),
      speechActivityState: this.speechActivityState,
      speechConfidence: this.speechConfidence,
      endpointCandidate: this.endpointCandidate,
      processingMetadata: { ...this.processingMetadata }
    };
  }

  /**
   * Return JSON-safe processed frame data including cleaned PCM bytes.
   * @returns {object}
   */
  toJSON() {
    return {
      ...this.toMetadata(),
      cleanedPcm: Array.from(this.cleanedPcm)
    };
  }

  /**
   * Clamp a numeric value.
   * @param {number} value Candidate value.
   * @param {number} min Minimum.
   * @param {number} max Maximum.
   * @returns {number}
   * @private
   */
  static _clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}

module.exports = ProcessedAudioFrame;
