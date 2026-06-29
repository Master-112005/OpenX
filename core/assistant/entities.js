const Logger = require('./Data').Logger;
const Normalizer = require('./Data').Normalizer;
const Validator = require('./Data').Validator;
const { cleanEntityName } = require('../automation/common/path-utils');

const APP_ALIASES = {
  'vscode': 'vscode',
  'visual studio code': 'visual studio code',
  'vs code': 'vs code',
  'chrome': 'chrome',
  'google chrome': 'chrome',
  'firefox': 'firefox',
  'mozilla firefox': 'firefox',
  'edge': 'msedge',
  'microsoft edge': 'msedge',
  'notepad': 'notepad',
  'word': 'winword',
  'microsoft word': 'winword',
  'excel': 'excel',
  'microsoft excel': 'excel',
  'powerpoint': 'powerpoint',
  'power point': 'powerpoint',
  'power paint': 'powerpoint',
  'microsoft powerpoint': 'powerpoint',
  'outlook': 'outlook',
  'microsoft outlook': 'outlook',
  'powershell': 'powershell',
  'terminal': 'cmd',
  'command prompt': 'cmd',
  'cmd': 'cmd',
  'explorer': 'explorer',
  'file explorer': 'explorer',
  'calculator': 'calc',
  'paint': 'mspaint',
  'snipping tool': 'snippingtool',
  'task manager': 'taskmgr',
  'control panel': 'control',
  'settings': 'ms-settings',
  'windows settings': 'ms-settings',
  'system settings': 'ms-settings',
  'spotify': 'spotify',
  'discord': 'discord',
  'google chat': 'google chat',
  'whatsapp': 'whatsapp',
  'telegram': 'telegram',
  'telgram': 'telegram',
  'teligram': 'telegram',
  'teigam': 'telegram',
  'slack': 'slack',
  'zoom': 'zoom',
  'teams': 'teams',
  'microsoft teams': 'teams',
  'cloudflare': 'cloudflare warp',
  'cloudfare': 'cloudflare warp',
  'cloudfair': 'cloudflare warp',
  'cloudflare warp': 'cloudflare warp',
  'cloudflare one': 'cloudflare one',
  'cloudflare one client': 'cloudflare one',
  'cloudfair one clint': 'cloudflare one',
  'apple music': 'apple music',
  'applemusic': 'apple music',
  'apple tv': 'apple tv',
  'youtube': 'youtube',
  'github': 'github',
  'git hub': 'github',
  'hacker rank': 'hacker rank',
  'hacker rank website': 'hacker rank',
  'hackerrank': 'hacker rank',
  'linkedin': 'linkedin',
  'linked in': 'linkedin',
  'facebook': 'facebook',
  'fb': 'facebook',
  'twitter': 'twitter',
  'x.com': 'twitter',
  'instagram': 'instagram',
  'ig': 'instagram',
  'amazon': 'amazon',
  'amazon website': 'amazon',
  'netflix': 'netflix',
  'recycle bin': 'recycle bin',
  'microsoft store': 'microsoft store',
  'store': 'microsoft store',
  'photos': 'photos',
  'microsoft photos': 'photos',
  'calendar': 'calendar',
  'clock': 'clock',
  'timer': 'clock',
  'timr': 'clock',
  'alarms': 'clock',
  'alarms and clock': 'clock',
  'antigravity': 'antigravity'
};

const EXACT_ONLY_APP_ALIASES = new Set(['store']);

const FOLDER_ALIASES = {
  'downloads': 'downloads',
  'documents': 'documents',
  'desktop': 'desktop',
  'pictures': 'pictures',
  'music': 'music',
  'videos': 'videos',
  'home': 'home'
};

const APP_COMMAND_VERBS = [
  'open',
  'launch',
  'start',
  'run',
  'close',
  'exit',
  'quit',
  'terminate',
  'stop',
  'switch',
  'focus',
  'go',
  'goto',
  'activate'
];

const APP_ENTITY_LEADING_NOISE = new Set([
  'a',
  'an',
  'app',
  'application',
  'current',
  'my',
  'program',
  'the',
  'this',
  'that',
  'window'
]);

const APP_ENTITY_BLOCKED_PREFIXES = new Set([
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'to',
  'with'
]);

