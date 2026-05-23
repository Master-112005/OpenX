class SamplePlugin {
  constructor(config, automationEngine, intentRegistry) {
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
    this.name = 'Sample Plugin';
  }

  async initialize() {
    this.automation.registerAction('sample.hello', () => {
      return { success: true, data: { message: 'Hello from Sample Plugin!' } };
    });

    this.intentRegistry.registerCustom({
      id: 'sample.hello',
      patterns: ['say hello', 'hello plugin', 'plugin test'],
      permissionLevel: 'low',
      action: 'sample.hello',
      entities: [],
      description: 'Test the sample plugin'
    });

    return true;
  }

  async destroy() {
    this.automation.unregisterAction('sample.hello');
    this.intentRegistry.unregister('sample.hello');
  }
}

module.exports = SamplePlugin;
