'use strict';

const { UnsupportedSampleRateError } = require('./AudioErrors');

const DEFAULT_AUDIO_CONFIGURATION = Object.freeze({
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  frameSize: 320,
  bufferSize: 100,
  latencyTargetMs: 50,
  preferredDeviceId: '',
  autoDeviceSwitching: true,
  noiseSuppression: false,
  vadEnabled: false,
  sttReady: false,
  endianness: 'LE',
  encoding: 'PCM'
});

/**
 * Purpose: Owns configurable PCM audio settings for the OpenX Audio Layer.
 * Responsibility: Validate and expose sample rate, channel count, bit depth, frame size, buffer size, latency, device preference, and future placeholders.
 * Dependencies: AudioErrors for structured validation failures.
 * Thread ownership: Instances are immutable snapshots and can be safely shared with future async capture code.
 * Future integration notes: Runtime settings should merge into this class before creating AudioCapture or AudioBuffer instances.
 */
class AudioConfiguration {
  /**
   * Create an immutable audio configuration.
   * @param {object} options Audio configuration overrides.
   */
  constructor(options = {}) {
    const merged = { ...DEFAULT_AUDIO_CONFIGURATION, ...options };
    AudioConfiguration.validate(merged);
    this.sampleRate = Number(merged.sampleRate);
    this.channels = Number(merged.channels);
    this.bitDepth = Number(merged.bitDepth);
    this.frameSize = Number(merged.frameSize);
    this.bufferSize = Number(merged.bufferSize);
    this.latencyTargetMs = Number(merged.latencyTargetMs);
    this.preferredDeviceId = String(merged.preferredDeviceId || '');
    this.autoDeviceSwitching = Boolean(merged.autoDeviceSwitching);
    this.noiseSuppression = Boolean(merged.noiseSuppression);
    this.vadEnabled = Boolean(merged.vadEnabled);
    this.sttReady = Boolean(merged.sttReady);
    this.endianness = String(merged.endianness || DEFAULT_AUDIO_CONFIGURATION.endianness);
    this.encoding = String(merged.encoding || DEFAULT_AUDIO_CONFIGURATION.encoding);
    Object.freeze(this);
  }

  /**
   * Return the default audio configuration.
   * @returns {AudioConfiguration}
   */
  static defaults() {
    return new AudioConfiguration();
  }

  /**
   * Merge overrides into this configuration.
   * @param {object} overrides Configuration overrides.
   * @returns {AudioConfiguration}
   */
  merge(overrides = {}) {
    return new AudioConfiguration({ ...this.toJSON(), ...overrides });
  }

  /**
   * Validate an audio configuration object.
   * @param {object} config Candidate configuration.
   * @returns {true}
   */
  static validate(config = {}) {
    const sampleRate = Number(config.sampleRate);
    const channels = Number(config.channels);
    const bitDepth = Number(config.bitDepth);
    const frameSize = Number(config.frameSize);
    const bufferSize = Number(config.bufferSize);

    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new UnsupportedSampleRateError('Audio sample rate must be a positive integer.', {
        details: { sampleRate: config.sampleRate }
      });
    }
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new Error('Audio channel count must be a positive integer.');
    }
    if (!Number.isInteger(bitDepth) || bitDepth <= 0) {
      throw new Error('Audio bit depth must be a positive integer.');
    }
    if (!Number.isInteger(frameSize) || frameSize <= 0) {
      throw new Error('Audio frame size must be a positive integer.');
    }
    if (!Number.isInteger(bufferSize) || bufferSize <= 0) {
      throw new Error('Audio buffer size must be a positive integer.');
    }
    return true;
  }

  /**
   * Return the documented PCM format expected by future processing stages.
   * @returns {{encoding: string, bitDepth: number, channels: number, sampleRate: number, endianness: string}}
   */
  getPcmFormat() {
    return {
      encoding: this.encoding,
      bitDepth: this.bitDepth,
      channels: this.channels,
      sampleRate: this.sampleRate,
      endianness: this.endianness
    };
  }

  /**
   * Return JSON-safe configuration data.
   * @returns {object}
   */
  toJSON() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      bitDepth: this.bitDepth,
      frameSize: this.frameSize,
      bufferSize: this.bufferSize,
      latencyTargetMs: this.latencyTargetMs,
      preferredDeviceId: this.preferredDeviceId,
      autoDeviceSwitching: this.autoDeviceSwitching,
      noiseSuppression: this.noiseSuppression,
      vadEnabled: this.vadEnabled,
      sttReady: this.sttReady,
      endianness: this.endianness,
      encoding: this.encoding
    };
  }
}

AudioConfiguration.DEFAULTS = DEFAULT_AUDIO_CONFIGURATION;

module.exports = AudioConfiguration;
