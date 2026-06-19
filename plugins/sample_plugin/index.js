class SamplePlugin {
  constructor(config, automationEngine, intentRegistry) {
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
    this.name = 'Sample Plugin';
  }

  async initialize() {
    this.automation.registerAction('plugin.sample_plugin.hello', () => {
      return { success: true, data: { message: 'Hello from Sample Plugin!' } };
    });

    this.intentRegistry.registerCustom({
      id: 'plugin.sample_plugin.hello',
      patterns: ['say hello', 'hello plugin', 'plugin test'],
      permissionLevel: 'low',
      action: 'plugin.sample_plugin.hello',
      entities: [],
      description: 'Test the sample plugin'
    });

    return true;
  }

  async destroy() {
    this.automation.unregisterAction('plugin.sample_plugin.hello');
    this.intentRegistry.unregister('plugin.sample_plugin.hello');
  }
}

module.exports = SamplePlugin;
