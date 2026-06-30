'use strict';

const fs = require('fs');
const STTConfiguration = require('./STTConfiguration');
const {
  ModelNotFoundError,
  ModelIncompatibleError
} = require('./STTErrors');

/**
 * Purpose: Locates and validates STT model metadata.
 * Responsibility: Resolve model paths, validate model availability/compatibility, and expose supported engine metadata.
 * Dependencies: fs and STTConfiguration.
 * Lifecycle: Used before ModelLoader initializes runtime resources.
 * Future extension notes: Additional model families should register here without changing STTEngine.
 */
class ModelManager {
  /**
   * Create a model manager.
   * @param {{configuration?: STTConfiguration|object, fsAdapter?: object, models?: object[]}} dependencies Model dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof STTConfiguration
      ? dependencies.configuration
      : new STTConfiguration(dependencies.configuration || {});
    this.fs = dependencies.fsAdapter || fs;
    this.models = Array.isArray(dependencies.models) ? dependencies.models.slice() : [];
  }

  /**
   * Return supported engine names.
   * @returns {string[]}
   */
  getAvailableEngines() {
    return ['parakeet'];
  }

  /**
   * Locate configured model metadata.
   * @returns {object}
   */
  locateModel() {
    const configured = this.models.find(model => model.name === this.configuration.modelName || model.path === this.configuration.modelPath);
    const model = configured || {
      name: this.configuration.modelName,
      engine: this.configuration.activeEngine,
      path: this.configuration.modelPath,
      language: this.configuration.language,
      runtime: 'sherpa-onnx'
    };
    return { ...model };
  }

  /**
   * Validate configured model availability.
   * @returns {object}
   */
  validateModel() {
    const model = this.locateModel();
    const exists = model.mockAvailable === true
      || (typeof this.fs.existsSync === 'function' && this.fs.existsSync(model.path));
    if (!exists) {
      throw new ModelNotFoundError('STT model was not found.', { details: { model } });
    }
    this.verifyCompatibility(model);
    return model;
  }

  /**
   * Verify model compatibility with the configured engine/runtime.
   * @param {object} model Model metadata.
   * @returns {true}
   */
  verifyCompatibility(model) {
    if (model.engine && model.engine !== this.configuration.activeEngine) {
      throw new ModelIncompatibleError('STT model engine is incompatible.', {
        details: { modelEngine: model.engine, activeEngine: this.configuration.activeEngine }
      });
    }
    return true;
  }
}

module.exports = ModelManager;
