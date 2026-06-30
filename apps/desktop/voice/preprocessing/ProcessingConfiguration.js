'use strict';

const { UnsupportedProcessingSampleRateError } = require('./AudioProcessingErrors');

const DEFAULT_PROCESSING_CONFIGURATION = Object.freeze({
  pipelineEnabled: true,
  rnnoiseEnabled: true,
  rnnoiseAggressiveness: 0.6,
  vadEnabled: true,
  speechThreshold: 0.08,
  silenceThreshold: 0.025,
  minimumSpeechDurationMs: 120,
  maximumSilenceDurationMs: 500,
  endpointSilenceDurationMs: 800,
  frameSizeMs: 20,
  frameSize: 320,
  sampleRate: 16000,
  channels: 1,
  sttCompatibilityMode: 'processed-pcm'
});

/**
 * Purpose: Owns preprocessing configuration for RNNoise, VAD, endpoint estimation, and future STT compatibility.
 * Responsibility: Validate and expose processing thresholds without hardcoded values across the pipeline.
 * Dependencies: AudioProcessingErrors for structured validation failures.
 * Thread ownership: Instances are immutable snapshots and can be safely shared across streaming processors.
 * Future integration notes: User settings should merge into this class before initializing AudioProcessor.
 */
class ProcessingConfiguration {
  /**
   * Create immutable preprocessing configuration.
   * @param {object} options Configuration overrides.
   */
  constructor(options = {}) {
    const merged = { ...DEFAULT_PROCESSING_CONFIGURATION, ...options };
    ProcessingConfiguration.validate(merged);
    this.pipelineEnabled = Boolean(merged.pipelineEnabled);
    this.rnnoiseEnabled = Boolean(merged.rnnoiseEnabled);
    this.rnnoiseAggressiveness = ProcessingConfiguration._clamp(Number(merged.rnnoiseAggressiveness), 0, 1);
    this.vadEnabled = Boolean(merged.vadEnabled);
    this.speechThreshold = ProcessingConfiguration._clamp(Number(merged.speechThreshold), 0, 1);
    this.silenceThreshold = ProcessingConfiguration._clamp(Number(merged.silenceThreshold), 0, 1);
    this.minimumSpeechDurationMs = Number(merged.minimumSpeechDurationMs);
    this.maximumSilenceDurationMs = Number(merged.maximumSilenceDurationMs);
    this.endpointSilenceDurationMs = Number(merged.endpointSilenceDurationMs);
    this.frameSizeMs = Number(merged.frameSizeMs);
    this.frameSize = Number(merged.frameSize);
    this.sampleRate = Number(merged.sampleRate);
    this.channels = Number(merged.channels);
    this.sttCompatibilityMode = String(merged.sttCompatibilityMode || DEFAULT_PROCESSING_CONFIGURATION.sttCompatibilityMode);
    Object.freeze(this);
  }

  /**
   * Return default preprocessing configuration.
   * @returns {ProcessingConfiguration}
   */
  static defaults() {
    return new ProcessingConfiguration();
  }

  /**
   * Merge overrides into this configuration.
   * @param {object} overrides Configuration overrides.
   * @returns {ProcessingConfiguration}
   */
  merge(overrides = {}) {
    return new ProcessingConfiguration({ ...this.toJSON(), ...overrides });
  }

  /**
   * Validate preprocessing configuration values.
   * @param {object} config Candidate configuration.
   * @returns {true}
   */
  static validate(config = {}) {
    const sampleRate = Number(config.sampleRate);
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new UnsupportedProcessingSampleRateError('Processing sample rate must be a positive integer.', {
        details: { sampleRate: config.sampleRate }
      });
    }
    const numericFields = [
      'minimumSpeechDurationMs',
      'maximumSilenceDurationMs',
      'endpointSilenceDurationMs',
      'frameSizeMs',
      'frameSize',
      'channels'
    ];
    for (const field of numericFields) {
      if (!Number.isFinite(Number(config[field])) || Number(config[field]) <= 0) {
        throw new Error(`Processing configuration ${field} must be a positive number.`);
      }
    }
    return true;
  }

  /**
   * Return JSON-safe configuration data.
   * @returns {object}
   */
  toJSON() {
    return {
      pipelineEnabled: this.pipelineEnabled,
      rnnoiseEnabled: this.rnnoiseEnabled,
      rnnoiseAggressiveness: this.rnnoiseAggressiveness,
      vadEnabled: this.vadEnabled,
      speechThreshold: this.speechThreshold,
      silenceThreshold: this.silenceThreshold,
      minimumSpeechDurationMs: this.minimumSpeechDurationMs,
      maximumSilenceDurationMs: this.maximumSilenceDurationMs,
      endpointSilenceDurationMs: this.endpointSilenceDurationMs,
      frameSizeMs: this.frameSizeMs,
      frameSize: this.frameSize,
      sampleRate: this.sampleRate,
      channels: this.channels,
      sttCompatibilityMode: this.sttCompatibilityMode
    };
  }

  /**
   * Clamp a number into a min/max range.
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

ProcessingConfiguration.DEFAULTS = DEFAULT_PROCESSING_CONFIGURATION;

module.exports = ProcessingConfiguration;
