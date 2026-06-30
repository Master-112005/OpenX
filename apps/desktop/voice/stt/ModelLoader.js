'use strict';

const STTConfiguration = require('./STTConfiguration');
const ModelManager = require('./ModelManager');
const {
  ModelLoadFailedError
} = require('./STTErrors');

/**
 * Purpose: Loads, unloads, and reloads STT model resources.
 * Responsibility: Keep model loading separate from streaming recognition and runtime decoding.
 * Dependencies: STTConfiguration, ModelManager, and optional runtime adapter.
 * Lifecycle: load() validates model metadata and initializes the runtime; unload() releases model resources.
 * Future extension notes: Integrity checks and downloads can be added here without touching ParakeetEngine.
 */
class ModelLoader {
  /**
   * Create a model loader.
   * @param {{configuration?: STTConfiguration|object, modelManager?: ModelManager, runtime?: object, logger?: object}} dependencies Loader dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof STTConfiguration
      ? dependencies.configuration
      : new STTConfiguration(dependencies.configuration || {});
    this.modelManager = dependencies.modelManager || new ModelManager({ configuration: this.configuration });
    this.runtime = dependencies.runtime || null;
    this.logger = dependencies.logger || null;
    this.loadedModel = null;
  }

  /**
   * Load configured model metadata and initialize runtime.
   * @returns {object}
   */
  load() {
    try {
      const model = this.modelManager.validateModel();
      if (this.runtime && typeof this.runtime.initialize === 'function') {
        this.runtime.initialize({ model, configuration: this.configuration });
      }
      this.loadedModel = model;
      this._log('Model Loaded', { model });
      return { ...model };
    } catch (error) {
      if (error && error.name && /Model(NotFound|Incompatible)/.test(error.name)) throw error;
      throw new ModelLoadFailedError('STT model failed to load.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Unload configured model resources.
   * @returns {{unloaded: boolean}}
   */
  unload() {
    if (this.runtime && typeof this.runtime.release === 'function') {
      this.runtime.release();
    }
    this.loadedModel = null;
    return { unloaded: true };
  }

  /**
   * Reload configured model resources.
   * @returns {object}
   */
  reload() {
    this.unload();
    return this.load();
  }

  /**
   * Return loaded model metadata.
   * @returns {object|null}
   */
  getLoadedModel() {
    return this.loadedModel ? { ...this.loadedModel } : null;
  }

  /**
   * Normalize error metadata.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error && typeof error.toJSON === 'function') return error.toJSON();
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'ModelLoadError', message: String(error || 'Model loading failed.') };
  }

  /**
   * Write structured STT logs when available.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[STT] ${message}`, metadata);
    }
  }
}

module.exports = ModelLoader;
