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

    if (typeof options.permissionGuard === 'function') {
      return assistant.processCommand(command.trim(), 'phone', {
        permissionGuard: options.permissionGuard
      });
    }
    return assistant.processCommand(command.trim(), 'phone');
  }
}

module.exports = PhoneCommandRouter;
