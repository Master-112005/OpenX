const Logger = require('./Data').Logger;

const MAX_HISTORY = 100;
const MAX_CONTEXT_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_TOPIC_MEMORY = 40;
const MAX_USER_PREFERENCES = 50;
const MAX_USER_FACTS = 100;
const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'give', 'go', 'had', 'has', 'have',
  'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'open', 'or', 'our',
  'please', 'search', 'show', 'sir', 'that', 'the', 'them', 'then', 'there',
  'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'with', 'you', 'your'
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTopic(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !TOPIC_STOP_WORDS.has(token));
}

function compactSentence(value, maxLength = 160) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

class ContextManager {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.history = [];
    this.sessionData = new Map();
    this.maxHistory = config?.chat?.maxHistory || MAX_HISTORY;
    this.maxContextAgeMs = Number(config?.chat?.maxContextAgeMs || MAX_CONTEXT_AGE_MS);
    this.maxTopicMemory = Number(config?.chat?.maxTopicMemory || MAX_TOPIC_MEMORY);
    this.maxUserPreferences = Number(config?.chat?.maxUserPreferences || MAX_USER_PREFERENCES);
    this.maxUserFacts = Number(config?.chat?.maxUserFacts || MAX_USER_FACTS);
    this.lastInteraction = null;
    this.userPreferences = new Map();
    this.userFacts = new Map();
    this.pendingTasks = [];
    this.topicMemory = new Map();
  }

  record(input, parsed, result) {
    const entry = {
      timestamp: Date.now(),
      input,
      commandId: result?.commandId || null,
      intent: result?.intent || null,
      confidence: result?.confidence || 0,
      success: result?.success || false,
      requiresConfirmation: Boolean(result?.requiresConfirmation),
      needsClarification: Boolean(result?.needsClarification),
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
    this._updateTopicMemory(entry);

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
        category: entities.reminderCategory || result?.data?.category || 'general',
        duration: entities.duration || null,
        timeExpression: entities.timeExpression || null,
        dueAt: result?.data?.dueAt || null,
        timestamp: Date.now()
      });
    }

    if (intent === 'timer.set' && entities?.duration) {
      this.pendingTasks.push({
        type: 'timer',
        duration: entities.duration,
        dueAt: result?.data?.dueAt || null,
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
    this._trimMapByTimestamp(this.userPreferences, this.maxUserPreferences);
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
    this._trimMapByTimestamp(this.userFacts, this.maxUserFacts);
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

  destroy() {
    this.history = [];
    this.sessionData.clear();
    this.userPreferences.clear();
    this.userFacts.clear();
    this.pendingTasks = [];
    this.topicMemory.clear();
    this.lastInteraction = null;
  }

  getLastInteractionTime() {
    return this.lastInteraction;
  }

  getRecentCommands(count = 5) {
    return this.history.slice(-count).map(h => h.input);
  }

  getPreviousUserUtterance() {
    const previous = this.history[this.history.length - 1];
    return previous?.input || '';
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

  getLastPhoneTransfer() {
    return this.findRecent(entry =>
      entry?.success &&
      entry.intent === 'phone.sendFile' &&
      (entry.entities?.path || entry.data?.path || entry.data?.transferredName)
    , 30);
  }

  getLastActionableCommand(limit = 12) {
    return this.history
      .slice(-limit)
      .reverse()
      .find(entry => entry?.success && entry?.input && entry?.intent &&
        /^(?:app|browser|file|folder|media|volume|brightness|window|phone)\./.test(entry.intent)) || null;
  }

  resolveEllipticalFollowUp(input) {
    const normalized = normalizeText(input);
    if (!normalized || /(?:19|20)\d{2}/.test(normalized)) return '';
    const match = normalized.match(/^(?:and|also|then|what about|how about)\s+(.+)$/) ||
      normalized.match(/^(?:do (?:the )?same|same(?: thing)?)\s+(?:with|for)\s+(.+)$/);
    if (!match?.[1]) return '';

    const replacement = match[1]
      .replace(/^(?:the|a|an)\s+/, '')
      .replace(/^(?:open|close|launch|start|play|search(?:\s+for)?)\s+/, '')
      .trim();
    const last = this.getLastActionableCommand();
    if (!last || !replacement) return '';
    const verbs = {
      'app.open': 'open',
      'app.close': 'close',
      'app.switch': 'switch to',
      'browser.search': 'search for',
      'browser.siteSearch': 'search for',
      'media.play': 'play',
      'file.open': 'open',
      'folder.open': 'open'
    };
    const verb = verbs[last.intent];
    if (!verb) return '';

    if (/^browser\./.test(last.intent) && /^(?:chrome|edge|firefox|browser)$/.test(replacement)) {
      const query = String(last.entities?.query || last.data?.query || '').trim();
      return query ? `search for ${query} in ${replacement}` : '';
    }
    return `${verb} ${replacement}`;
  }

  getFileReference(entry) {
    return this._fileReferenceFromEntry(entry);
  }

  getLastTopic() {
    const topics = Array.from(this.topicMemory.values())
      .sort((a, b) => b.lastSeen - a.lastSeen || b.score - a.score);
    return topics[0] || null;
  }

  getRelevantHistory(query, limit = 5) {
    const queryTokens = tokenizeTopic(query);
    if (queryTokens.length === 0) {
      return this.history.slice(-limit);
    }

    const now = Date.now();
    return this.history
      .map(entry => {
        const haystack = [
          entry.input,
          entry.response,
          entry.intent,
          entry.entities?.query,
          entry.entities?.mediaQuery,
          entry.entities?.appName,
          entry.data?.query
        ].filter(Boolean).join(' ');
        const tokens = new Set(tokenizeTopic(haystack));
        const overlap = queryTokens.filter(token => tokens.has(token)).length;
        const ageMinutes = Math.max(0, (now - entry.timestamp) / 60000);
        const recency = Math.max(0, 1 - (ageMinutes / 120));
        return { entry, score: overlap + recency };
      })
      .filter(item => item.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.entry);
  }

  buildConversationDigest(options = {}) {
    const limit = Number(options.limit || 8);
    const recent = this.history
      .slice(-limit)
      .filter(entry => entry?.input)
      .map(entry => ({
        input: compactSentence(entry.input, 120),
        intent: entry.intent || 'conversation',
        success: Boolean(entry.success),
        target: this._entryTarget(entry)
      }));
    const topics = Array.from(this.topicMemory.values())
      .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
      .slice(0, 5)
      .map(topic => topic.label);
    const lines = recent.map(entry => {
      const target = entry.target ? ` (${entry.target})` : '';
      return `${entry.input}${target}`;
    });
    return {
      recent,
      topics,
      summaryText: lines.length
        ? `Recent chat: ${lines.join('; ')}. ${topics.length ? `Main topics: ${topics.join(', ')}.` : ''}`.trim()
        : ''
    };
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
      sessionKeys: Array.from(this.sessionData.keys()),
      recentTopics: Array.from(this.topicMemory.values())
        .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
        .slice(0, 5)
        .map(topic => topic.label)
    };
  }

  _cleanup() {
    const cutoff = Date.now() - this.maxContextAgeMs;
    this.history = this.history.filter(h => h.timestamp >= cutoff);

    for (const [key, data] of this.sessionData) {
      if (Date.now() - data.timestamp > this.maxContextAgeMs) {
        this.sessionData.delete(key);
      }
    }

    for (const [key, topic] of this.topicMemory) {
      if (topic.lastSeen < cutoff) {
        this.topicMemory.delete(key);
      }
    }
    this._trimMapByTimestamp(this.userPreferences, this.maxUserPreferences);
    this._trimMapByTimestamp(this.userFacts, this.maxUserFacts);
    this._trimTopicMemory();
  }

  _trimMapByTimestamp(map, maxSize) {
    if (!(map instanceof Map) || !Number.isFinite(maxSize) || maxSize <= 0 || map.size <= maxSize) {
      return;
    }

    const keep = new Set(Array.from(map.entries())
      .sort((a, b) => Number(b[1]?.timestamp || 0) - Number(a[1]?.timestamp || 0))
      .slice(0, maxSize)
      .map(([key]) => key));

    for (const key of map.keys()) {
      if (!keep.has(key)) {
        map.delete(key);
      }
    }
  }

  _updateTopicMemory(entry) {
    const candidates = this._topicCandidatesFromEntry(entry);
    if (candidates.length === 0) {
      return;
    }

    const now = entry.timestamp || Date.now();
    for (const label of candidates) {
      const tokens = tokenizeTopic(label);
      if (tokens.length === 0) {
        continue;
      }
      const key = tokens.slice(0, 6).join(' ');
      const existing = this.topicMemory.get(key);
      const scoreBoost = entry.success ? 1.4 : 0.8;
      this.topicMemory.set(key, {
        key,
        label: compactSentence(label, 80),
        tokens,
        score: Number(existing?.score || 0) + scoreBoost,
        count: Number(existing?.count || 0) + 1,
        firstSeen: existing?.firstSeen || now,
        lastSeen: now,
        lastInput: entry.input,
        lastIntent: entry.intent || null
      });
    }

    this._trimTopicMemory();
  }

  _topicCandidatesFromEntry(entry) {
    const entities = entry.entities || {};
    const data = entry.data || {};
    const candidates = [
      entities.query,
      entities.mediaQuery,
      entities.appName,
      entities.windowName,
      entities.folderName,
      entities.filename,
      entities.fileName,
      entities.contactName,
      data.query,
      data.topic
    ].filter(Boolean);

    const cleanedInputTopic = this._topicFromInput(entry.input);
    if (cleanedInputTopic) {
      candidates.push(cleanedInputTopic);
    }

    return Array.from(new Set(candidates
      .map(value => compactSentence(value, 100))
      .filter(value => tokenizeTopic(value).length > 0)));
  }

  _topicFromInput(input) {
    const text = normalizeText(input)
      .replace(/^(?:can|could|would)\s+you\s+/, '')
      .replace(/^(?:please\s+)?(?:explain|tell\s+me\s+about|teach\s+me|search\s+for|find|look\s+up|play|open|show)\s+/, '')
      .replace(/\b(?:in\s+simple\s+words?|for\s+me|please|today|now)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = tokenizeTopic(text);
    if (tokens.length === 0 || tokens.length > 8) {
      return '';
    }
    return text;
  }

  _trimTopicMemory() {
    if (this.topicMemory.size <= this.maxTopicMemory) {
      return;
    }

    const keep = new Set(Array.from(this.topicMemory.values())
      .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen)
      .slice(0, this.maxTopicMemory)
      .map(topic => topic.key));

    for (const key of this.topicMemory.keys()) {
      if (!keep.has(key)) {
        this.topicMemory.delete(key);
      }
    }
  }

  _entryTarget(entry) {
    const entities = entry.entities || {};
    const data = entry.data || {};
    return [
      entities.query,
      entities.mediaQuery,
      entities.appName,
      entities.windowName,
      entities.folderName,
      entities.filename,
      entities.fileName,
      entities.contactName,
      entities.plannerText,
      data.entry?.title,
      data.query
    ].map(value => String(value || '').trim()).find(Boolean) || '';
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
    const firstEntry = Array.isArray(data.entries) ? data.entries[0] : null;
    const firstResult = Array.isArray(data.results) ? data.results[0] : null;
    const candidate = opened || firstResult || firstEntry || {};
    const candidatePath = typeof candidate === 'string' ? candidate : candidate.path;
    const candidateName = typeof candidate === 'string' ? '' : candidate.name;
    const name = candidateName ||
      firstEntry?.name ||
      entities.filename ||
      entities.fileName ||
      entities.query ||
      entities.source ||
      '';
    const filePath = candidatePath || firstEntry?.path || entities.path || entities.selectedPath || '';
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
