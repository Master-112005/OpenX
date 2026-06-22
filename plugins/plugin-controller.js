const path = require('path');
const fs = require('fs');
const Logger = require('../core/assistant/Data').Logger;

const LEVEL_HIERARCHY = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function safePluginId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

class PluginManager {
  constructor(config, automationEngine, intentRegistry) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
    this.plugins = new Map();
    this.pluginDir = config?.plugins?.directory || path.join(__dirname);
    this.enabled = config?.plugins?.enabled === true;
    this.trustedPlugins = new Set((config?.plugins?.trustedPlugins || []).map(safePluginId));
  }

  async loadAll() {
    if (!this.enabled) {
      this.logger.info('Plugin loading disabled');
      return [];
    }

    this.logger.info('Loading plugins from:', this.pluginDir);

    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true });
      return [];
    }

    const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });
    const loaded = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pluginPath = path.join(this.pluginDir, entry.name);
        const manifestPath = path.join(pluginPath, 'plugin.json');
        const mainPath = path.join(pluginPath, 'index.js');

        if (fs.existsSync(manifestPath) && fs.existsSync(mainPath)) {
          try {
            const plugin = await this._loadPlugin(entry.name, pluginPath);
            loaded.push(plugin);
          } catch (err) {
            this.logger.error(`Failed to load plugin: ${entry.name}`, err);
          }
        }
      }
    }

    this.logger.info(`Loaded ${loaded.length} plugin(s)`);
    return loaded;
  }

  async _loadPlugin(name, pluginPath) {
    const manifest = JSON.parse(fs.readFileSync(path.join(pluginPath, 'plugin.json'), 'utf8'));
    const pluginId = safePluginId(manifest.id || name);
    this._validateManifest(pluginId, manifest, pluginPath);
    const module = require(path.join(pluginPath, 'index.js'));
    const automationFacade = this._createAutomationFacade(pluginId, manifest);
    const intentFacade = this._createIntentFacade(pluginId, manifest);

    const plugin = {
      name,
      id: pluginId,
      manifest,
      module,
      instance: null,
      loaded: false
    };

    if (typeof module.default === 'function') {
      plugin.instance = new module.default(this.config, automationFacade, intentFacade);
    } else if (typeof module.createPlugin === 'function') {
      plugin.instance = await module.createPlugin(this.config, automationFacade, intentFacade);
    } else if (typeof module === 'function') {
      plugin.instance = new module(this.config, automationFacade, intentFacade);
    }

    if (plugin.instance && typeof plugin.instance.initialize === 'function') {
      await plugin.instance.initialize();
    }

    plugin.loaded = true;
    this.plugins.set(name, plugin);
    this.logger.info(`Plugin loaded: ${name} v${manifest.version || '1.0.0'}`);

    return plugin;
  }

  _validateManifest(pluginId, manifest, pluginPath) {
    if (!pluginId) {
      throw new Error('Plugin manifest must include a safe id');
    }

    const resolvedPluginPath = path.resolve(pluginPath);
    const resolvedPluginDir = path.resolve(this.pluginDir);
    const relative = path.relative(resolvedPluginDir, resolvedPluginPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Plugin path escapes the configured plugin directory');
    }

    const isTrusted = manifest.trusted === true || this.trustedPlugins.has(pluginId);
    if (!isTrusted) {
      throw new Error(`Plugin ${pluginId} is not trusted`);
    }

    const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    if (permissions.some(level => LEVEL_HIERARCHY[level] === undefined)) {
      throw new Error(`Plugin ${pluginId} declares an unknown permission level`);
    }
  }

  _maxPermissionLevel(manifest) {
    const permissions = Array.isArray(manifest.permissions) && manifest.permissions.length > 0
      ? manifest.permissions
      : ['low'];
    return permissions.reduce((max, level) => Math.max(max, LEVEL_HIERARCHY[level] ?? 0), 0);
  }

  _assertPluginAction(pluginId, actionId) {
    const action = String(actionId || '').trim();
    const prefix = `plugin.${pluginId}.`;
    if (!action.startsWith(prefix)) {
      throw new Error(`Plugin actions must use the ${prefix} namespace`);
    }
    return action;
  }

  _createAutomationFacade(pluginId) {
    return Object.freeze({
      registerAction: (actionId, handler) => {
        const action = this._assertPluginAction(pluginId, actionId);
        return this.automation.registerAction(action, handler);
      },
      unregisterAction: actionId => {
        const action = this._assertPluginAction(pluginId, actionId);
        return this.automation.unregisterAction(action);
      }
    });
  }

  _createIntentFacade(pluginId, manifest) {
    const maxPermission = this._maxPermissionLevel(manifest);
    return Object.freeze({
      registerCustom: intent => {
        const next = { ...(intent || {}) };
        const intentId = String(next.id || '').trim();
        const prefix = `plugin.${pluginId}.`;
        if (!intentId.startsWith(prefix)) {
          throw new Error(`Plugin intents must use the ${prefix} namespace`);
        }
        next.action = this._assertPluginAction(pluginId, next.action);
        const permissionLevel = next.permissionLevel || 'low';
        if ((LEVEL_HIERARCHY[permissionLevel] ?? 99) > maxPermission) {
          throw new Error(`Plugin intent ${intentId} exceeds declared permissions`);
        }
        return this.intentRegistry.registerCustom(next);
      },
      unregister: intentId => {
        const id = String(intentId || '').trim();
        const prefix = `plugin.${pluginId}.`;
        if (!id.startsWith(prefix)) {
          throw new Error(`Plugin intents must use the ${prefix} namespace`);
        }
        return this.intentRegistry.unregister(id);
      }
    });
  }

  getPlugin(name) {
    return this.plugins.get(name) || null;
  }

  getLoaded() {
    return Array.from(this.plugins.values()).filter(p => p.loaded);
  }

  async unload(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.instance && typeof plugin.instance.destroy === 'function') {
      await plugin.instance.destroy();
    }

    this.plugins.delete(name);
    this.logger.info(`Plugin unloaded: ${name}`);
    return true;
  }

  async reload(name) {
    await this.unload(name);
    const pluginPath = path.join(this.pluginDir, name);
    if (fs.existsSync(pluginPath)) {
      delete require.cache[require.resolve(path.join(pluginPath, 'index.js'))];
      await this._loadPlugin(name, pluginPath);
      return true;
    }
    return false;
  }
}

module.exports = PluginManager;
