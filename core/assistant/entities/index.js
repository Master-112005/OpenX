const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;
const Validator = require('../../shared/index').Validator;
const { cleanEntityName } = require('../../automation/common/path-utils');

const APP_ALIASES = {
  'vscode': 'code',
  'visual studio code': 'code',
  'vs code': 'code',
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
  'spotify': 'spotify',
  'discord': 'discord',
  'google chat': 'google chat',
  'whatsapp': 'whatsapp',
  'slack': 'slack',
  'zoom': 'zoom',
  'teams': 'teams',
  'microsoft teams': 'teams',
  'apple music': 'apple music',
  'apple tv': 'apple tv',
  'youtube': 'youtube',
  'recycle bin': 'recycle bin',
  'microsoft store': 'microsoft store',
  'store': 'microsoft store',
  'photos': 'photos',
  'microsoft photos': 'photos',
  'calendar': 'calendar',
  'clock': 'clock',
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

class EntityExtractor {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
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
      /\b(?:create|new|make)\s+file\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:delete|remove|erase)\s+file\s+(.+?)(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:delete|remove|erase)\s+(.+?)\s+file(?=\s+(?:on|in|at|to|from)\b|$)/i,
      /\b(?:delete|remove|erase)\s+(.+?)(?=\s+(?:on|in|at|from)\b|$)/i,
      /\b(?:open|show)\s+(?:file\s+)?(.+?)(?=\s+(?:on|in|at|from)\b|$)/i,
      /\b(?:rename|copy|move)\s+file\s+(.+?)(?=\s+(?:to|into|in|on|from)\b|$)/i
    ];

    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match && match[1]) {
        return cleanEntityName(match[1]);
      }
    }

    const explicitFile = raw.match(/(?:^|[\s"])([^\s"\\/]+\.[A-Za-z0-9]{1,10})(?=$|[\s"])/);
    if (explicitFile) {
      return cleanEntityName(explicitFile[1]);
    }

    return null;
  }

  _extractFolderName(text, raw) {
    const patterns = [
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
    const patterns = ['search for ', 'search web ', 'search ', 'look up ', 'google ', 'find file ', 'search file ', 'look for file ', 'find '];
    for (const p of patterns) {
      if (text.includes(p)) {
        const after = raw.split(new RegExp(p, 'i'))[1];
        if (after && after.trim()) {
          return after.trim();
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
        regex: /^(?:say|send)\s+(.+?)\s+to\s+(.+?)(?:\s+(?:on|via|using)\s+(.+))?$/i,
        map: match => ({
          messageText: match[1],
          contactName: match[2],
          platform: match[3]
        })
      },
      {
        regex: /^(?:ask|tell|message|text|msg|massage)\s+(.+?)(?:\s+(?:on|via|using)\s+(.+?))?\s+to\s+(.+)$/i,
        map: match => ({
          contactName: match[1],
          platform: match[2],
          messageText: match[3]
        })
      },
      {
        regex: /^(?:send(?:\s+a)?\s+(?:message|text))\s+to\s+(.+?)(?:\s+(?:on|via|using)\s+(.+?))?\s+(?:saying|that)\s+(.+)$/i,
        map: match => ({
          contactName: match[1],
          platform: match[2],
          messageText: match[3]
        })
      },
      {
        regex: /^(?:message|text)\s+(.+?)(?:\s+(?:on|via|using)\s+(.+?))?\s+(?:saying|that)\s+(.+)$/i,
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
    const match = raw.match(/\b(?:copy|move)(?:\s+(?:file|folder|directory))?\s+(.+?)(?=\s+(?:to|into)\b|$)/i);
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
    const match = String(raw || '').match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr')) {
      return value * 60;
    }
    if (unit.startsWith('second') || unit.startsWith('sec')) {
      return Math.max(1, Math.ceil(value / 60));
    }

    return value;
  }

  _extractTimeExpression(text, raw) {
    const source = String(raw || '');

    const reminderMatch = source.match(/\bremind(?: me)?\s+(?:at|for|in)\s+(.+?)(?:\s+to\s+.+)?$/i);
    if (reminderMatch && reminderMatch[1]) {
      return reminderMatch[1].trim();
    }

    const alarmMatch = source.match(/\b(?:set alarm for|alarm for|wake me at)\s+(.+)$/i);
    if (alarmMatch && alarmMatch[1]) {
      return alarmMatch[1].trim();
    }

    return null;
  }

  _extractReminderText(text, raw) {
    const source = String(raw || '');
    const toMatch = source.match(/\bto\s+(.+)$/i);
    if (toMatch && toMatch[1]) {
      return toMatch[1].trim();
    }

    const forMatch = source.match(/\bset reminder for\s+.+?\s+(.+)$/i);
    if (forMatch && forMatch[1]) {
      return forMatch[1].trim();
    }

    return null;
  }

  _extractPath(text, raw) {
    const match = raw.match(/\b(?:on|in|at|from)\s+(.+?)(?=$|\s+(?:called|named)\b)/i);
    if (!match) return null;

    return match[1]
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^(?:the|my)\s+/i, '')
      .replace(/\s+(?:folder|directory|path)$/i, '')
      .trim();
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
