class DiscordPlugin {
  constructor(_config, automation, intents) {
    this.automation = automation;
    this.intents = intents;
  }

  async initialize() {
    this.automation.registerAction('plugin.discord.open', () => this.automation.execute('app.open', { appName: 'discord' }));
    this.intents.registerCustom({
      id: 'plugin.discord.open',
      patterns: ['open discord', 'launch discord', 'show discord'],
      permissionLevel: 'low',
      action: 'plugin.discord.open',
      entities: [],
      description: 'Open Discord'
    });
  }
}

module.exports = DiscordPlugin;
