const fs = require('fs');
const path = require('path');
const { Normalizer } = require('./Data');
const { buildDataPaths, writeJsonAtomic } = require('./Data');

const MAX_EVENTS = 200;
const MAX_REWRITES = 100;
const MAX_PROMPTS = 100;
const MAX_ROUTE_EVIDENCE = 200;
const MAX_PREFERENCES = 100;
const MAX_USER_FACTS = 150;
const PRIVATE_COMMUNICATION_INTENTS = new Set(['message.send', 'email.compose', 'call.start']);

function containsPrivateCommunicationIntent(intentOrList) {
  const intents = Array.isArray(intentOrList) ? intentOrList : [intentOrList];
  return intents.some(intent => PRIVATE_COMMUNICATION_INTENTS.has(String(intent || '').trim()));
}
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
const PERSONAL_FACT_ALIASES = {
  email_address: 'email',
  e_mail: 'email',
  mobile: 'phone',
  mobile_number: 'phone',
  phone_number: 'phone',
  telephone: 'phone',
  telephone_number: 'phone',
  city: 'location',
  current_city: 'location',
  current_location: 'location',
  address: 'location',
  home: 'location',
  hometown: 'hometown',
  native_place: 'hometown',
  born_place: 'hometown',
  school: 'school',
  college: 'school',
  university: 'school',
  institute: 'school',
  institution: 'school',
  company: 'workplace',
  office: 'workplace',
  work_place: 'workplace',
  job_place: 'workplace',
  friend: 'friend_name',
  friend_name: 'friend_name',
  favourite_color: 'favorite_color',
  favourite_colour: 'favorite_color',
  favorite_colour: 'favorite_color',
  favourite_food: 'favorite_food',
  favourite_movie: 'favorite_movie',
  favourite_music: 'favorite_music',
  favourite_sport: 'favorite_sport'
};

const PERSONAL_FACT_LABELS = {
  email: 'email',
  phone: 'phone number',
  location: 'location',
  hometown: 'hometown',
  school: 'school',
  workplace: 'workplace',
  friend_name: "friend's name",
  favorite_color: 'favorite color',
  favorite_food: 'favorite food',
  favorite_movie: 'favorite movie',
  favorite_music: 'favorite music',
  favorite_sport: 'favorite sport',
  likes: 'likes',
  possessions: 'possessions',
  profession: 'profession',
  name: 'name'
};

