class SamplePlugin {
  constructor(config, automationEngine, intentRegistry) {
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
  }

  async initialize() {
    this.automation.registerAction('plugin.sample_plugin.hello', () => ({
      success: true,
      data: { message: 'Hello from Sample Plugin!' }
    }));
    this.intentRegistry.registerCustom({
      id: 'plugin.sample_plugin.hello',
      patterns: ['say hello', 'hello plugin', 'plugin test'],
      permissionLevel: 'low',
      action: 'plugin.sample_plugin.hello',
      entities: [],
      description: 'Test the sample plugin'
    });
  }
}

module.exports = SamplePlugin;