const SCHEDULE_AMOUNT_PATTERN = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty(?:\s*five)?|sixty)`;
const SCHEDULE_DURATION_PATTERN = String.raw`${SCHEDULE_AMOUNT_PATTERN}\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?)`;
const SCHEDULE_CLOCK_PATTERN = String.raw`\d{1,2}(?:(?::|\s+)\d{2})?\s*(?:am|pm)?(?:\s+(?:today|tomorrow))?`;
const SCHEDULE_DAY_PATTERN = String.raw`today|tomorrow(?:\s+(?:morning|afternoon|evening|night))?|tonight|next\s+week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)`;
const SCHEDULE_NATURAL_TIME_PATTERN = String.raw`noon|midnight|(?:morning|afternoon|evening|night)(?:\s+at\s+${SCHEDULE_CLOCK_PATTERN})?|(?:half|quarter)\s+(?:past|to)\s+\w+`;

class EntityExtractor {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
  }

  extract(intent, text) {
    if (!intent || !intent.entities) return {};

    const entities = {};
    const normalized = Normalizer.normalizeText(text);

    intent.entities.forEach(entityDef => {
      switch (entityDef.name) {
        case 'value':
          entities.value = this._extractValue(normalized);
          break;
        case 'appName':
          entities.appName = this._extractAppName(normalized, text);
          break;
        case 'filename':
          entities.filename = this._extractFilename(normalized, text);
          break;
        case 'folderName':
          entities.folderName = this._extractFolderName(normalized, text);
          break;
        case 'url':
          entities.url = this._extractUrl(normalized, text);
          break;
        case 'query':
          entities.query = this._extractQuery(normalized, text);
          break;
        case 'contactName':
          entities.contactName = this._extractContactName(normalized, text);
          break;
        case 'messageText':
          entities.messageText = this._extractMessageText(normalized, text);
          break;
        case 'platform':
          entities.platform = this._extractPlatform(normalized, text);
          break;
        case 'source':
          entities.source = this._extractSource(normalized, text);
          break;
        case 'destination':
          entities.destination = this._extractDestination(normalized, text);
          break;
        case 'oldName':
          entities.oldName = this._extractOldName(normalized, text);
          break;
        case 'newName':
          entities.newName = this._extractNewName(normalized, text);
          break;
        case 'windowName':
          entities.windowName = this._extractWindowName(normalized);
          break;
        case 'path':
          entities.path = this._extractPath(normalized, text);
          break;
        case 'duration':
          entities.duration = this._extractDuration(text);
          break;
        case 'timeExpression':
          entities.timeExpression = this._extractTimeExpression(normalized, text);
          break;
        case 'reminderText':
          entities.reminderText = this._extractReminderText(normalized, text);
          break;
        case 'reminderCategory':
          entities.reminderCategory = this._extractReminderCategory(text);
          break;
        case 'alarmLabel':
          entities.alarmLabel = this._extractAlarmLabel(text);
          break;
        case 'recurrence':
          entities.recurrence = this._extractRecurrence(text);
          break;
        case 'mediaQuery':
          entities.mediaQuery = this._extractMediaQuery(normalized, text);
          break;
        case 'mediaPlatform':
          entities.mediaPlatform = this._extractMediaPlatform(normalized, text);
          break;
        case 'modeName':
          entities.modeName = this._extractModeName(normalized, text);
          break;
        default:
          break;
      }
    });

    return entities;
  }

  _extractValue(text) {
    const num = Normalizer.extractNumber(text);
    if (num === null) return null;
    if (num > 100) return 100;
    if (num < 0) return 0;
    return num;
  }

  _resolveAlias(candidate, aliases, config = {}) {
    if (!candidate) return null;

    const normalized = Normalizer.normalizeText(candidate);
    if (aliases[normalized]) {
      return aliases[normalized];
    }

    const match = Normalizer.findClosestOption(normalized, Object.keys(aliases), config);
    if (!match) {
      return null;
    }

    const exactOnlyAliases = config.exactOnlyAliases instanceof Set
      ? config.exactOnlyAliases
      : new Set();
    if (exactOnlyAliases.has(match.normalizedMatch)) {
      return null;
    }

    return aliases[match.normalizedMatch];
  }

  _stripTrailingEntityNoise(value) {
    return String(value || '')
      .trim()
      .replace(/\b(?:please|kindly|now|app|application|window|program)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _stripLeadingEntityNoise(value) {
    const tokens = Normalizer.tokenize(value).filter(Boolean);
    while (tokens.length > 0 && APP_ENTITY_LEADING_NOISE.has(tokens[0])) {
      tokens.shift();
    }
    return tokens.join(' ').trim();
  }

  _normalizeAppSegment(value) {
    const withoutTrailingNoise = this._stripTrailingEntityNoise(value);
    const withoutLeadingNoise = this._stripLeadingEntityNoise(withoutTrailingNoise);
    return withoutLeadingNoise.trim();
  }

  _extractAppNameFromSegmentTokens(tokens, options = {}) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }

    const normalizedSegment = this._normalizeAppSegment(tokens.join(' '));
    if (!normalizedSegment) {
      return null;
    }

    const normalizedTokens = Normalizer.tokenize(normalizedSegment);
    if (normalizedTokens.length === 0) {
      return null;
    }

    if (APP_ENTITY_BLOCKED_PREFIXES.has(normalizedTokens[0])) {
      return null;
    }

    const directAlias = this._resolveAlias(normalizedSegment, APP_ALIASES, {
      minSimilarity: 0.64,
      maxDistance: 2,
      exactOnlyAliases: EXACT_ONLY_APP_ALIASES
    });
    if (directAlias) {
      return directAlias;
    }

    const fuzzyAlias = this._findAliasFromTokenWindows(normalizedTokens, APP_ALIASES, {
      minSimilarity: 0.74,
      maxDistance: 1
    });
    if (fuzzyAlias) {
      return fuzzyAlias;
    }

    return options.allowUnknown ? normalizedSegment : null;
  }

  _extractRawAppNameFromCommand(tokens, verbSpan) {
    const tail = this._normalizeAppSegment(tokens.slice(verbSpan.end).join(' '));
    if (tail) {
      const tailTokens = Normalizer.tokenize(tail);
      if (!APP_ENTITY_BLOCKED_PREFIXES.has(tailTokens[0])) {
        return tail;
      }
    }

    const head = this._normalizeAppSegment(tokens.slice(0, verbSpan.start).join(' '));
    const headTokens = Normalizer.tokenize(head);
    if (head && !APP_ENTITY_BLOCKED_PREFIXES.has(headTokens[0])) {
      return head;
    }

    return null;
  }

  _findCommandVerbSpan(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }

    for (let index = 0; index < tokens.length; index += 1) {
      const single = tokens[index];
      const pair = index < tokens.length - 1 ? `${tokens[index]} ${tokens[index + 1]}` : null;
      const candidates = pair ? [pair, single] : [single];

      for (const candidate of candidates) {
        const isExact = APP_COMMAND_VERBS.includes(candidate);
        const fuzzyMatch = isExact
          ? true
          : Boolean(Normalizer.findClosestOption(candidate, APP_COMMAND_VERBS, {
              minSimilarity: 0.6,
              maxDistance: candidate.length >= 5 ? 2 : 1
            }));

        if (!fuzzyMatch) {
          continue;
        }

        const width = candidate.includes(' ') ? 2 : 1;
        return { start: index, end: index + width, verb: candidate, isExact };
      }
    }

    return null;
  }

  _findAliasFromTokenWindows(tokens, aliases, config = {}) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }

    const aliasKeys = Object.keys(aliases);
    if (aliasKeys.length === 0) {
      return null;
    }

    const maxWindowSize = aliasKeys.reduce((max, alias) => {
      return Math.max(max, Normalizer.tokenize(alias).length);
    }, 1);

    for (let windowSize = maxWindowSize; windowSize >= 1; windowSize -= 1) {
      for (let index = 0; index <= tokens.length - windowSize; index += 1) {
        const candidate = this._stripTrailingEntityNoise(tokens.slice(index, index + windowSize).join(' '));
        if (!candidate) {
          continue;
        }

        const match = this._resolveAlias(candidate, aliases, config);
        if (match) {
          return match;
        }
      }
    }

    return null;
  }

  _extractAppName(text, raw) {
    const tokens = Normalizer.tokenize(raw || text);
    const verbSpan = this._findCommandVerbSpan(tokens);
    if (verbSpan) {
      const allowUnknown = verbSpan.isExact;
      const tailMatch = this._extractAppNameFromSegmentTokens(tokens.slice(verbSpan.end), { allowUnknown });
      if (tailMatch) {
        return tailMatch;
      }

      const headMatch = this._extractAppNameFromSegmentTokens(tokens.slice(0, verbSpan.start), { allowUnknown });
      if (headMatch) {
        return headMatch;
      }

      return allowUnknown ? this._extractRawAppNameFromCommand(tokens, verbSpan) : null;
    }

    const patterns = ['open ', 'launch ', 'start ', 'close ', 'exit ', 'quit ', 'terminate ', 'switch to ', 'go to ', 'focus ', 'run '];
    for (const p of patterns) {
      if (text.includes(p)) {
        const after = this._normalizeAppSegment(text.split(p)[1]);
        if (after && after.trim()) {
          const exactAlias = this._resolveAlias(after.trim(), APP_ALIASES, { minSimilarity: 0.64, maxDistance: 2 });
          if (exactAlias) {
            return exactAlias;
          }
        }
      }
    }

    const fuzzyWindowMatch = this._findAliasFromTokenWindows(tokens, APP_ALIASES, {
      minSimilarity: 0.74,
      maxDistance: 1
    });
    if (fuzzyWindowMatch) {
      return fuzzyWindowMatch;
    }

    const fallbackAlias = this._resolveAlias(raw, APP_ALIASES, {
      minSimilarity: 0.62,
      maxDistance: 2,
      exactOnlyAliases: EXACT_ONLY_APP_ALIASES
    });
    if (fallbackAlias) {
      return fallbackAlias;
    }

    return null;
  }

  _extractFilename(text, raw) {
    const explicitPath = raw.match(/(?:^|[\s"])([A-Za-z]:\\[^\s"]+\.[A-Za-z0-9]{1,10})(?=$|[\s"])/);
    if (explicitPath) {
      return cleanEntityName(explicitPath[1]);
    }

    const patterns = [
      { pattern: /\b(?:create|new|make)\s+file\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i, existing: false },
      { pattern: /\b(?:create|new|make)\s+(.+?)\s+file(?=\s+(?:on|in|at|to|from)\b|$)/i, existing: false },
      { pattern: /\b(?:delete|remove|erase)\s+file\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i, existing: true },
      { pattern: /\b(?:delete|remove|erase)\s+(.+?)\s+file(?=\s+(?:on|in|at|to|from)\b|$)/i, existing: true },
      { pattern: /\b(?:delete|remove|erase)\s+(.+?)(?=\s+(?:on|in|at|from)\b|$)/i, existing: true },
      { pattern: /\b(?:open|show|play|watch)\s+(?:file\s+)?(.+?)(?=\s+(?:on|in|at|from|with|using)\b|$)/i, existing: true },
      { pattern: /\b(?:rename|copy|move)\s+file\s+(.+?)(?=\s+(?:to|into|in|on|from)\b|$)/i, existing: true }
    ];

    for (const definition of patterns) {
      const match = raw.match(definition.pattern);
      if (match && match[1]) {
        const cleaned = cleanEntityName(match[1]);
        return definition.existing ? this._cleanExistingFileReference(cleaned) : cleaned;
      }
    }

    const explicitFile = raw.match(/(?:^|[\s"])([^\s"\\/]+\.[A-Za-z0-9]{1,10})(?=$|[\s"])/);
    if (explicitFile) {
      return cleanEntityName(explicitFile[1]);
    }

    return null;
  }

  _cleanExistingFileReference(value) {
    return String(value || '')
      .trim()
      .replace(/^(?:the|my|a|an)\s+/i, '')
      .replace(/\s+(?:file|document)\s*$/i, '')
      .trim();
  }

  _extractFolderName(text, raw) {
    const patterns = [
      /\b(?:create|new|make)\s+(?:a\s+)?(?:folder|directory)\s+(?:called|named)\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:create|new|make)\s+(?:folder|directory)\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:delete|remove|erase)\s+(?:folder|directory)\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:open|show|navigate to|go to)\s+(?:folder|directory)\s+(.+?)(?=\s+(?:on|in|at)\b|$)/i,
      /\b(?:open|show|navigate to|go to)\s+(.+?)\s+(?:folder|directory)(?=\s+(?:on|in|at)\b|$)/i,
      /\bmove\s+(?:folder|directory)\s+(.+?)(?=\s+(?:to|into|in|on|from)\b|$)/i
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match && match[1]) {
        return Validator.sanitizePath(cleanEntityName(match[1]) || '');
      }
    }

    for (const [alias, folder] of Object.entries(FOLDER_ALIASES)) {
      if (text.includes(alias)) return folder;
    }

    const fuzzyFolder = this._resolveAlias(raw, FOLDER_ALIASES, { minSimilarity: 0.65, maxDistance: 2 });
    if (fuzzyFolder) {
      return fuzzyFolder;
    }

    return null;
  }

  _extractUrl(text, raw) {
    const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:\/\S*)?/);
    if (urlMatch) return urlMatch[0];

    const patterns = ['open website ', 'go to website ', 'open url ', 'navigate to ', 'browse to ', 'open ', 'go to '];
    for (const p of patterns) {
      if (text.includes(p)) {
        const after = text.split(p)[1];
        if (after && after.trim()) {
          const site = after.trim().split(/\s+/)[0];
          if (!site.includes('.')) return `https://www.google.com/search?q=${encodeURIComponent(site)}`;
          if (!site.startsWith('http')) return `https://${site}`;
          return site;
        }
      }
    }

    return null;
  }

  _extractQuery(text, raw) {
    const patterns = [
      'search for ', 'search web ', 'search ', 'look up ', 'google ',
      'find file ', 'search file ', 'look for file ',
      'find folder ', 'search folder ', 'look for folder ',
      'find directory ', 'search directory ', 'locate '
    ];
    for (const p of patterns) {
      if (text.includes(p)) {
        const after = raw.split(new RegExp(p, 'i'))[1];
        if (after && after.trim()) {
          return after
            .replace(/\s+(?:in|on)\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
            .replace(/\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
            .replace(/\s+(?:file|folder|directory|location|path)\s*$/i, '')
            .trim();
        }
      }
    }

    if (/^(what|who|when|where|why|how)\b/i.test(String(raw || '').trim())) {
      return String(raw || '').trim();
    }

    return null;
  }

  _parseMessageCommand(raw) {
    const source = String(raw || '').trim();
    if (!source) return null;

    const patterns = [
      {
        regex: /^(?:send|message|text|msg)\s+(?:on|in|via|using)\s+(.+?)\s+to\s+("[^"]+"|'[^']+'|[^\s]+)\s+(?:saying\s+|that\s+)?(.+)$/i,
        map: match => ({
          platform: match[1],
          contactName: match[2],
          messageText: match[3]
        })
      },
      {
        regex: /^(?:send|share)\s+(.+?\.(?:pdf|txt|docx?|xlsx?|pptx?|csv|json|xml|html?|js|ts|py|java|png|jpe?g|gif|webp|mp[34]|mkv|wav|zip|rar))(?:\s+file)?\s+to\s+(.+?)(?:\s+(?:on|via|using)\s+(.+))?$/i,
        map: match => ({
          messageText: `file ${cleanEntityName(match[1], { stripTypeWords: true })}`,
          contactName: match[2],
          platform: match[3]
        })
      },
      {
        regex: /^(?:say|send)\s+(.+?)\s+to\s+(.+?)(?:\s+(?:on|in|via|using)\s+(.+))?$/i,
        map: match => ({
          messageText: match[1],
          contactName: match[2],
          platform: match[3]
        })
      },
      {
        regex: /^(?:ask|tell|message|text|msg|massage)\s+(.+?)(?:\s+(?:on|in|via|using)\s+(.+?))?\s+to\s+(.+)$/i,
        map: match => ({
          contactName: match[1],
          platform: match[2],
          messageText: match[3]
        })
      },
      {
        regex: /^(?:send(?:\s+a)?\s+(?:message|text))\s+to\s+(.+?)(?:\s+(?:on|in|via|using)\s+(.+?))?\s+(?:saying|that)\s+(.+)$/i,
        map: match => ({
          contactName: match[1],
          platform: match[2],
          messageText: match[3]
        })
      },
      {
        regex: /^(?:message|text)\s+(.+?)(?:\s+(?:on|in|via|using)\s+(.+?))?\s+(?:saying|that)\s+(.+)$/i,
        map: match => ({
          contactName: match[1],
          platform: match[2],
          messageText: match[3]
        })
      }
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (!match) continue;

      const parsed = pattern.map(match);
      return {
        contactName: this._cleanContactName(parsed.contactName),
        messageText: this._cleanMessageText(parsed.messageText),
        platform: this._cleanPlatformName(parsed.platform)
      };
    }

    return null;
  }

  _parseCallCommand(raw) {
    const source = String(raw || '').trim();
    if (!source) return null;

    const match = source.match(/^(?:call|dial|phone|ring)\s+(.+?)(?:\s+(?:on|via|using)\s+(.+))?$/i);
    if (!match) {
      return null;
    }

    return {
      contactName: this._cleanContactName(match[1]),
      platform: this._cleanPlatformName(match[2])
    };
  }

  _cleanContactName(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^(?:the|my)\s+/i, '')
      .replace(/\s+(?:please|now)$/i, '')
      .trim() || null;
  }

  _cleanMessageText(value) {
    return String(value || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\s+(?:please|now)$/i, '')
      .trim() || null;
  }

  _cleanPlatformName(value) {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return null;
    if (source.includes('whatsapp')) return 'whatsapp';
    if (source.includes('phone') || source.includes('mobile')) return 'phone';
    return source.replace(/\s+(?:please|now)$/i, '').trim() || null;
  }

  _extractContactName(text, raw) {
    const messageCommand = this._parseMessageCommand(raw);
    if (messageCommand?.contactName) {
      return messageCommand.contactName;
    }

    const callCommand = this._parseCallCommand(raw);
    if (callCommand?.contactName) {
      return callCommand.contactName;
    }

    return null;
  }

  _extractMessageText(text, raw) {
    const messageCommand = this._parseMessageCommand(raw);
    return messageCommand?.messageText || null;
  }

  _extractPlatform(text, raw) {
    const messageCommand = this._parseMessageCommand(raw);
    if (messageCommand?.platform) {
      return messageCommand.platform;
    }

    const callCommand = this._parseCallCommand(raw);
    if (callCommand?.platform) {
      return callCommand.platform;
    }

    if (/\bwhatsapp\b/i.test(raw)) return 'whatsapp';
    if (/\b(?:phone|mobile)\b/i.test(raw)) return 'phone';
    return null;
  }

  _extractSource(text, raw) {
    const match = raw.match(/\b(?:copy|move|bring)(?:\s+(?:file|folder|directory))?\s+(.+?)(?=\s+(?:to|into)\b|$)/i);
    return match ? cleanEntityName(match[1], { stripTypeWords: true }) : null;
  }

  _extractDestination(text, raw) {
    const toMatch = raw.match(/(?:to|into|in)\s+(.+?)$/i);
    if (toMatch) return cleanEntityName(toMatch[1], { stripTypeWords: true });
    return null;
  }

  _extractOldName(text, raw) {
    const match = raw.match(/rename\s+([^\s]+)/i);
    return match ? match[1].trim() : null;
  }

  _extractNewName(text, raw) {
    const match = raw.match(/rename\s+[^\s]+\s+to\s+(.+)/i);
    return match ? match[1].trim() : null;
  }

  _extractWindowName(text) {
    const source = String(text || '').trim().toLowerCase();
    if (!source) return null;

    const cleaned = source
      .replace(/\b(?:please|kindly)\b/g, ' ')
      .replace(/\b(?:the|this|that)\b/g, ' ')
      .replace(/\b(?:window|app|application|tab)\b/g, ' ')
      .replace(/\b(?:minimize|maximize|fullscreen|close|restore)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || null;
  }

  _extractDuration(raw) {
    const source = String(raw || '');
    const numberWords = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60
    };
    const match = source.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty(?:\s*five)?|sixty)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
    if (!match) return null;

    const wordKey = match[1].toLowerCase().replace(/\s+/g, '');
    const value = /^\d+$/.test(wordKey) ? parseInt(wordKey, 10) : numberWords[wordKey];
    const unit = match[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      return value * 60;
    }
    if (unit.startsWith('second') || unit.startsWith('sec')) {
      return Math.max(1, Math.ceil(value / 60));
    }

    return value;
  }

  _extractReminderCategory(raw) {
    const text = String(raw || '').toLowerCase();
    if (/\b(?:college|collage|school|class|lecture|campus|study|exam|assignment|homework|tuition)\b/.test(text)) return 'education';
    if (/\b(?:water|hydrate|hydration|drink)\b/.test(text)) return 'water';
    if (/\b(?:exercise|workout|gym|walk|run|running|yoga|stretch|fitness)\b/.test(text)) return 'exercise';
    if (/\b(?:medicine|medication|tablet|pill|doctor|appointment|health)\b/.test(text)) return 'health';
    if (/\b(?:work|office|meeting|project|deadline|client|email)\b/.test(text)) return 'work';
    if (/\b(?:birthday|anniversary|celebrate|party)\b/.test(text)) return 'birthday';
    return 'general';
  }

  _extractTimeExpression(text, raw) {
    const source = String(raw || '');
    const normalizeClock = value => String(value || '')
      .trim()
      .replace(/^(\d{1,2})\s+(\d{2})(\s*(?:am|pm)?(?:\s+(?:today|tomorrow))?)$/i, '$1:$2$3')
      .replace(/\s+/g, ' ')
      .trim();

    const dateOnlyReminderMatch = source.match(
      /^(?:remind\s+me|(?:create|add|set)\s+(?:a\s+)?(?:new\s+)?reminder)(?:\s+(?:for|on|at))?\s+(today|tomorrow(?:\s+(?:morning|afternoon|evening|night))?|tonight|next\s+week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i
    );
    if (dateOnlyReminderMatch?.[1]) {
      return normalizeClock(dateOnlyReminderMatch[1].toLowerCase());
    }

    const directReminderTrailingDurationMatch = source.match(
      new RegExp(`^(?:remind|alert|notify)\\s+me\\s+to\\s+.+?\\s+in\\s+(${SCHEDULE_DURATION_PATTERN})$`, 'i')
    );
    if (directReminderTrailingDurationMatch?.[1]) {
      return normalizeClock(directReminderTrailingDurationMatch[1]);
    }

    const reminderMatch = source.match(/\b(?:remind|alert|notify)(?: me)?\s+(?:at|for|in)\s+(.+?)(?:\s+to\s+.+)?$/i);
    if (reminderMatch && reminderMatch[1]) {
      return normalizeClock(reminderMatch[1]);
    }

    const directReminderAfterTextMatch = source.match(/^(?:remind|alert|notify)\s+me\s+to\s+.+?\s+at\s+(.+)$/i);
    if (directReminderAfterTextMatch?.[1]) {
      return normalizeClock(directReminderAfterTextMatch[1]);
    }

    const relativeReminderMatch = source.match(/\b(?:remind|alert|notify)(?: me)?\s+(.+?)\s+to\s+.+$/i);
    if (relativeReminderMatch && relativeReminderMatch[1]) {
      const candidate = relativeReminderMatch[1]
        .replace(/^on\s+/i, '')
        .replace(/\btommorow\b/gi, 'tomorrow')
        .trim();
      if (/\b(?:today|tomorrow|tonight|morning|afternoon|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i.test(candidate)) {
        const afterTo = source.split(/\bto\b/i).slice(1).join(' to ');
        const nestedTimeMatch = afterTo.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
        const nestedTime = nestedTimeMatch?.[1] ? nestedTimeMatch[1].replace(/\s+/g, '') : '';
        return nestedTime ? normalizeClock(`${candidate} ${nestedTime}`) : normalizeClock(candidate);
      }
    }

    const setReminderDurationMatch = source.match(
      new RegExp(`\\bset\\s+(?:a\\s+)?reminder\\s+(?:for|in)\\s+(${SCHEDULE_DURATION_PATTERN})\\b`, 'i')
    );
    if (setReminderDurationMatch?.[1]) {
      return normalizeClock(setReminderDurationMatch[1]);
    }

    const setReminderTimeMatch = source.match(/\bset\s+(?:a\s+)?reminder\s+(?:at|for|in)\s+(\d{1,2}(?:(?::|\s+)\d{2})?\s*(?:am|pm)?(?:\s+(?:today|tomorrow))?)\b/i);
    if (setReminderTimeMatch && setReminderTimeMatch[1]) {
      return normalizeClock(setReminderTimeMatch[1]);
    }

    const alarmMatch = source.match(/\b(?:set alarm for|alarm for|wake me at|set alarm at|set a alarm at|set me alarm at)\s+(.+?)(?=\s+(?:to|and\s+label(?:\s+it)?|label(?:\s+it)?)\s+.+$|$)/i);
    if (alarmMatch && alarmMatch[1]) {
      return normalizeClock(alarmMatch[1]);
    }

    const timerAtMatch = source.match(/\b(?:set\s+(?:a\s+)?timer\s+(?:at|for)|timer\s+at|set\s+me\s+timer\s+at|set\s+a\s+timer\s+at|start\s+(?:a\s+)?timer\s+at|create\s+(?:a\s+)?timer\s+at)\s+(.+?)(?:\s+to\s+.+)?$/i);
    if (timerAtMatch && timerAtMatch[1]) {
      return normalizeClock(timerAtMatch[1]);
    }

    const simpleTimeAtMatch = source.match(/\bat\s+(\d{1,2}(?:(?::|\s+)\d{2})?\s*(?:am|pm)?(?:\s+(?:today|tomorrow))?)\b/i);
    if (simpleTimeAtMatch && simpleTimeAtMatch[1]) {
      return normalizeClock(simpleTimeAtMatch[1]);
    }

    const morningEveningMatch = source.match(/\bin\s+(?:the\s+)?(morning|afternoon|evening|night)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b/i);
    if (morningEveningMatch && morningEveningMatch[1]) {
      const timePart = morningEveningMatch[2] ? ` at ${morningEveningMatch[2]}` : '';
      return morningEveningMatch[1] + timePart;
    }

    return null;
  }

  _extractAlarmLabel(raw) {
    const source = String(raw || '').trim();
    const match = source.match(/\s+(?:to|and\s+label(?:\s+it)?|label(?:\s+it)?)\s+(.+)$/i);
    return match?.[1] ? match[1].trim() : null;
  }

  _extractRecurrence(raw) {
    const source = String(raw || '').toLowerCase();
    if (/\bevery\s+(?:one\s+)?hour\b|\bhourly\b/.test(source)) return 'hourly';
    if (/\bevery\s+(?:two|2)\s+hours?\b/.test(source)) return 'every-2-hours';
    if (/\bevery\s+weekday(?:\s+morning)?\b/.test(source)) return source.includes('morning') ? 'weekday-morning' : 'weekday';
    if (/\bevery\s+(?:day|morning|evening|night)\b|\bdaily\b/.test(source)) {
      if (source.includes('morning')) return 'daily-morning';
      if (source.includes('evening')) return 'daily-evening';
      if (source.includes('night')) return 'daily-night';
      return 'daily';
    }
    if (/\bevery\s+week\b|\bweekly\b/.test(source)) return 'weekly';
    return null;
  }

  _extractReminderText(text, raw) {
    const source = String(raw || '');

    if (/^(?:remind\s+me|(?:create|add|set)\s+(?:a\s+)?(?:new\s+)?reminder)(?:\s+(?:for|on|at))?\s+(?:today|tomorrow(?:\s+(?:morning|afternoon|evening|night))?|tonight|next\s+week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i.test(source.trim())) {
      return null;
    }

    const directRemindMatch = source.match(/^(?:remind|alert|notify)\s+me\s+(?:tomorrow\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+)?to\s+(.+)$/i);
    if (directRemindMatch && directRemindMatch[1]) {
      const cleaned = this._stripReminderScheduleSuffix(directRemindMatch[1]);
      if (cleaned && !/^(?:me|myself|remind|reminder)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    const simpleRemindToMatch = source.match(/^(?:remind|alert|notify)\s+me\s+to\s+(.+)$/i);
    if (simpleRemindToMatch && simpleRemindToMatch[1]) {
      const cleaned = this._stripReminderScheduleSuffix(simpleRemindToMatch[1]);
      if (cleaned && !/^(?:me|myself|remind|reminder)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    const afterToMatch = source.match(/\bto\s+(.+)$/i);
    if (afterToMatch && afterToMatch[1]) {
      const cleaned = this._stripReminderScheduleSuffix(afterToMatch[1]);
      if (cleaned && !/^(?:me|myself|remind|reminder)$/i.test(cleaned) && cleaned.length > 0) {
        return cleaned;
      }
    }

    const reminderMatch = source.match(/\b(?:remind|alert|notify)(?: me)?\s+(?:at|for|in)\s+.+?\s+to\s+(.+)$/i);
    if (reminderMatch && reminderMatch[1]) {
      const cleaned = this._stripReminderScheduleSuffix(reminderMatch[1]);
      if (cleaned && !/^(?:me|myself)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    const forMatch = source.match(/\bset\s+(?:a\s+)?reminder\s+(?:for|at|in)\s+.+?\s+(.+)$/i);
    if (forMatch && forMatch[1]) {
      const cleaned = forMatch[1].trim();
      if (/^[\d:\s]+(?:am|pm)?(?:\s+(?:today|tomorrow))?$/i.test(cleaned)) {
        return null;
      }
      if (cleaned && !/^(?:me|myself)$/i.test(cleaned)) {
        return cleaned;
      }
    }

    return null;
  }

  _stripReminderScheduleSuffix(value) {
    let cleaned = String(value || '').trim();
    if (!cleaned) return null;

    const suffixPatterns = [
      new RegExp(`\\s+\\bin\\s+${SCHEDULE_DURATION_PATTERN}\\s*$`, 'i'),
      new RegExp(`\\s+\\b(?:at|on)\\s+(?:${SCHEDULE_CLOCK_PATTERN}|${SCHEDULE_DAY_PATTERN}|${SCHEDULE_NATURAL_TIME_PATTERN})\\s*$`, 'i'),
      new RegExp(`\\s+\\b(?:today|tomorrow|tonight|next\\s+week)\\s*$`, 'i')
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of suffixPatterns) {
        const next = cleaned.replace(pattern, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          changed = true;
        }
      }
    }

    return cleaned || null;
  }

  _extractPath(text, raw) {
    const match = raw.match(/\b(?:on|in|at|from)\s+(.+?)(?=$|\s+(?:called|named)\b)/i);
    if (!match) return null;

    const cleaned = match[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^(?:the|my)\s+/i, '')
      .replace(/\s+(?:folder|directory|path)$/i, '')
      .trim();
    if (/^(?:vlc|spotify|youtube|apple\s+music|windows\s+media\s+player)$/i.test(cleaned)) {
      return null;
    }

    return cleaned;
  }

  /**
   * Extract the media search query from a play command.
   * Handles: "play X songs", "play X on youtube", "listen to X", "stream X"
   * @param {string} text  - Normalised lowercase text
   * @param {string} raw   - Original casing text
   * @returns {string|null}
   */
  _extractMediaQuery(text, raw) {
    const source = String(raw || '').trim();
    const normalized = String(text || '').trim().toLowerCase();

    if (/\b(next|previous|pause|resume|skip|prev|back)\b/i.test(normalized)) {
      return null;
    }

    const commandMatch = source.match(
      /^(?:play|stream|listen\s+to|watch|queue|put\s+on|start\s+playing)\s+(.+)$/i
    );

    if (!commandMatch || !commandMatch[1]) {
      return null;
    }

    const cleaned = commandMatch[1]
      .replace(/\s+(?:on|in|via)\s+(?:youtube|spotify|soundcloud|gaana|jiosaavn|amazon\s*music|apple\s*music|saavn).*$/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/\b(?:song|songs|music|track|tracks|video|videos)\b/gi, ' ')
      .replace(/\b(?:called|named)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || null;
  }

  /**
   * Extract the streaming platform from a play command.
   * @param {string} text  - Normalised lowercase text
   * @param {string} raw   - Original casing text
   * @returns {string|null}
   */
  _extractMediaPlatform(text, raw) {
    const source = String(raw || '').toLowerCase();

    if (/\byoutube\b/i.test(source) || /\byt\b/i.test(source)) return 'youtube';
    if (/\bspotify\b/i.test(source)) return 'spotify';
    if (/\bsoundcloud\b/i.test(source)) return 'soundcloud';
    if (/\bgaana\b/i.test(source)) return 'gaana';
    if (/\bjiosaavn\b|\bsaavn\b|\bjio\s*music\b/i.test(source)) return 'jiosaavn';
    if (/\bamazon\s*music\b|\bamazon\b/i.test(source)) return 'amazon music';
    if (/\bapple\s*music\b|\bapple\b/i.test(source)) return 'apple music';

    return null;
  }

  _extractModeName(text, raw) {
    const source = String(raw || text || '').trim();
    if (!source) return null;

    const patterns = [
      /\b(?:start|open|launch|run|activate)\s+(?:the\s+)?(.+?)\s+mode\b/i,
      /\b(?:start|open|launch|run|activate)\s+mode\s+(.+)$/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match[1]) {
        const cleaned = this._stripTrailingEntityNoise(match[1])
          .replace(/\bmode\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return cleaned || null;
      }
    }

    return null;
  }
}

module.exports = EntityExtractor;
module.exports.APP_ALIASES = APP_ALIASES;
module.exports.FOLDER_ALIASES = FOLDER_ALIASES;
