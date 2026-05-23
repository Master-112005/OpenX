const Logger = require('../../shared/index').Logger;

const MAX_HISTORY = 100;
const MAX_CONTEXT_AGE_MS = 300000;

class ContextManager {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.history = [];
    this.sessionData = new Map();
    this.maxHistory = config?.chat?.maxHistory || MAX_HISTORY;
    this.lastInteraction = null;
  }

  record(input, parsed, result) {
    const entry = {
      timestamp: Date.now(),
      input,
      commandId: result?.commandId || null,
      intent: result?.intent || null,
      confidence: result?.confidence || 0,
      success: result?.success || false,
      entities: result?.entities || {},
      response: result?.response || ''
    };

    this.history.push(entry);
    this.lastInteraction = Date.now();

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this._cleanup();
  }

  getHistory(limit = 10) {
    return this.history.slice(-limit);
  }

  getLastIntent() {
    if (this.history.length === 0) return null;
    const last = this.history[this.history.length - 1];
    return last.intent || null;
  }

  getLastEntities() {
    if (this.history.length === 0) return {};
    const last = this.history[this.history.length - 1];
    return last.entities || {};
  }

  setSessionData(key, value) {
    this.sessionData.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  getSessionData(key) {
    const data = this.sessionData.get(key);
    if (!data) return null;
    if (Date.now() - data.timestamp > MAX_CONTEXT_AGE_MS) {
      this.sessionData.delete(key);
      return null;
    }
    return data.value;
  }

  clearSession() {
    this.sessionData.clear();
  }

  getLastInteractionTime() {
    return this.lastInteraction;
  }

  getRecentCommands(count = 5) {
    return this.history.slice(-count).map(h => h.input);
  }

  getConversationSummary() {
    const successful = this.history.filter(h => h.success).length;
    const total = this.history.length;
    return {
      totalCommands: total,
      successfulCommands: successful,
      failedCommands: total - successful,
      lastInteraction: this.lastInteraction,
      sessionKeys: Array.from(this.sessionData.keys())
    };
  }

  _cleanup() {
    const cutoff = Date.now() - MAX_CONTEXT_AGE_MS;
    this.history = this.history.filter(h => h.timestamp >= cutoff);

    for (const [key, data] of this.sessionData) {
      if (Date.now() - data.timestamp > MAX_CONTEXT_AGE_MS) {
        this.sessionData.delete(key);
      }
    }
  }
}

module.exports = ContextManager;