const PROTECTED_FACT_KEY_PATTERN = /^(?:password|account_password|googlePassword|applePassword|microsoftPassword|facebookPassword|instagramPassword|generalPassword)$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommand(value) {
  return Normalizer.normalizeText(String(value || '').trim())
    .replace(/\b(?:fresh|another|one more)\s+chrome\s+tab\b/g, 'new chrome tab')
    .replace(/\b(?:fresh|another|one more)\s+tab\b/g, 'new tab')
    .replace(/\bopen\s+(?:a\s+)?new\s+tab\s+(?:in|on)\s+(?:the\s+)?chrome\b/g, 'open new chrome tab');
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

function normalizePersonalFactKey(value) {
  const raw = cleanCommand(value);
  if (/^[a-z]+Password$/.test(raw)) {
    return raw;
  }
  const key = normalizeMemoryKey(value);
  return PERSONAL_FACT_ALIASES[key] || key;
}

function personalFactLabel(key) {
  const normalized = normalizePersonalFactKey(key);
  return PERSONAL_FACT_LABELS[normalized] || normalized.replace(/_/g, ' ');
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
    this.saveDelayMs = Number(config?.activeLearning?.saveDelayMs || 250);
    this.pendingSaveTimer = null;
    this.storePath = config?.activeLearning?.storePath || buildDataPaths(config).learningPath;
    const loadedData = this._load();
    this.data = this._sanitize(loadedData);
    if (this._purgeProtectedUserFacts() || this._containsPrivateCommunicationRecords(loadedData)) {
      this._writeNow();
    }
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
      this._save({ defer: true });
      return this._formatCorrection(exact);
    }

    const closest = this._findClosestCorrection(normalized);
    if (closest) {
      closest.rule.uses = Number(closest.rule.uses || 0) + 1;
      closest.rule.updatedAt = new Date().toISOString();
      this._save({ defer: true });
      return this._formatCorrection(closest.rule, closest.match.similarity, 'learned-fuzzy');
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
    this._pruneRecordObject(this.data.preferences, MAX_PREFERENCES);
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

    const normalizedKind = normalizePersonalFactKey(kind).replace(/\s+/g, '.');
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
    this._pruneRecordObject(this.data.userFacts, MAX_USER_FACTS);
    this._save();
    return record;
  }

  getUserFact(kind) {
    if (!this.enabled || !kind) {
      return null;
    }

    const normalizedKind = normalizePersonalFactKey(kind).replace(/\s+/g, '.');
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
    if (facts.location) summary.push(`location: ${facts.location}`);
    if (facts.hometown) summary.push(`hometown: ${facts.hometown}`);
    if (facts.school) summary.push(`school: ${facts.school}`);
    if (facts.workplace) summary.push(`workplace: ${facts.workplace}`);
    if (facts.favorite_color) summary.push(`favorite color: ${facts.favorite_color}`);
    if (facts.favorite_food) summary.push(`favorite food: ${facts.favorite_food}`);
    if (facts.favorite_movie) summary.push(`favorite movie: ${facts.favorite_movie}`);
    if (facts.favorite_music) summary.push(`favorite music: ${facts.favorite_music}`);
    if (facts.favorite_sport) summary.push(`favorite sport: ${facts.favorite_sport}`);
    if (facts.friend_name) summary.push(`friend: ${facts.friend_name}`);
    if (facts.phone) summary.push(`phone: ${facts.phone}`);
    if (facts.email) summary.push(`email: ${facts.email}`);
    return summary.length > 0 ? summary.join(', ') : 'no personal facts stored';
  }

  learnFromMultiCommand(input, commands) {
    if (!this.enabled || !Array.isArray(commands) || commands.length < 2) {
      return null;
    }
    if (containsPrivateCommunicationIntent(commands)) {
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
      this._save({ defer: true });
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
            this._save({ defer: true });
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
      return {
        type: 'user-fact',
        known: false,
        fact: `${service}Password`,
        sensitive: true,
        response: `I cannot store or reveal ${service} account passwords. Please use Windows Credential Manager or a dedicated password manager.`
      };
    }

    const professionMatch = /^(?:what|who)\s+(?:is|are)\s+(?:i|me|my\s+)(?:profession|job|work|career)\b|^do\s+you\s+(?:know|remember)\s+(?:my\s+)?(?:profession|job|work|career)\b|^(?:what|whats)\s+(?:do\s+i|my)\s+(?:do|work)\b/.test(normalized);
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
      const parts = [];
      const summaryFacts = [
        ['name', value => `Your name is ${value}`],
        ['profession', value => `you are a ${value}`],
        ['location', value => `you live in ${value}`],
        ['hometown', value => `you are from ${value}`],
        ['school', value => `you study at ${value}`],
        ['workplace', value => `you work at ${value}`],
        ['favorite_color', value => `your favorite color is ${value}`],
        ['favorite_food', value => `your favorite food is ${value}`]
      ];
      for (const [key, formatter] of summaryFacts) {
        const fact = this.getUserFact(key);
        if (fact?.value) {
          parts.push(formatter(fact.value));
        }
      }
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

    const locationMatch = /^(?:where\s+(?:do\s+i\s+live|am\s+i\s+from|was\s+i\s+born)|what\s+is\s+my\s+(?:location|address|hometown|native\s+place))\b/.test(normalized);
    if (locationMatch) {
      const key = /\b(?:from|born|hometown|native\s+place)\b/.test(normalized) ? 'hometown' : 'location';
      const fact = this.getUserFact(key);
      return {
        type: 'user-fact',
        known: Boolean(fact?.value),
        fact: key,
        response: fact?.value
          ? `Your ${personalFactLabel(key)} is ${fact.value}, sir.`
          : `I do not have your ${personalFactLabel(key)} stored yet, sir.`
      };
    }

    const placeQuestionMatch = /^(?:where\s+do\s+i\s+(study|work)|what\s+is\s+my\s+(school|college|university|workplace|company|office))\b/.exec(normalized);
    if (placeQuestionMatch) {
      const key = /work|company|office/.test(placeQuestionMatch[1] || placeQuestionMatch[2] || '')
        ? 'workplace'
        : 'school';
      const fact = this.getUserFact(key);
      return {
        type: 'user-fact',
        known: Boolean(fact?.value),
        fact: key,
        response: fact?.value
          ? `Your ${personalFactLabel(key)} is ${fact.value}, sir.`
          : `I do not have your ${personalFactLabel(key)} stored yet, sir.`
      };
    }

    const directPersonalFactMatch = normalized.match(/^(?:what\s+is|what'?s|tell\s+me|do\s+you\s+(?:know|remember))\s+my\s+(.+)$/);
    if (directPersonalFactMatch?.[1]) {
      const key = normalizePersonalFactKey(directPersonalFactMatch[1]);
      if (key && !PROTECTED_FACT_KEY_PATTERN.test(key)) {
        const fact = this.getUserFact(key);
        if (fact?.value) {
          return {
            type: 'user-fact',
            known: true,
            fact: key,
            response: `Your ${personalFactLabel(key)} is ${fact.value}, sir.`
          };
        }

        const knownPersonalKey = Boolean(PERSONAL_FACT_LABELS[key] || PERSONAL_FACT_ALIASES[key]);
        if (knownPersonalKey) {
          return {
            type: 'user-fact',
            known: false,
            fact: key,
            response: `I do not have your ${personalFactLabel(key)} stored yet, sir. You can say, "remember my ${personalFactLabel(key)} is [value]."`
          };
        }
      }
    }

    const factMatch = normalized.match(/^(?:(what\s+is|what'?s|tell me|do\s+you\s+(?:know|remember))\s+)?my\s+(.+)$/);
    if (factMatch?.[2]) {
      const questionPrefix = factMatch[1] || '';
      const key = normalizePersonalFactKey(factMatch[2]);
      if (key && !PROTECTED_FACT_KEY_PATTERN.test(key)) {
        const fact = this.getUserFact(key);
        if (fact?.value) {
          return {
            type: 'user-fact',
            known: true,
            fact: key,
            response: `Your ${personalFactLabel(key)} is ${fact.value}, sir.`
          };
        }
        if (/\b(?:tell me|do\s+you\s+(?:know|remember))\b/.test(questionPrefix)) {
          return {
            type: 'user-fact',
            known: false,
            fact: key,
            response: `I do not have your ${personalFactLabel(key)} stored yet, sir. You can say, "remember my ${personalFactLabel(key)} is [value]."`
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
    if (!this.enabled || containsPrivateCommunicationIntent(entry?.intent)) {
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

  recordRoutingEvidence(entry = {}) {
    if (!this.enabled || containsPrivateCommunicationIntent(entry.intent)) {
      return null;
    }

    const semanticParse = entry?.semanticParse || null;
    const frames = Array.isArray(semanticParse?.frames)
      ? semanticParse.frames.slice(0, 6).map(frame => ({
          text: cleanCommand(frame.text),
          action: frame.action || null,
          domain: frame.domain || 'unknown',
          intentId: frame.intentId || null,
          confidence: Number(frame.confidence || 0),
          validationStatus: frame.validation?.status || 'unknown'
        }))
      : [];

    const record = {
      timestamp: new Date().toISOString(),
      input: cleanCommand(entry.input),
      source: entry.source || 'chat',
      intent: entry.intent || null,
      success: Boolean(entry.success),
      routeSource: entry.routeSource || null,
      validationStatus: entry.validationStatus || semanticParse?.validation?.status || 'unknown',
      frames
    };

    this.data.routingEvidence.unshift(record);
    this.data.routingEvidence = this.data.routingEvidence.slice(0, MAX_ROUTE_EVIDENCE);
    this._save({ defer: true });
    return record;
  }

  getRoutingEvidence(limit = 20) {
    if (!this.enabled) {
      return [];
    }

    return (this.data.routingEvidence || []).slice(0, Math.max(0, Number(limit) || 20));
  }

  buildFeedbackKey(entry = {}) {
    const intent = String(entry.intent || '').trim();
    if (containsPrivateCommunicationIntent(intent)) {
      return '';
    }
    const entities = isPlainObject(entry.entities) ? entry.entities : {};
    const target = [
      entities.appName,
      entities.folderName,
      entities.filename,
      entities.fileName,
      entities.windowName,
      entities.query,
      entities.mediaQuery,
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

    const personalText = text
      .replace(/^(?:remember|note|learn)\s+(?:this\s+)?(?:that\s+)?/i, '')
      .trim();

    const identityMatch = personalText.match(/^i\s+am\s+(?:a\s+)?(.+)$/i);

    const passwordRememberMatch = text.match(new RegExp(`^(?:remember|save|store)\\s+(?:my\\s+)?((?:${ACCOUNT_SERVICE_PATTERN})\\s+)?(?:account\\s+)?password\\s+(?:is\\s+)?(.+)$`, 'i'));
    if (passwordRememberMatch && (passwordRememberMatch[1] || passwordRememberMatch[2])) {
      const serviceName = normalizeAccountService(passwordRememberMatch[1]);
      return this._rejectSensitiveCredential(serviceName);
    }

    const passwordThisMatch = text.match(new RegExp(`^(?:remember|save|store)\\s+this\\s+(.+?)\\s+as\\s+(?:my\\s+)?((?:${ACCOUNT_SERVICE_PATTERN})\\s+)?(?:account\\s+)?password$`, 'i'));
    if (passwordThisMatch && passwordThisMatch[1]) {
      const serviceName = normalizeAccountService(passwordThisMatch[2]);
      return this._rejectSensitiveCredential(serviceName);
    }

    const passwordGeneralMatch = text.match(/^(?:remember|save|store)\s+this\s+(.+?)\s+as\s+(?:my\s+)?password$/i);
    if (passwordGeneralMatch && passwordGeneralMatch[1]) {
      return this._rejectSensitiveCredential('general');
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
      const key = normalizePersonalFactKey(genericRememberMatch[1]);
      const value = genericRememberMatch[2].replace(/[.!?]+$/g, '').trim();
      if (key && value && key.length > 1 && value.length > 0 && value.length < 100 && !PROTECTED_FACT_KEY_PATTERN.test(key) && !/^(?:i|my|the|a|an|this|that|it|they|them|his|her|their)\b/i.test(key)) {
        const fact = this.rememberUserFact(key, value, {
          source: /^remember\b/i.test(text) ? 'explicit-memory' : 'user-stated-fact'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Noted, sir. I will remember that ${personalFactLabel(key)} is ${fact.value}.`
          };
        }
      }
    }

    const myXIsYMatch = personalText.match(/^my\s+(.+?)\s+(?:is|was|are|were)\s+(.+)$/i);
    if (myXIsYMatch && myXIsYMatch[1] && myXIsYMatch[2]) {
      const key = normalizePersonalFactKey(myXIsYMatch[1]);
      const value = myXIsYMatch[2].replace(/[.!?]+$/g, '').trim();
      if (key && value && key.length > 1 && value.length > 0 && value.length < 100 && !/^(?:name|password|email|phone|mobile|card|number)\b/i.test(key)) {
        const fact = this.rememberUserFact(key, value, {
          source: 'user-stated-fact'
        });
        if (fact) {
          return {
            type: 'user-fact',
            response: `Noted, sir. I will remember that your ${personalFactLabel(key)} is ${fact.value}.`
};
        }
      }
    }

    const callMeMatch = personalText.match(/^(?:you\s+can\s+)?call\s+me\s+(.+)$/i);
    if (callMeMatch?.[1]) {
      const name = callMeMatch[1].replace(/[.!?]+$/g, '').trim();
      if (name && name.length > 0 && name.length < 50) {
        const fact = this.rememberUserFact('name', name, { source: 'explicit-memory' });
        if (fact) {
          return { type: 'user-fact', response: `Understood, sir. I will call you ${fact.value}.` };
        }
      }
    }

    const myFriendMatch = personalText.match(/^my\s+friend(?:\'s)?\s+(?:name\s+is\s+)?(.+)$/i);
    if (myFriendMatch?.[1]) {
      const friendName = myFriendMatch[1].replace(/[.!?]+$/g, '').trim();
      if (friendName && friendName.length > 0 && friendName.length < 50) {
        const fact = this.rememberUserFact('friend_name', friendName, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. Your friend's name is ${fact.value}.` };
        }
      }
    }

    const liveInMatch = personalText.match(/^(?:i\s+)?live\s+(?:in|at)\s+(.+)$/i);
    if (liveInMatch?.[1]) {
      const location = liveInMatch[1].replace(/[.!?]+$/g, '').trim();
      if (location && location.length > 1 && location.length < 100) {
        const fact = this.rememberUserFact('location', location, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You live in ${fact.value}.` };
        }
      }
    }

    const fromMatch = personalText.match(/^(?:i(?:\'m|\s+am))?\s*(?:from|born\s+in)\s+(.+)$/i);
    if (fromMatch?.[1]) {
      const place = fromMatch[1].replace(/[.!?]+$/g, '').trim();
      if (place && place.length > 1 && place.length < 100) {
        const fact = this.rememberUserFact('hometown', place, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You are from ${fact.value}.` };
        }
      }
    }

    const studyAtMatch = personalText.match(/^(?:i\s+)?study\s+(?:at|in)\s+(.+)$/i);
    if (studyAtMatch?.[1]) {
      const institution = studyAtMatch[1].replace(/[.!?]+$/g, '').trim();
      if (institution && institution.length > 1 && institution.length < 100) {
        const fact = this.rememberUserFact('school', institution, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You study at ${fact.value}.` };
        }
      }
    }

    const workAtMatch = personalText.match(/^(?:i\s+)?work\s+(?:at|in|for)\s+(.+)$/i);
    if (workAtMatch?.[1]) {
      const workplace = workAtMatch[1].replace(/[.!?]+$/g, '').trim();
      if (workplace && workplace.length > 1 && workplace.length < 100) {
        const fact = this.rememberUserFact('workplace', workplace, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You work at ${fact.value}.` };
        }
      }
    }

    const studentAtMatch = personalText.match(/^i\s+am\s+(?:a\s+)?student\s+(?:at|in|of)\s+(.+)$/i);
    if (studentAtMatch?.[1]) {
      const institution = studentAtMatch[1].replace(/[.!?]+$/g, '').trim();
      if (institution && institution.length > 1 && institution.length < 100) {
        const fact = this.rememberUserFact('school', institution, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You are a student at ${fact.value}.` };
        }
      }
    }

    const professionStudentMatch = personalText.match(/^i\s+am\s+(?:a|an)\s+(.+)$/i);
    if (professionStudentMatch?.[1]) {
      const profession = professionStudentMatch[1].replace(/[.!?]+$/g, '').trim();
      if (profession && profession.length > 1 && profession.length < 50 && !/^(?:student|going|doing|here|ready|available)\b/i.test(profession)) {
        const fact = this.rememberUserFact('profession', profession, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. Your profession is ${fact.value}.` };
        }
      }
    }

    const likeMatch = personalText.match(/^(?:i\s+)?(?:like|love|prefer)\s+(?:my\s+)?(.+)$/i);
    if (likeMatch?.[1]) {
      const thing = likeMatch[1].replace(/[.!?]+$/g, '').trim();
      const lowerThing = thing.toLowerCase();
      if (thing && thing.length > 1 && thing.length < 100) {
        if (/\b(food|burger|pizza|pasta|rice|chicken|fish|vegetables|fruit|coffee|tea)\b/i.test(lowerThing)) {
          const fact = this.rememberUserFact('favorite_food', thing, { source: 'user-stated-fact' });
          if (fact) return { type: 'user-fact', response: `Noted, sir. Your favorite food is ${fact.value}.` };
        }
        if (/\b(color|colour|blue|red|green|black|white|pink|purple|yellow|orange)\b/i.test(lowerThing)) {
          const fact = this.rememberUserFact('favorite_color', thing, { source: 'user-stated-fact' });
          if (fact) return { type: 'user-fact', response: `Noted, sir. Your favorite color is ${fact.value}.` };
        }
        if (/\b(movie|film|series|show|netflix|amazon)\b/i.test(lowerThing)) {
          const fact = this.rememberUserFact('favorite_movie', thing, { source: 'user-stated-fact' });
          if (fact) return { type: 'user-fact', response: `Noted, sir. Your favorite movie is ${fact.value}.` };
        }
        if (/\b(music|song|artist|band|spotify)\b/i.test(lowerThing)) {
          const fact = this.rememberUserFact('favorite_music', thing, { source: 'user-stated-fact' });
          if (fact) return { type: 'user-fact', response: `Noted, sir. Your favorite music is ${fact.value}.` };
        }
        if (/\b(sport|cricket|football|basketball|tennis|hockey)\b/i.test(lowerThing)) {
          const fact = this.rememberUserFact('favorite_sport', thing, { source: 'user-stated-fact' });
          if (fact) return { type: 'user-fact', response: `Noted, sir. Your favorite sport is ${fact.value}.` };
        }
        const fact = this.rememberUserFact('likes', thing, { source: 'user-stated-fact' });
        if (fact) return { type: 'user-fact', response: `Noted, sir. You like ${fact.value}.` };
      }
    }

    const haveMatch = personalText.match(/^(?:i\s+)?have\s+(?:a\s+)?(.+)$/i);
    if (haveMatch?.[1]) {
      const item = haveMatch[1].replace(/[.!?]+$/g, '').trim();
      if (item && item.length > 1 && item.length < 100 && !/^(?:a|an|the|no|not|some|many|much)\b/i.test(item)) {
        const fact = this.rememberUserFact('possessions', item, { source: 'user-stated-fact' });
        if (fact) {
          return { type: 'user-fact', response: `Noted, sir. You have ${fact.value}.` };
        }
      }
    }

    const emailMatch = personalText.match(/^(?:my\s+)?(?:email|e-?mail)(?:\s+is|\s+address\s+is)?\s*[:=]?\s*(.+)$/i);
    if (emailMatch?.[1]) {
      const email = emailMatch[1].replace(/[.!?]+$/g, '').trim();
      if (email && email.includes('@')) {
        const fact = this.rememberUserFact('email', email, { source: 'user-stated-fact' });
        if (fact) return { type: 'user-fact', response: `Noted, sir. Your email is ${fact.value}.` };
      }
    }

    const phoneNumMatch = personalText.match(/^(?:my\s+)?(?:phone|mobile|telephone)(?:\s+number)?\s*(?::|is)?\s*(.+)$/i);
    if (phoneNumMatch?.[1]) {
      const phone = phoneNumMatch[1].replace(/[.!?]+$/g, '').replace(/\s+/g, '').trim();
      if (phone && phone.length >= 7) {
        const fact = this.rememberUserFact('phone', phone, { source: 'user-stated-fact' });
        if (fact) return { type: 'user-fact', response: `Noted, sir. Your phone number is ${fact.value}.` };
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

  flush() {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }
    this._writeNow();
  }

  _formatCorrection(rule, confidenceOverride = null, sourceOverride = '') {
    return {
      input: rule.input,
      correction: rule.correction,
      confidence: confidenceOverride ?? rule.confidence ?? 1,
      source: sourceOverride || rule.source
    };
  }

  _findClosestCorrection(normalized) {
    const rules = Array.isArray(this.data.commandRewrites) ? this.data.commandRewrites : [];
    const candidates = rules
      .map(rule => rule?.normalizedInput)
      .filter(value => value && Math.abs(value.length - normalized.length) <= Math.max(2, Math.ceil(normalized.length * 0.18)));
    if (candidates.length === 0) {
      return null;
    }

    const match = Normalizer.findClosestOption(normalized, candidates, {
      minSimilarity: normalized.length >= 12 ? 0.86 : 0.9,
      maxDistance: Math.max(1, Math.ceil(normalized.length * 0.18))
    });
    if (!match) {
      return null;
    }

    const rule = rules.find(candidate => candidate.normalizedInput === match.match);
    return rule ? { rule, match } : null;
  }

  _save(options = {}) {
    if (options.defer) {
      this._scheduleSave();
      return;
    }
    this.flush();
  }

  _scheduleSave() {
    if (this.pendingSaveTimer) {
      return;
    }

    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this._writeNow();
    }, Math.max(1, this.saveDelayMs));

    if (typeof this.pendingSaveTimer.unref === 'function') {
      this.pendingSaveTimer.unref();
    }
  }

  _writeNow() {
    const directory = path.dirname(this.storePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    writeJsonAtomic(this.storePath, this.data);
  }

  _rejectSensitiveCredential(serviceName = 'general') {
    return {
      type: 'rejected-sensitive',
      learned: false,
      sensitive: true,
      service: serviceName,
      response: `I cannot store ${serviceName} account passwords in assistant memory. Please use Windows Credential Manager or a dedicated password manager.`
    };
  }

  _purgeProtectedUserFacts() {
    const facts = this.data?.userFacts;
    if (!isPlainObject(facts)) {
      return false;
    }

    let changed = false;
    for (const key of Object.keys(facts)) {
      if (PROTECTED_FACT_KEY_PATTERN.test(key)) {
        delete facts[key];
        changed = true;
      }
    }
    return changed;
  }

  _pruneRecordObject(records, maxSize) {
    if (!isPlainObject(records) || !Number.isFinite(maxSize) || maxSize <= 0) {
      return records;
    }

    const keys = Object.keys(records);
    if (keys.length <= maxSize) {
      return records;
    }

    const keep = new Set(keys
      .sort((left, right) => {
        const leftTime = Date.parse(records[left]?.updatedAt || records[left]?.createdAt || 0) || 0;
        const rightTime = Date.parse(records[right]?.updatedAt || records[right]?.createdAt || 0) || 0;
        return rightTime - leftTime;
      })
      .slice(0, maxSize));

    for (const key of keys) {
      if (!keep.has(key)) {
        delete records[key];
      }
    }

    return records;
  }

  _containsPrivateCommunicationRecords(source) {
    if (!isPlainObject(source)) return false;
    const lists = ['feedback', 'mistakes', 'feedbackPrompts', 'routingEvidence'];
    if (lists.some(key => Array.isArray(source[key]) && source[key].some(entry => containsPrivateCommunicationIntent(entry?.intent)))) {
      return true;
    }
    return Object.values(isPlainObject(source.commandSequences) ? source.commandSequences : {})
      .some(entry => containsPrivateCommunicationIntent(entry?.sequence));
  }

  _sanitize(input) {
    const source = isPlainObject(input) ? input : {};
    const preferences = this._pruneRecordObject(
      isPlainObject(source.preferences) ? { ...source.preferences } : {},
      MAX_PREFERENCES
    );
    const userFacts = this._pruneRecordObject(
      isPlainObject(source.userFacts) ? { ...source.userFacts } : {},
      MAX_USER_FACTS
    );
    return {
      version: 1,
      preferences,
      userFacts,
      commandRewrites: Array.isArray(source.commandRewrites) ? source.commandRewrites.slice(0, MAX_REWRITES) : [],
      feedback: Array.isArray(source.feedback) ? source.feedback.filter(entry => !containsPrivateCommunicationIntent(entry?.intent)).slice(0, MAX_EVENTS) : [],
      mistakes: Array.isArray(source.mistakes) ? source.mistakes.filter(entry => !containsPrivateCommunicationIntent(entry?.intent)).slice(0, MAX_EVENTS) : [],
      feedbackPrompts: Array.isArray(source.feedbackPrompts) ? source.feedbackPrompts.filter(entry => !containsPrivateCommunicationIntent(entry?.intent)).slice(0, MAX_PROMPTS) : [],
      routingEvidence: Array.isArray(source.routingEvidence) ? source.routingEvidence.filter(entry => !containsPrivateCommunicationIntent(entry?.intent)).slice(0, MAX_ROUTE_EVIDENCE) : [],
      commandSequences: isPlainObject(source.commandSequences)
        ? Object.fromEntries(Object.entries(source.commandSequences).filter(([, entry]) => !containsPrivateCommunicationIntent(entry?.sequence)))
        : {}
    };
  }
}

module.exports = ActiveLearningStore;
