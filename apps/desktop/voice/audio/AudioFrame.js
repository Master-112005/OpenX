'use strict';

const AudioConfiguration = require('./AudioConfiguration');

/**
 * Purpose: Represents one ordered frame of raw PCM audio plus metadata.
 * Responsibility: Carry frame index, timestamp, sample count, duration, PCM format, and PCM bytes without speech processing.
 * Dependencies: AudioConfiguration for default PCM shape.
 * Thread ownership: Frames are immutable snapshots after construction.
 * Future integration notes: Preprocessing and STT stages should consume AudioFrame instances rather than backend-specific buffers.
 */
class AudioFrame {
  /**
   * Create an audio frame.
   * @param {{frameIndex?: number, timestamp?: Date|string, pcm?: Buffer|Uint8Array|Array<number>, sampleRate?: number, channels?: number, bitDepth?: number, sampleCount?: number, durationMs?: number, deviceId?: string}} options Frame metadata.
   */
  constructor(options = {}) {
    const config = AudioConfiguration.defaults();
    this.frameIndex = Number.isInteger(options.frameIndex) ? options.frameIndex : 0;
    this.timestamp = options.timestamp ? new Date(options.timestamp) : new Date();
    this.sampleRate = Number(options.sampleRate) || config.sampleRate;
    this.channels = Number(options.channels) || config.channels;
    this.bitDepth = Number(options.bitDepth) || config.bitDepth;
    this.pcm = AudioFrame.normalizePcm(options.pcm);
    this.sampleCount = Number(options.sampleCount) || this._deriveSampleCount();
    this.durationMs = Number(options.durationMs) || this._deriveDurationMs();
    this.deviceId = String(options.deviceId || '');
    Object.freeze(this);
  }

  /**
   * Normalize PCM bytes into a Buffer.
   * @param {Buffer|Uint8Array|Array<number>|undefined} pcm Raw PCM bytes.
   * @returns {Buffer}
   */
  static normalizePcm(pcm) {
    if (!pcm) return Buffer.alloc(0);
    if (Buffer.isBuffer(pcm)) return Buffer.from(pcm);
    if (pcm instanceof Uint8Array || Array.isArray(pcm)) return Buffer.from(pcm);
    throw new Error('AudioFrame PCM data must be a Buffer, Uint8Array, or byte array.');
  }

  /**
   * Return a copy of the PCM buffer.
   * @returns {Buffer}
   */
  getPcmBuffer() {
    return Buffer.from(this.pcm);
  }

  /**
   * Return metadata without PCM bytes for logs and session snapshots.
   * @returns {object}
   */
  toMetadata() {
    return {
      frameIndex: this.frameIndex,
      timestamp: this.timestamp.toISOString(),
      sampleCount: this.sampleCount,
      durationMs: this.durationMs,
      sampleRate: this.sampleRate,
      channels: this.channels,
      bitDepth: this.bitDepth,
      byteLength: this.pcm.length,
      deviceId: this.deviceId
    };
  }

  /**
   * Return JSON-safe frame data including PCM bytes.
   * @returns {object}
   */
  toJSON() {
    return {
      ...this.toMetadata(),
      pcm: Array.from(this.pcm)
    };
  }

  /**
   * Derive the sample count from PCM bytes and format metadata.
   * @returns {number}
   * @private
   */
  _deriveSampleCount() {
    const bytesPerSample = Math.max(1, this.bitDepth / 8);
    const frameWidth = Math.max(1, bytesPerSample * this.channels);
    return Math.floor(this.pcm.length / frameWidth);
  }

  /**
   * Derive frame duration from sample count and sample rate.
   * @returns {number}
   * @private
   */
  _deriveDurationMs() {
    if (!this.sampleRate) return 0;
    return (this.sampleCount / this.sampleRate) * 1000;
  }
}

module.exports = AudioFrame;
