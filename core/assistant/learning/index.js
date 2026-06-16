const fs = require('fs');
const path = require('path');
const os = require('os');
const { Normalizer } = require('../../shared/index');

const MAX_EVENTS = 200;
const MAX_REWRITES = 100;
const MAX_PROMPTS = 100;
const ACCOUNT_SERVICES = [
  'apple',
  'microsoft',
  'google',
  'gmail',
  'email',
  'facebook',
  'instagram',
  'twitter',
  'linkedin',
  'github',
  'amazon',
  'netflix',
  'spotify',
  'discord',
  'slack',
  'banking',
  'bank',
  'account',
  'general'
];
const ACCOUNT_SERVICE_PATTERN = ACCOUNT_SERVICES.join('|');

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

function normalizeMemoryKey(value) {
  return cleanCommand(value)
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeAccountService(value) {
  const service = normalizeCommand(value || 'general')
    .replace(/\s+account$/i, '')
    .trim();
  if (!service || service === 'general') {
    return 'general';
  }
  if (/^(?:google|gmail|email)$/.test(service)) {
    return 'google';
  }
  if (ACCOUNT_SERVICES.includes(service)) {
    return service;
  }
  return 'general';
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

  getPreference(kind) {
    if (!this.enabled || !kind) {
      return null;
    }

    const record = this.data.preferences[kind];
    return record ? { ...record, kind } : null;
  }

  rememberUserFact(kind, value, metadata = {}) {
    if (!this.enabled || !kind) {
      return null;
    }

    const normalizedKind = normalizeCommand(kind).replace(/\s+/g, '.');
    const cleanValue = cleanCommand(value);
    if (!normalizedKind || !cleanValue) {
      return null;
    }

    const now = new Date().toISOString();
    const existing = this.data.userFacts[normalizedKind];
    const record = {
      value: cleanValue,
      source: metadata.source || 'user',
      confidence: Number(metadata.confidence ?? 1),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    this.data.userFacts[normalizedKind] = record;
    this._save();
    return record;
  }

getUserFact(kind) {
    if (!this.enabled || !kind) {
      return null;
    }

    const normalizedKind = normalizeCommand(kind).replace(/\s+/g, '.');
    const record = this.data.userFacts[normalizedKind];
    return record ? { ...record, kind: normalizedKind } : null;
  }

  getAllUserFacts() {
    if (!this.enabled) {
      return {};
    }
    const facts = {};
    for (const [key, record] of Object.entries(this.data.userFacts || {})) {
      if (record?.value) {
        facts[key] = record.value;
      }
    }
    return facts;
  }

  getUserIdentitySummary() {
    const facts = this.getAllUserFacts();
    const summary = [];
    if (facts.name) summary.push(`name: ${facts.name}`);
    if (facts.profession) summary.push(`profession: ${facts.profession}`);
    if (facts.favorite_color) summary.push(`favorite color: ${facts.favorite_color}`);
    if (facts.favorite_food) summary.push(`favorite food: ${facts.favorite_food}`);
    if (facts.phone) summary.push(`phone: ${facts.phone}`);
    if (facts.email) summary.push(`email: ${facts.email}`);
    if (facts.location) summary.push(`location: ${facts.location}`);
    if (facts.applePassword) summary.push(`has apple password`);
    if (facts.googlePassword) summary.push(`has google password`);
    return summary.length > 0 ? summary.join(', ') : 'no personal facts stored';
  }

  learnFromMultiCommand(input, commands) {
    if (!this.enabled || !Array.isArray(commands) || commands.length < 2) {
      return null;
    }

    const text = cleanCommand(input);
    const normalized = normalizeCommand(text);
    if (!normalized) return null;

    const existing = this.data.commandSequences?.[normalized];
    if (existing) {
      if (existing.sequence.join(',') === commands.join(',')) {
        existing.uses = (existing.uses || 0) + 1;
        existing.lastUsed = new Date().toISOString();
        this._save();
        return { type: 'sequence', action: 'reinforced', sequence: commands };
      }
    }

    if (!this.data.commandSequences) {
      this.data.commandSequences = {};
    }

    this.data.commandSequences[normalized] = {
      input: text,
      sequence: commands,
      confidence: 1,
      uses: 1,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };

    const MAX_SEQUENCES = 50;
    const keys = Object.keys(this.data.commandSequences);
    if (keys.length > MAX_SEQUENCES) {
      const sorted = keys.sort((a, b) => {
        const aUses = this.data.commandSequences[a].uses || 0;
        const bUses = this.data.commandSequences[b].uses || 0;
        return aUses - bUses;
      });
      const toDelete = sorted.slice(0, keys.length - MAX_SEQUENCES);
      toDelete.forEach(key => delete this.data.commandSequences[key]);
    }

    this._save();
    return { type: 'sequence', action: 'learned', sequence: commands };
  }

  findCommandSequence(input) {
    if (!this.enabled) return null;

    const normalized = normalizeCommand(input);
    if (!normalized) return null;

    const record = this.data.commandSequences?.[normalized];
    if (record && record.sequence && record.sequence.length >= 2) {
      record.uses = (record.uses || 0) + 1;
      record.lastUsed = new Date().toISOString();
      this._save();
      return record;
    }

    const tokens = normalized.split(/\s+/);
    if (tokens.length >= 3) {
      for (const [key, record] of Object.entries(this.data.commandSequences || {})) {
        if (record.sequence && record.sequence.length >= 2) {
          const keyTokens = key.split(/\s+/);
          let matchCount = 0;
          for (const token of tokens) {
            if (keyTokens.includes(token)) matchCount++;
          }
          if (matchCount >= Math.floor(tokens.length * 0.7)) {
            record.uses = (record.uses || 0) + 1;
            record.lastUsed = new Date().toISOString();
            this._save();
            return record;
          }
        }
      }
    }

    return null;
  }

  answerPersonalQuestion(input) {
    const normalized = normalizeCommand(input);
    if (!normalized) {
      return null;
    }

    if (/^(?:what|who)\s+(?:is|are)\s+my\s+name\b|^do\s+you\s+(?:know|remember)\s+my\s+name\b/.test(normalized)) {
      const name = this.getUserFact('name');
      return {
        type: 'user-fact',
        known: Boolean(name?.value),
        fact: 'name',
        response: name?.value
          ? `Your name is ${name.value}, sir.`
          : 'I do not know your name yet, sir. You can say, "remember my name is Rakesh."'
      };
    }

    const passwordMatch = normalized.match(new RegExp(`^(?:what\\s+is|what'?s|tell me|do\\s+you\\s+(?:know|remember))\\s+my\\s+((?:${ACCOUNT_SERVICE_PATTERN})?\\s*)?(?:account\\s+)?password\\b`));
    if (passwordMatch) {
      const service = normalizeAccountService(passwordMatch[1]);
      const password = this.getUserFact(`${service}Password`);
      if (password?.value) {
        return {
          type: 'user-fact',
          known: true,
          fact: `${service}Password`,
          response: `Your ${service} account password is: ${password.value}`
        };
      }
      return {
        type: 'user-fact',
        known: false,
        fact: `${service}Password`,
        response: `I do not have your ${service} account password stored, sir. You can say, "remember my ${service} account password is [password]."`
      };
    }

    const professionMatch = /^(?:what|who)\s+(?:is|are)\s+(?:i|me|my\s+)(?:profession|job|work|career)\b|^do\s+you\s+(?:know|remember)\s+(?:my\s+)?(?:profession|job|work|career)\b/.test(normalized);
    if (professionMatch) {
      const profession = this.getUserFact('profession');
      if (profession?.value) {
        return {
          type: 'user-fact',
          known: true,
          fact: 'profession',
          response: `Your profession is ${profession.value}, sir.`
        };
      }
      return {
        type: 'user-fact',
        known: false,
        fact: 'profession',
        response: 'I do not know your profession yet, sir. You can say, "I am a student" or "my profession is developer."'
      };
    }

    const whoAmIMatch = /^(?:who|what)\s+am\s+i\b|^do\s+you\s+know\s+me\b|^tell\s+me\s+about\s+myself\b/.test(normalized);
    if (whoAmIMatch) {
      const name = this.getUserFact('name');
      const profession = this.getUserFact('profession');
      const parts = [];
      if (name?.value) parts.push(`Your name is ${name.value}`);
      if (profession?.value) parts.push(`you are a ${profession.value}`);
      if (parts.length > 0) {
        return {
          type: 'user-fact',
          known: true,
          fact: 'identity',
          response: `${parts.join(', ')}, sir. Is there anything else you would like me to remember?`
        };
      }
      return {
        type: 'user-fact',
        known: false,
        fact: 'identity',
        response: 'I do not know much about you yet, sir. You can tell me things like "my name is Rakesh" or "I am a student" and I will remember.'
      };
    }

    const factMatch = normalized.match(/^(?:(what\s+is|what'?s|tell me|do\s+you\s+(?:know|remember))\s+)?my\s+(.+)$/);
    if (factMatch?.[2]) {
      const questionPrefix = factMatch[1] || '';
      const key = normalizeMemoryKey(factMatch[2]);
      if (key && !/^(?:name|password|account_password|googlePassword|applePassword|microsoftPassword|facebookPassword|instagramPassword)$/.test(key)) {
        const fact = this.getUserFact(key);
        if (fact?.value) {
          return {
            type: 'user-fact',
            known: true,
            fact: key,
            response: `Your ${key.replace(/_/g, ' ')} is ${fact.value}, sir.`
          };
        }
        if (/\b(?:tell me|do\s+you\s+(?:know|remember))\b/.test(questionPrefix)) {
          return {
            type: 'user-fact',
            known: false,
            fact: key,
            response: `I do not have your ${key.replace(/_/g, ' ')} stored yet, sir. You can say, "remember my ${key.replace(/_/g, ' ')} is [value]."`
          };
        }
      }
    }

    return null;
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
      note: String(entry?.note || '').trim(),
      languageUnderstanding: isPlainObject(entry?.languageUnderstanding) ? entry.languageUnderstanding : null,
      validation: isPlainObject(entry?.validation) ? entry.validation : null,
      verification: isPlainObject(entry?.verification) ? entry.verification : null
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

  buildFeedbackKey(entry = {}) {
    const intent = String(entry.intent || '').trim();
    const entities = isPlainObject(entry.entities) ? entry.entities : {};
    const target = [
      entities.appName,
      entities.folderName,
      entities.filename,
      entities.fileName,
      entities.windowName,
      entities.query,
      entities.mediaQuery,
      entities.contactName,
      entities.platform,
      entities.target,
      entities.queryApp
    ].map(value => normalizeCommand(value)).find(Boolean);
    const routed = normalizeCommand(entry.routedInput || entry.input || '');
    return [intent, target || routed].filter(Boolean).join(':');
  }

  shouldAskForFeedback(entry = {}) {
    if (!this.enabled || !this.askForFeedback) {
      return false;
    }

    const key = this.buildFeedbackKey(entry);
    if (!key) {
      return false;
    }

    const confidence = Number(entry.confidence ?? 1);
    const recovered = Boolean(entry.recovered || entry.learnedCorrection || entry.contextualRewrite);
    const previousPrompt = this.data.feedbackPrompts.find(prompt => prompt.key === key);
    if (!previousPrompt) {
      return true;
    }

    return recovered || confidence < 0.82;
  }

  recordFeedbackPrompt(entry = {}) {
    if (!this.enabled) {
      return null;
    }

    const key = this.buildFeedbackKey(entry);
    if (!key) {
      return null;
    }

    const now = new Date().toISOString();
    const existing = this.data.feedbackPrompts.find(prompt => prompt.key === key);
    const record = {
      key,
      input: cleanCommand(entry.input),
      routedInput: cleanCommand(entry.routedInput || entry.input),
      intent: entry.intent || null,
      entities: isPlainObject(entry.entities) ? entry.entities : {},
      confidence: Number(entry.confidence ?? 1),
      promptedAt: now,
      count: existing ? Number(existing.count || 0) + 1 : 1
    };

    if (existing) {
      Object.assign(existing, record);
    } else {
      this.data.feedbackPrompts.unshift(record);
      this.data.feedbackPrompts = this.data.feedbackPrompts.slice(0, MAX_PROMPTS);
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

    const userNameMatch = text.match(/^(?:remember\s+(?:that\s+)?)?(?:my\s+name\s+is|call\s+me)\s+(.+)$/i);
    if (userNameMatch?.[1]) {
      const name = userNameMatch[1]
        .replace(/[.!?]+$/g, '')
        .trim();
      const fact = this.rememberUserFact('name', name, {
        source: /^remember\b/i.test(text) ? 'explicit-memory' : 'user-stated-fact'
      });
      if (fact) {
        return {
          type: 'user-fact',
          response: `I will remember that your name is ${fact.value}.`
        };
      }
    }

    const photoLibraryMatch = normalized.match(/\b(?:remember|learn)\b.*\b(?:my\s+)?(?:photo|photos|picture|pictures)\s+(?:library|app|source|place)\s+(?:is|as|to|in)\s+(.+)$/);
    if (photoLibraryMatch?.[1]) {
      const source = photoLibraryMatch[1].trim();
      const value = /\bgoogle\s+photos?\b/.test(source)
        ? 'googlePhotos'
        : /\b(?:windows|microsoft)\s+photos?\b|\bphotos\s+app\b/.test(source)
          ? 'windowsPhotos'
          : /\b(?:local|pictures?|photos?\s+folder|computer|pc|laptop)\b/.test(source)
            ? 'localPictures'
            : '';
      if (value) {
        this.rememberPreference('photoLibrary', value, { source: 'explicit-learning' });
        const label = value === 'googlePhotos'
          ? 'Google Photos'
          : value === 'windowsPhotos'
            ? 'Windows Photos'
            : 'local Pictures';
        return {
          type: 'preference',
          response: `I learned that your photo library is ${label}.`
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

    const identityMatch = text.match(/^(?:remember\s+(?:that\s+)?)?i\s+am\s+(?:a\s+)?(.+)$/i);

    const passwordRememberMatch = text.match(new RegExp(`^(?:remember|save|store)\\s+(?:my\\s+)?((?:${ACCOUNT_SERVICE_PATTERN})\\s+)?(?:account\\s+)?password\\s+(?:is\\s+)?(.+)$`, 'i'));
    if (passwordRememberMatch && (passwordRememberMatch[1] || passwordRememberMatch[2])) {
      const password = passwordRememberMatch[2].replace(/[.!?]+$/g, '').trim();
      const serviceName = normalizeAccountService(passwordRememberMatch[1]);
      if (password && password.length > 0 && password.length < 100) {
        const fact = this.rememberUserFact(`${serviceName}Password`, password, {
          source: 'user-stated-credential'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Your ${serviceName} account password has been securely stored, sir.`
          };
        }
      }
    }

    const passwordThisMatch = text.match(new RegExp(`^(?:remember|save|store)\\s+this\\s+(.+?)\\s+as\\s+(?:my\\s+)?((?:${ACCOUNT_SERVICE_PATTERN})\\s+)?(?:account\\s+)?password$`, 'i'));
    if (passwordThisMatch && passwordThisMatch[1]) {
      const password = passwordThisMatch[1].replace(/[.!?]+$/g, '').trim();
      const serviceName = normalizeAccountService(passwordThisMatch[2]);
      if (password && password.length > 0 && password.length < 100) {
        const fact = this.rememberUserFact(`${serviceName}Password`, password, {
          source: 'user-stated-credential'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Your ${serviceName} account password has been securely stored, sir.`
          };
        }
      }
    }

    const passwordGeneralMatch = text.match(/^(?:remember|save|store)\s+this\s+(.+?)\s+as\s+(?:my\s+)?password$/i);
    if (passwordGeneralMatch && passwordGeneralMatch[1]) {
      const password = passwordGeneralMatch[1].replace(/[.!?]+$/g, '').trim();
      if (password && password.length > 0 && password.length < 100) {
        const fact = this.rememberUserFact('generalPassword', password, {
          source: 'user-stated-credential'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Your password has been securely stored, sir.`
          };
        }
      }
    }

    if (identityMatch && identityMatch[1]) {
      const profession = identityMatch[1].replace(/[.!?]+$/g, '').trim();
      if (profession && profession.length > 1 && profession.length < 50 && !/^(?:a|an|the|student|going|doing|here|ready|available)\b/i.test(profession)) {
        const fact = this.rememberUserFact('profession', profession, {
          source: /^remember\b/i.test(text) ? 'explicit-memory' : 'user-stated-fact'
        });
if (fact) {
          return {
            type: 'user-fact',
            response: `Noted, sir. I will remember that you are a ${fact.value}.`
          };
        }
      }
    }

    const genericRememberMatch = text.match(/^(?:remember|note)\s+(?:this\s+)?(?:that\s+)?(?:my\s+)?(.+?)\s+(?:is|was|are|were)\s+(.+)$/i);
    if (genericRememberMatch && genericRememberMatch[1] && genericRememberMatch[2]) {
      const key = normalizeMemoryKey(genericRememberMatch[1]);
      const value = genericRememberMatch[2].replace(/[.!?]+$/g, '').trim();
      if (key && value && key.length > 1 && value.length > 0 && value.length < 100 && key !== 'password' && !/^(?:i|my|the|a|an|this|that|it|they|them|his|her|their)\b/i.test(key)) {
        const fact = this.rememberUserFact(key, value, {
          source: /^remember\b/i.test(text) ? 'explicit-memory' : 'user-stated-fact'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Noted, sir. I will remember that ${key.replace(/_/g, ' ')} is ${fact.value}.`
          };
        }
      }
    }

    const myXIsYMatch = text.match(/^my\s+(.+?)\s+(?:is|was|are|were)\s+(.+)$/i);
    if (myXIsYMatch && myXIsYMatch[1] && myXIsYMatch[2]) {
      const key = normalizeMemoryKey(myXIsYMatch[1]);
      const value = myXIsYMatch[2].replace(/[.!?]+$/g, '').trim();
      if (key && value && key.length > 1 && value.length > 0 && value.length < 100 && !/^(?:name|password|email|phone|mobile|card|number)\b/i.test(key)) {
        const fact = this.rememberUserFact(key, value, {
          source: 'user-stated-fact'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Noted, sir. I will remember that your ${key.replace(/_/g, ' ')} is ${fact.value}.`
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
      userFacts: isPlainObject(source.userFacts) ? source.userFacts : {},
      commandRewrites: Array.isArray(source.commandRewrites) ? source.commandRewrites.slice(0, MAX_REWRITES) : [],
      feedback: Array.isArray(source.feedback) ? source.feedback.slice(0, MAX_EVENTS) : [],
      mistakes: Array.isArray(source.mistakes) ? source.mistakes.slice(0, MAX_EVENTS) : [],
      feedbackPrompts: Array.isArray(source.feedbackPrompts) ? source.feedbackPrompts.slice(0, MAX_PROMPTS) : [],
      commandSequences: isPlainObject(source.commandSequences) ? source.commandSequences : {}
    };
  }
}

module.exports = ActiveLearningStore;
