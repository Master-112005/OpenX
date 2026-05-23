const path = require('path');
const fs = require('fs');
const Logger = require('../core/shared/index').Logger;

class PluginManager {
  constructor(config, automationEngine, intentRegistry) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
    this.plugins = new Map();
    this.pluginDir = config?.plugins?.directory || path.join(__dirname);
  }

  async loadAll() {
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
    const module = require(path.join(pluginPath, 'index.js'));

    const plugin = {
      name,
      manifest,
      module,
      instance: null,
      loaded: false
    };

    if (typeof module.default === 'function') {
      plugin.instance = new module.default(this.config, this.automation, this.intentRegistry);
    } else if (typeof module.createPlugin === 'function') {
      plugin.instance = await module.createPlugin(this.config, this.automation, this.intentRegistry);
    }

    if (plugin.instance && typeof plugin.instance.initialize === 'function') {
      await plugin.instance.initialize();
    }

    plugin.loaded = true;
    this.plugins.set(name, plugin);
    this.logger.info(`Plugin loaded: ${name} v${manifest.version || '1.0.0'}`);

    return plugin;
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
