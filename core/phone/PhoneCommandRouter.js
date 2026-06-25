class PhoneCommandRouter {
  constructor(assistantProvider) {
    if (typeof assistantProvider === 'function') {
      this.getAssistant = assistantProvider;
    } else {
      this.getAssistant = () => assistantProvider;
    }
  }

  async route(command, options = {}) {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('Command must be a non-empty string');
    }

    const assistant = this.getAssistant();
    if (!assistant || typeof assistant.processCommand !== 'function') {
      throw new Error('Assistant not initialized');
    }

    const commandOptions = {};
    if (typeof options.permissionGuard === 'function') {
      commandOptions.permissionGuard = options.permissionGuard;
    }
    if (options.phoneContext && typeof options.phoneContext === 'object') {
      commandOptions.phoneContext = options.phoneContext;
    }
    return assistant.processCommand(command.trim(), 'phone', commandOptions);
  }
}

module.exports = PhoneCommandRouter;
