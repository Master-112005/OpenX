const fs = require('fs');
const path = require('path');
const os = require('os');
const { Normalizer } = require('../../shared/index');

const MAX_EVENTS = 200;
const MAX_REWRITES = 100;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommand(value) {
  return Normalizer.normalizeText(String(value || '').trim());
}

function cleanCommand(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ');
}

class ActiveLearningStore {
  constructor(config = {}) {
    this.enabled = config?.activeLearning?.enabled !== false;
    this.askForFeedback = config?.activeLearning?.askForFeedback !== false;
    const dataDir = config?.app?.dataDir || path.join(os.homedir(), '.jarvis');
    this.storePath = config?.activeLearning?.storePath || path.join(dataDir, 'learning.json');
    this.data = this._sanitize(this._load());
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.data));
  }

  rememberCorrection(input, correction, metadata = {}) {
    if (!this.enabled) {
      return null;
    }

    const source = cleanCommand(input);
    const target = cleanCommand(correction);
    const normalizedInput = normalizeCommand(source);
    if (!normalizedInput || !target || normalizedInput === normalizeCommand(target)) {
      return null;
    }

    const existing = this.data.commandRewrites.find(rule => rule.normalizedInput === normalizedInput);
    const now = new Date().toISOString();
    const record = {
      input: source,
      normalizedInput,
      correction: target,
      confidence: 1,
      source: metadata.source || 'user-feedback',
      reason: metadata.reason || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      uses: existing?.uses || 0
    };

    if (existing) {
      Object.assign(existing, record);
    } else {
      this.data.commandRewrites.unshift(record);
      this.data.commandRewrites = this.data.commandRewrites.slice(0, MAX_REWRITES);
    }

    this._save();
    return record;
  }

  findCorrection(input) {
    if (!this.enabled) {
      return null;
    }

    const normalized = normalizeCommand(input);
    if (!normalized) {
      return null;
    }

    const exact = this.data.commandRewrites.find(rule => rule.normalizedInput === normalized);
    if (exact) {
      exact.uses = Number(exact.uses || 0) + 1;
      exact.updatedAt = new Date().toISOString();
      this._save();
      return {
        input: exact.input,
        correction: exact.correction,
        confidence: exact.confidence || 1,
        source: exact.source
      };
    }

    return null;
  }

  rememberPreference(kind, value, metadata = {}) {
    if (!this.enabled || !kind) {
      return null;
    }

    const now = new Date().toISOString();
    const record = {
      value,
      source: metadata.source || 'user',
      updatedAt: now
    };
    this.data.preferences[kind] = record;
    this._save();
    return record;
  }

  adaptEntities(intentId, entities = {}) {
    if (!this.enabled) {
      return entities;
    }

    const next = { ...(entities || {}) };
    if (intentId === 'browser.search') {
      const searchMode = this.data.preferences.searchOpenMode?.value;
      if (searchMode === 'browser') {
        next.openInBrowser = true;
      } else if (searchMode === 'background') {
        next.openInBrowser = false;
      }
    }

    if (intentId === 'media.play' && !next.mediaPlatform) {
      const preferredPlatform = this.data.preferences.mediaPlatform?.value;
      if (preferredPlatform) {
        next.mediaPlatform = preferredPlatform;
        next.platform = preferredPlatform;
      }
    }

    return next;
  }

  recordFeedback(entry) {
    if (!this.enabled) {
      return null;
    }

    const record = {
      timestamp: new Date().toISOString(),
      input: cleanCommand(entry?.input),
      routedInput: cleanCommand(entry?.routedInput || entry?.input),
      intent: entry?.intent || null,
      success: Boolean(entry?.success),
      rating: entry?.rating || 'unknown',
      correction: cleanCommand(entry?.correction || ''),
      note: String(entry?.note || '').trim()
    };

    this.data.feedback.unshift(record);
    this.data.feedback = this.data.feedback.slice(0, MAX_EVENTS);

    if (record.rating === 'negative') {
      this.data.mistakes.unshift(record);
      this.data.mistakes = this.data.mistakes.slice(0, MAX_EVENTS);
    }

    this._save();
    return record;
  }

  learnFromText(input) {
    const text = cleanCommand(input);
    const normalized = normalizeCommand(text);
    if (!normalized) {
      return null;
    }

    const correctionMatch = text.match(/^(?:remember\s+that\s+)?(?:when|whenever|if)\s+i\s+say\s+["']?(.+?)["']?\s*,?\s+(?:you\s+should\s+|please\s+)?((?:do|run|execute|perform|use|open|close|search|find|play|set|turn|start|launch|show|list|send|call)\b.+)$/i);
    if (correctionMatch?.[1] && correctionMatch?.[2]) {
      const rule = this.rememberCorrection(correctionMatch[1], correctionMatch[2], {
        source: 'explicit-learning',
        reason: 'user-rule'
      });
      if (rule) {
        return {
          type: 'correction',
          response: `I learned that when you say "${rule.input}", I should do "${rule.correction}".`
        };
      }
    }

    if (/\b(?:remember|learn)\b/.test(normalized) && /\b(?:prefer|preference|preferred)\b/.test(normalized)) {
      if (/\b(?:search|web|google)\b/.test(normalized) && /\b(?:chrome|browser|new tab)\b/.test(normalized)) {
        this.rememberPreference('searchOpenMode', 'browser', { source: 'explicit-learning' });
        return {
          type: 'preference',
          response: 'I learned that you prefer web searches to open in the browser.'
        };
      }

      if (/\b(?:search|web|google)\b/.test(normalized) && /\b(?:background|silent|do not open|dont open)\b/.test(normalized)) {
        this.rememberPreference('searchOpenMode', 'background', { source: 'explicit-learning' });
        return {
          type: 'preference',
          response: 'I learned that you prefer web searches to stay in the background.'
        };
      }

      const mediaMatch = normalized.match(/\b(spotify|youtube|apple music|amazon music)\b/);
      if (mediaMatch) {
        const platform = mediaMatch[1];
        if (platform) {
          this.rememberPreference('mediaPlatform', platform, { source: 'explicit-learning' });
          return {
            type: 'preference',
            response: `I learned that you prefer ${platform} for music.`
          };
        }
      }
    }

    return null;
  }

  _load() {
    try {
      if (!fs.existsSync(this.storePath)) {
        return {};
      }
      const source = fs.readFileSync(this.storePath, 'utf8').trim();
      return source ? JSON.parse(source) : {};
    } catch (err) {
      return {};
    }
  }

  _save() {
    const directory = path.dirname(this.storePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  _sanitize(input) {
    const source = isPlainObject(input) ? input : {};
    return {
      version: 1,
      preferences: isPlainObject(source.preferences) ? source.preferences : {},
      commandRewrites: Array.isArray(source.commandRewrites) ? source.commandRewrites.slice(0, MAX_REWRITES) : [],
      feedback: Array.isArray(source.feedback) ? source.feedback.slice(0, MAX_EVENTS) : [],
      mistakes: Array.isArray(source.mistakes) ? source.mistakes.slice(0, MAX_EVENTS) : []
    };
  }
}

module.exports = ActiveLearningStore;
