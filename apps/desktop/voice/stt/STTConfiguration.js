'use strict';

const path = require('path');

const DEFAULT_STT_CONFIGURATION = Object.freeze({
  activeEngine: 'parakeet',
  modelPath: path.join('models', 'stt', 'parakeet-tdt-v3'),
  modelName: 'nvidia-parakeet-tdt-v3',
  language: 'en-US',
  beamWidth: 4,
  decodingStrategy: 'streaming-greedy',
  partialResultIntervalMs: 120,
  confidenceThreshold: 0.01,
  streamingEnabled: true,
  gpuEnabled: false,
  cpuFallback: true,
  loggingEnabled: true,
  inferenceTimeoutMs: 10000
});

/**
 * Purpose: Owns centralized Speech-to-Text configuration.
 * Responsibility: Validate model, language, decoding, streaming, GPU, fallback, and logging settings without hardcoded values elsewhere.
 * Dependencies: Node path for default relative model location.
 * Lifecycle: Immutable configuration snapshots are passed into engines, model loaders, and runtime adapters.
 * Future extension notes: User settings can merge into this class while keeping STTEngine model-agnostic.
 */
class STTConfiguration {
  /**
   * Create immutable STT configuration.
   * @param {object} options Configuration overrides.
   */
  constructor(options = {}) {
    const merged = { ...DEFAULT_STT_CONFIGURATION, ...options };
    STTConfiguration.validate(merged);
    this.activeEngine = String(merged.activeEngine);
    this.modelPath = String(merged.modelPath);
    this.modelName = String(merged.modelName);
    this.language = String(merged.language);
    this.beamWidth = Number(merged.beamWidth);
    this.decodingStrategy = String(merged.decodingStrategy);
    this.partialResultIntervalMs = Number(merged.partialResultIntervalMs);
    this.confidenceThreshold = Number(merged.confidenceThreshold);
    this.streamingEnabled = Boolean(merged.streamingEnabled);
    this.gpuEnabled = Boolean(merged.gpuEnabled);
    this.cpuFallback = Boolean(merged.cpuFallback);
    this.loggingEnabled = Boolean(merged.loggingEnabled);
    this.inferenceTimeoutMs = Number(merged.inferenceTimeoutMs);
    Object.freeze(this);
  }

  /**
   * Return default STT configuration.
   * @returns {STTConfiguration}
   */
  static defaults() {
    return new STTConfiguration();
  }

  /**
   * Merge overrides into this configuration.
   * @param {object} overrides Configuration overrides.
   * @returns {STTConfiguration}
   */
  merge(overrides = {}) {
    return new STTConfiguration({ ...this.toJSON(), ...overrides });
  }

  /**
   * Validate configuration values.
   * @param {object} config Candidate configuration.
   * @returns {true}
   */
  static validate(config = {}) {
    if (!String(config.activeEngine || '').trim()) throw new Error('STT active engine is required.');
    if (!String(config.modelPath || '').trim()) throw new Error('STT model path is required.');
    if (!Number.isFinite(Number(config.beamWidth)) || Number(config.beamWidth) <= 0) {
      throw new Error('STT beam width must be a positive number.');
    }
    if (!Number.isFinite(Number(config.partialResultIntervalMs)) || Number(config.partialResultIntervalMs) < 0) {
      throw new Error('STT partial result interval must be non-negative.');
    }
    if (!Number.isFinite(Number(config.inferenceTimeoutMs)) || Number(config.inferenceTimeoutMs) <= 0) {
      throw new Error('STT inference timeout must be a positive number.');
    }
    return true;
  }

  /**
   * Return JSON-safe configuration data.
   * @returns {object}
   */
  toJSON() {
    return {
      activeEngine: this.activeEngine,
      modelPath: this.modelPath,
      modelName: this.modelName,
      language: this.language,
      beamWidth: this.beamWidth,
      decodingStrategy: this.decodingStrategy,
      partialResultIntervalMs: this.partialResultIntervalMs,
      confidenceThreshold: this.confidenceThreshold,
      streamingEnabled: this.streamingEnabled,
      gpuEnabled: this.gpuEnabled,
      cpuFallback: this.cpuFallback,
      loggingEnabled: this.loggingEnabled,
      inferenceTimeoutMs: this.inferenceTimeoutMs
    };
  }
}

STTConfiguration.DEFAULTS = DEFAULT_STT_CONFIGURATION;

module.exports = STTConfiguration;
