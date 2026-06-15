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
    this.userPreferences = new Map();
    this.userFacts = new Map();
    this.pendingTasks = [];
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
      response: result?.response || '',
      data: result?.data || null,
      languageUnderstanding: result?.languageUnderstanding || null,
      validation: result?.validation || result?.data?.validation || null,
      verification: result?.verification || result?.data?.verification || null
    };

    this.history.push(entry);
    this.lastInteraction = Date.now();
    this._extractUserPreferences(input, result);
    this._trackPendingTask(input, result);

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this._cleanup();
  }

  _extractUserPreferences(input, result) {
    const text = String(input || '').toLowerCase();
    if (result?.success) {
      if (/\bprefer|preference|usually|always|normally|i like|i want|i need\b/i.test(text)) {
        const appMatch = text.match(/\b(?:chrome|edge|firefox|notepad|vs code|visual studio)\b/i);
        if (appMatch) {
          this.setUserPreference('preferredBrowser', appMatch[1].toLowerCase());
        }
      }
    }
  }

  _trackPendingTask(input, result) {
    const intent = result?.intent || '';
    const entities = result?.entities || {};

    if (intent === 'reminder.set' && entities?.reminderText) {
      this.pendingTasks.push({
        type: 'reminder',
        text: entities.reminderText,
        timestamp: Date.now()
      });
    }

    if (intent === 'timer.set' && entities?.duration) {
      this.pendingTasks.push({
        type: 'timer',
        duration: entities.duration,
        timestamp: Date.now()
      });
    }

    this.pendingTasks = this.pendingTasks.filter(t => Date.now() - t.timestamp < 3600000);
  }

  setUserPreference(key, value) {
    this.userPreferences.set(key, {
      value,
      timestamp: Date.now(),
      count: (this.userPreferences.get(key)?.count || 0) + 1
    });
  }

  getUserPreference(key) {
    const pref = this.userPreferences.get(key);
    if (!pref) return null;
    if (Date.now() - pref.timestamp > 86400000) {
      this.userPreferences.delete(key);
      return null;
    }
    return pref.value;
  }

  setUserFact(key, value) {
    this.userFacts.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  getUserFact(key) {
    const fact = this.userFacts.get(key);
    if (!fact) return null;
    return fact.value;
  }

  getAllUserFacts() {
    const facts = {};
    for (const [key, fact] of this.userFacts.entries()) {
      facts[key] = fact.value;
    }
    return facts;
  }

  getRecentTasks() {
    return this.pendingTasks.filter(t => Date.now() - t.timestamp < 3600000);
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

  getCommandsToday() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.history.filter(entry => entry.timestamp >= start.getTime());
  }

  getFirstCommandToday() {
    return this.getCommandsToday()[0] || null;
  }

  getLastCommand() {
    return this.history[this.history.length - 1] || null;
  }

  findRecent(predicate, limit = 20) {
    if (typeof predicate !== 'function') {
      return null;
    }
    return this.history
      .slice(-limit)
      .reverse()
      .find(predicate) || null;
  }

  findRecentAll(predicate, limit = 20) {
    if (typeof predicate !== 'function') {
      return [];
    }
    return this.history
      .slice(-limit)
      .reverse()
      .filter(predicate);
  }

  getLastSearch() {
    return this.findRecent(entry =>
      entry?.success &&
      ['browser.search', 'browser.siteSearch', 'browser.openFirstResult'].includes(entry.intent) &&
      (entry.entities?.query || entry.data?.query)
    );
  }

  getFirstSearchToday() {
    return this.getCommandsToday().find(entry =>
      entry?.success &&
      ['browser.search', 'browser.siteSearch', 'browser.openFirstResult'].includes(entry.intent) &&
      (entry.entities?.query || entry.data?.query)
    ) || null;
  }

  getLastAppAction(intent = null) {
    return this.findRecent(entry =>
      entry?.success &&
      entry.intent &&
      entry.intent.startsWith('app.') &&
      (!intent || entry.intent === intent) &&
      entry.entities?.appName
    );
  }

  getPreviousAppOpen() {
    const opened = this.findRecentAll(entry =>
      entry?.success &&
      entry.intent === 'app.open' &&
      entry.entities?.appName,
    30);
    return opened[1] || null;
  }

  getLastFileReference() {
    return this.findRecent(entry => Boolean(this._fileReferenceFromEntry(entry)), 30);
  }

  getFileReference(entry) {
    return this._fileReferenceFromEntry(entry);
  }

  getConversationSummary() {
    const successful = this.history.filter(h => h.success).length;
    const total = this.history.length;
    const verified = this.history.filter(h => h.verification?.status === 'passed').length;
    const failedVerification = this.history.filter(h => h.verification?.status === 'failed').length;
    return {
      totalCommands: total,
      successfulCommands: successful,
      failedCommands: total - successful,
      verifiedCommands: verified,
      failedVerificationCommands: failedVerification,
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

  _fileReferenceFromEntry(entry) {
    if (!entry || !entry.intent || !entry.success) {
      return null;
    }

    if (!/^file\./.test(entry.intent)) {
      return null;
    }

    const entities = entry.entities || {};
    const data = entry.data || {};
    const opened = data.opened || null;
    const firstResult = Array.isArray(data.results) ? data.results[0] : null;
    const firstEntry = Array.isArray(data.entries) ? data.entries[0] : null;
    const candidate = opened || firstResult || firstEntry || {};
    const name = candidate.name ||
      entities.filename ||
      entities.fileName ||
      entities.query ||
      entities.source ||
      '';
    const filePath = candidate.path || entities.path || entities.selectedPath || '';
    if (!name && !filePath) {
      return null;
    }

    return {
      name: String(name || filePath).trim(),
      path: String(filePath || '').trim(),
      intent: entry.intent,
      input: entry.input
    };
  }
}

module.exports = ContextManager;
