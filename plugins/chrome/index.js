class ChromePlugin {
  constructor(_config, automation, intents) {
    this.automation = automation;
    this.intents = intents;
  }

  async initialize() {
    this.automation.registerAction('plugin.chrome.history', () => this.automation.execute('browser.open', {
      url: 'chrome://history/',
      browserName: 'chrome'
    }));
    this.intents.registerCustom({
      id: 'plugin.chrome.history',
      patterns: ['open chrome history', 'show chrome history', 'open browser history'],
      permissionLevel: 'low',
      action: 'plugin.chrome.history',
      entities: [],
      description: 'Open Chrome history'
    });
  }
}

module.exports = ChromePlugin;
