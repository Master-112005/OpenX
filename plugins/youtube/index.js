class YouTubePlugin {
  constructor(_config, automation, intents) {
    this.automation = automation;
    this.intents = intents;
  }

  async initialize() {
    this.automation.registerAction('plugin.youtube.open', entities => this.automation.execute('browser.open', {
      url: entities.url || 'https://www.youtube.com/',
      browserName: entities.browserName
    }));
    this.automation.registerAction('plugin.youtube.library', entities => this.automation.execute('browser.open', {
      url: `https://www.youtube.com/feed/${entities.section || 'subscriptions'}`,
      browserName: entities.browserName
    }));
    this.intents.registerCustom({
      id: 'plugin.youtube.subscriptions',
      patterns: ['open youtube subscriptions', 'show youtube subscriptions', 'open my subscriptions'],
      permissionLevel: 'low',
      action: 'plugin.youtube.library',
      entities: [{ name: 'section', required: false }],
      description: 'Open YouTube subscriptions'
    });
  }
}

module.exports = YouTubePlugin;
