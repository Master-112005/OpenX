const Normalizer = require('../Data').Normalizer;
const EntityExtractor = require('../entities');
const {
  DOMAIN_VOCABULARY,
  FILLER_WORDS,
  TOKEN_CORRECTIONS
} = require('./preprocessor');
const {
  buildBigrams,
  preprocessCommand
} = require('./preprocessor');
const {
  scorePreparedPattern
} = require('./scorer');
const { normalizeWebTarget } = require('./web-targets');
const { parseLearningDirective } = require('../active-learning/LearningLanguage');
const { analyzeDiscourse } = require('../language');

const PREPARE_CACHE_LIMIT = 256;
const PATTERN_CACHE_LIMIT = 512;

class NlpProcessor {
  constructor(intentRegistry) {
    this.intentRegistry = intentRegistry;
    this.vocabulary = this._buildVocabulary();
    this.vocabularySet = new Set(this.vocabulary);
    this.prepareCache = new Map();
    this.patternCache = new Map();
    this.preparedIntentPatterns = [];
    this.preparedIntentRevision = null;
  }

  _rememberCacheEntry(cache, key, value, limit) {
    if (cache.has(key)) {
      cache.delete(key);
    }
    cache.set(key, value);
    while (cache.size > limit) {
      cache.delete(cache.keys().next().value);
    }
    return value;
  }

  _clonePrepared(prepared) {
    return {
      ...prepared,
      query: prepared.query ? { ...prepared.query, clauses: [...(prepared.query.clauses || [])] } : prepared.query,
      semanticFrame: prepared.semanticFrame ? { ...prepared.semanticFrame } : prepared.semanticFrame,
      discourse: prepared.discourse ? {
        ...prepared.discourse,
        references: [...(prepared.discourse.references || [])]
      } : prepared.discourse,
      tokens: [...(prepared.tokens || [])],
      intentTokens: [...(prepared.intentTokens || [])],
      bigrams: [...(prepared.bigrams || [])],
      intentBigrams: [...(prepared.intentBigrams || [])]
    };
  }

  _buildVocabulary() {
    const tokens = new Set(DOMAIN_VOCABULARY);
    const aliasBuckets = [
      EntityExtractor.APP_ALIASES || {},
      EntityExtractor.FOLDER_ALIASES || {}
    ];
    const intents = this.intentRegistry?.getAll?.() || [];

    aliasBuckets.forEach(bucket => {
      Object.keys(bucket).forEach(alias => {
        Normalizer.tokenize(alias).forEach(token => tokens.add(token));
      });
      Object.values(bucket).forEach(alias => {
        Normalizer.tokenize(alias).forEach(token => tokens.add(token));
      });
    });

    intents.forEach(intent => {
      [intent.id, intent.action, intent.description, ...(intent.patterns || [])]
        .filter(Boolean)
        .forEach(entry => {
          Normalizer.tokenize(entry).forEach(token => tokens.add(token));
        });
    });

    Object.keys(TOKEN_CORRECTIONS).forEach(token => tokens.add(token));
    Object.values(TOKEN_CORRECTIONS).forEach(token => tokens.add(token));

    return Array.from(tokens);
  }

  _correctToken(token) {
    if (TOKEN_CORRECTIONS[token]) {
      return TOKEN_CORRECTIONS[token];
    }

    if (!token || token.length <= 2 || /^\d+$/.test(token)) {
      return token;
    }

    const match = Normalizer.findClosestOption(token, this.vocabulary, {
      minSimilarity: token.length >= 6 ? 0.64 : 0.74,
      maxDistance: token.length >= 7 ? 2 : 1
    });

    return match ? match.normalizedMatch : token;
  }

  prepare(text) {
    const key = String(text || '');
    const cached = this.prepareCache.get(key);
    if (cached) {
      this.prepareCache.delete(key);
      this.prepareCache.set(key, cached);
      return this._clonePrepared(cached);
    }

    const prepared = this._prepareUncached(key);
    this._rememberCacheEntry(this.prepareCache, key, prepared, PREPARE_CACHE_LIMIT);
    return this._clonePrepared(prepared);
  }

  preparePattern(pattern) {
    const key = String(pattern || '');
    const cached = this.patternCache.get(key);
    if (cached) {
      return cached;
    }

    const prepared = this._prepareUncached(key);
    return this._rememberCacheEntry(this.patternCache, key, prepared, PATTERN_CACHE_LIMIT);
  }

  getPreparedIntentPatterns() {
    const revision = this.intentRegistry?.getRevision?.() || 0;
    if (this.preparedIntentRevision === revision && this.preparedIntentPatterns.length > 0) {
      return this.preparedIntentPatterns;
    }

    this.preparedIntentPatterns = (this.intentRegistry?.getAll?.() || []).flatMap(intent => (
      (intent.patterns || []).map(pattern => {
        const prepared = this.preparePattern(pattern);
        const normalized = (prepared.intentText || prepared.correctedText || '').trim();
        return {
          intent,
          pattern,
          prepared,
          normalized,
          length: String(pattern || '').length
        };
      })
    ));
    this.preparedIntentRevision = revision;
    return this.preparedIntentPatterns;
  }

  _prepareUncached(text) {
    const preprocessed = preprocessCommand(text || '');
    const normalized = preprocessed.normalizedText;
    const normalizedTokens = preprocessed.tokens;
    const correctedTokens = normalizedTokens.map(token => this._correctToken(token));
    const correctedText = correctedTokens.join(' ').trim();
    const intentTokens = correctedTokens.filter(token => !FILLER_WORDS.has(token));
    const intentText = intentTokens.join(' ').trim();
    const repairedCommandText = this._repairNoisyCommandText(correctedTokens);
    const commandText = repairedCommandText || correctedText;
    const query = this._understandQuery(correctedTokens, correctedText, text || '');
    const semanticFrame = this._buildSemanticFrame(correctedTokens, correctedText, text || '');
    const noiseTokenCount = this._countNoiseTokens(correctedTokens);
    const actionTokenCount = this._countActionTokens(correctedTokens);
    const repairContextTokenCount = this._countRepairContextTokens(correctedTokens);
    const bigrams = buildBigrams(correctedTokens);
    const intentBigrams = buildBigrams(intentTokens);
    const learningDirective = parseLearningDirective(text);
    const discourse = analyzeDiscourse(text);

    return {
      normalizedText: normalized,
      correctedText,
      commandText,
      repairedCommandText,
      query,
      semanticFrame,
      noiseTokenCount,
      actionTokenCount,
      repairContextTokenCount,
      intentText,
      tokens: correctedTokens,
      intentTokens,
      learningDirective,
      discourse,
      bigrams,
      intentBigrams
    };
  }

  _buildSemanticFrame(tokens, correctedText, rawText) {
    const safeTokens = Array.isArray(tokens) ? tokens : [];
    const text = String(correctedText || '').trim().toLowerCase();
    const raw = String(rawText || '').trim().toLowerCase();
    const action = this._findNoisyAction(safeTokens);
    const value = Normalizer.extractNumber(text);
    const questionWord = safeTokens.find(token => ['what', 'who', 'when', 'where', 'why', 'how', 'which'].includes(token)) || null;
    const targetText = action
      ? this._extractTargetTextAfterAction(text, action.verb)
      : this._extractQuestionTargetText(text, questionWord);
    const normalizedTargetText = this._normalizeTargetText(targetText, action?.verb || null);
    const localScope = this._findLocalScope(text, raw);
    const webTarget = normalizeWebTarget(normalizedTargetText || text);
    const domain = this._inferDomain({
      actionVerb: action?.verb || null,
      correctedText: text,
      targetText: normalizedTargetText,
      localScope,
      webTarget,
      value
    });
    const targetType = this._classifyTargetType({
      actionVerb: action?.verb || null,
      correctedText: text,
      rawText: raw,
      targetText: normalizedTargetText,
      webTarget,
      localScope
    });

    return {
      actionVerb: action?.verb || null,
      questionWord,
      targetText: normalizedTargetText,
      targetType,
      webTarget,
      domain,
      value,
      localScope,
      requiresWeb: targetType === 'web' || targetType === 'knowledge',
      isLocal: targetType === 'local-file' || targetType === 'local-app'
    };
  }

  _extractTargetTextAfterAction(text, actionVerb) {
    const pattern = new RegExp(`^(?:search\\s+for|look\\s+up|go\\s+to|show\\s+me|${actionVerb}|launch|start|run|show|google|find)\\s+`, 'i');
    return String(text || '')
      .replace(pattern, '')
      .replace(/^(?:make|put|keep|change|adjust|configure)\s+/, '')
      .replace(/\b(?:bigger|larger|smaller|hidden|hide|minimized|maximized|fullscreen|full\s+screen)\b/gi, ' ')
      .replace(/\b(?:level|percent|percentage)\b/gi, ' ')
      .replace(/\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)\s*$/i, '')
      .replace(/\s+(?:on|in)\s+(?:my\s+)?(?:laptop|pc|computer|system|device|windows)\s*$/i, '')
      .trim();
  }

  _extractQuestionTargetText(text, questionWord) {
    if (!questionWord) {
      return '';
    }
    return String(text || '')
      .replace(/^(?:what|who|when|where|why|how|which)\s+(?:is|are|was|were|won|did|does|do)?\s*/i, '')
      .trim();
  }

  _findLocalScope(text, rawText) {
    const combined = `${text || ''} ${rawText || ''}`.toLowerCase();
    if (/\b(?:on|in)\s+(?:my\s+)?(?:laptop|pc|computer|system|device|windows)\b|\b(?:local|offline|this\s+(?:laptop|pc|computer|system|device))\b/.test(combined)) {
      return 'device';
    }
    const location = this._findLocalLocation(Normalizer.tokenize(combined));
    return location || null;
  }

  _normalizeTargetText(value, actionVerb = null) {
    let target = String(value || '').trim();
    if (!target) {
      return '';
    }

    target = target
      .replace(/^(?:the|a|an|my|this|that|current)\s+/i, '')
      .replace(/\b(?:app|application|program|window|tab|level|percent|percentage|only|itself)\b/gi, ' ')
      .replace(/\b(?:to|at|as|on)\s+\d{1,3}\s*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (['increase', 'decrease', 'mute', 'unmute', 'set'].includes(actionVerb) &&
      /\b(?:volume|sound|audio|brightness|screen)\b/i.test(target)) {
      const utility = this._findKnownUtilityTarget(Normalizer.tokenize(target));
      return utility || target;
    }

    return target;
  }

  _inferDomain({ actionVerb, correctedText, targetText, localScope, webTarget, value }) {
    const combined = `${correctedText || ''} ${targetText || ''}`.toLowerCase();
    if (actionVerb === 'open' && /\bnew\s+(?:chrome\s+)?tab\b/.test(combined)) {
      return 'browser-tab';
    }
    if (/\b(?:volume|sound|audio)\b/.test(combined)) {
      return 'volume';
    }
    if (/\b(?:brightness|screen)\b/.test(combined) && Number.isFinite(value)) {
      return 'brightness';
    }
    if (/\b(?:window|fullscreen|maximize|minimize|bigger|larger|smaller|hide|hidden)\b/.test(combined) ||
      ['maximize', 'minimize'].includes(actionVerb)) {
      return 'window';
    }
    if (
      /\b(?:send|share|transfer|copy|export|push|move)\b/.test(combined) &&
      /\b(?:phone|mobile|iphone|android|device|smartphone|cell|cellphone|tablet|handset)\b/.test(combined) &&
      /\b(?:file|files|folder|folders|directory|directories|desktop|downloads|documents|pictures|pdf|pdfs|image|images|photo|photos|picture|pictures|screenshot|screenshots|video|videos|audio|music|zip|rar|csv|json)\b|[^\s]+\.[a-z0-9]{1,10}\b/i.test(combined)
    ) {
      return 'phone-transfer';
    }
    if (
      /\b(?:audio|media|movie|music|playback|playlist|player|song|songs|track|tracks|video|videos|youtube|spotify|vlc)\b/.test(combined) &&
      ['play', 'pause', 'resume', 'stop', 'next', 'previous', 'mute', 'unmute', 'increase', 'decrease'].includes(actionVerb)
    ) {
      return 'media';
    }
    if (/\b(?:file|files|folder|folders|directory|directories|desktop|downloads|documents|pictures|pdf|pdfs|image|images|photo|photos)\b/.test(combined) || localScope) {
      return 'local-file';
    }
    if (webTarget || /\b(?:website|site|web|internet|online)\b/.test(combined)) {
      return 'web';
    }
    if (['open', 'close', 'switch', 'focus', 'launch', 'start', 'run'].includes(actionVerb) && targetText) {
      return 'app';
    }
    return 'unknown';
  }

  _classifyTargetType({ actionVerb, correctedText, rawText, targetText, webTarget, localScope }) {
    const combined = `${correctedText || ''} ${rawText || ''}`.toLowerCase();
    const target = String(targetText || '').toLowerCase();

    if (actionVerb === 'open' && /\bnew\s+(?:chrome\s+)?tab\b/.test(combined)) {
      return 'browser-tab';
    }

    if (
      /\b(?:send|share|transfer|copy|export|push|move)\b/.test(combined) &&
      /\b(?:phone|mobile|iphone|android|device|smartphone|cell|cellphone|tablet|handset)\b/.test(combined) &&
      /\b(?:file|folder|directory|desktop|downloads|documents|pictures|music|videos|image|photo|picture|screenshot|zip|rar|csv|json)\b|[^\s]+\.[a-z0-9]{1,10}\b/i.test(combined)
    ) {
      return 'phone-transfer';
    }
    if (
      /\b(?:audio|media|movie|music|playback|playlist|player|song|songs|track|tracks|video|videos|youtube|spotify|vlc)\b/.test(combined) &&
      ['play', 'pause', 'resume', 'stop', 'next', 'previous', 'mute', 'unmute', 'increase', 'decrease'].includes(actionVerb)
    ) {
      return 'media';
    }
    if (/\b(?:file|folder|directory|desktop|downloads|documents|pictures|music|videos)\b|[^\s]+\.[a-z0-9]{1,10}\b/i.test(combined)) {
      return 'local-file';
    }

    if (localScope) {
      return 'local-app';
    }

    if (['maximize', 'minimize'].includes(actionVerb)) {
      return 'local-app';
    }

    if (webTarget) {
      return 'web';
    }

    if (/^(?:search|google)$/.test(actionVerb || '') || /\b(?:web|internet|online|browser|chrome|edge|firefox)\b/.test(combined)) {
      return 'web';
    }

    if (/\b(?:news|score|winner|champion|event|release|price|schedule|fixtures?|match(?:es)?|best|top)\b/.test(combined)) {
      return 'knowledge';
    }

    if (['open', 'launch', 'start', 'run', 'close', 'switch'].includes(actionVerb) && target) {
      return 'local-app';
    }

    return 'unknown';
  }

  _understandQuery(tokens, correctedText, rawText) {
    const safeTokens = Array.isArray(tokens) ? tokens : [];
    const text = String(correctedText || '').trim().toLowerCase();
    const raw = String(rawText || '').trim();
    const questionWord = safeTokens.find(token => ['what', 'who', 'when', 'where', 'why', 'how', 'which'].includes(token)) || null;
    const action = this._findNoisyAction(safeTokens);
    const localLocation = this._findLocalLocation(safeTokens);
    const requestedFileType = this._findRequestedFileType(safeTokens);
    const isQuestion = Boolean(questionWord) || /^(?:what|who|when|where|why|how|which)\b/i.test(raw);
    const isLocalFileQuestion = Boolean(localLocation) &&
      /\b(?:file|files|folder|folders|items|contents|pdf|pdfs|documents?)\b/i.test(text) &&
      /^(?:what|which|show|list|tell)\b/i.test(text);
    const isKnowledgeQuestion = isQuestion && !isLocalFileQuestion &&
      !/\b(?:time|date|day)\b/i.test(text);
    const clauses = text
      .split(/\s+\band\b\s+|\s*;\s*/i)
      .map(clause => clause.trim())
      .filter(Boolean);

    let type = 'unknown';
    if (action?.verb) {
      type = 'action';
    }
    if (isQuestion) {
      type = isKnowledgeQuestion ? 'knowledge-question' : 'local-question';
    }
    if (isLocalFileQuestion) {
      type = 'local-file-question';
    }

    return {
      type,
      questionWord,
      actionVerb: action?.verb || null,
      localLocation,
      requestedFileType,
      isQuestion,
      isKnowledgeQuestion,
      isLocalFileQuestion,
      clauses
    };
  }

  _findLocalLocation(tokens) {
    const folders = Object.keys(EntityExtractor.FOLDER_ALIASES || {});
    for (const token of tokens || []) {
      if (folders.includes(token)) {
        return EntityExtractor.FOLDER_ALIASES[token];
      }
      const match = Normalizer.findClosestOption(token, folders, {
        minSimilarity: 0.68,
        maxDistance: 2
      });
      if (match) {
        return EntityExtractor.FOLDER_ALIASES[match.normalizedMatch];
      }
    }
    return null;
  }

  _findRequestedFileType(tokens) {
    const joined = (tokens || []).join(' ');
    if (/\bpdfs?\b/i.test(joined)) return 'pdf';
    if (/\bimages?\b|\bphotos?\b|\bpictures?\b/i.test(joined)) return 'image';
    if (/\bvideos?\b/i.test(joined)) return 'video';
    if (/\baudio\b|\bmusic\b|\bsongs?\b/i.test(joined)) return 'audio';
    return null;
  }

  scorePattern(preparedInput, pattern) {
    const patternPrepared = typeof pattern === 'string' ? this.preparePattern(pattern) : pattern;
    return scorePreparedPattern(preparedInput, patternPrepared);
  }

  _repairNoisyCommandText(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return '';
    }

    const action = this._findNoisyAction(tokens);
    if (!action) {
      return '';
    }

    if (['open', 'close', 'switch'].includes(action.verb)) {
      const target = this._findKnownPlaceOrApp(tokens, action.index);
      if (target) {
        return `${action.verb} ${target}`;
      }
    }

    if (['maximize', 'minimize'].includes(action.verb)) {
      const target = this._findKnownPlaceOrApp(tokens, action.index) || this._buildCommandTail(tokens, action.index, action.verb)
        .replace(new RegExp(`^${action.verb}\\s+`, 'i'), '')
        .trim();
      if (target) {
        return `${action.verb} ${target}`;
      }
    }

    if (['increase', 'decrease', 'mute', 'unmute'].includes(action.verb)) {
      const target = this._findKnownUtilityTarget(tokens);
      if (target) {
        return `${action.verb} ${target}`;
      }
    }

    if (['search', 'play', 'pause', 'resume', 'stop', 'set', 'remind'].includes(action.verb)) {
      return this._buildCommandTail(tokens, action.index, action.verb);
    }

    return '';
  }

  _findNoisyAction(tokens) {
    const protectedQueryTokens = new Set([
      'fifa',
      'world',
      'cup',
      'match',
      'matches',
      'fixture',
      'fixtures',
      'schedule',
      'release',
      'premiere',
      'price',
      'iphone',
      'movie',
      'movies',
      'docker',
      'kubernetes',
      'devops',
      'java',
      'sql',
      'podcast',
      'technology',
      'interview',
      'finance',
      'stock',
      'gold',
      'rupees'
    ]);
    const groups = [
      { verb: 'open', words: ['open', 'launch', 'start', 'run', 'show', 'play'] },
      { verb: 'close', words: ['close', 'quit', 'exit', 'terminate', 'shutdown'] },
      { verb: 'switch', words: ['switch', 'focus', 'activate', 'goto', 'go'] },
      { verb: 'increase', words: ['increase', 'raise', 'up', 'louder', 'higher', 'boost', 'add'] },
      { verb: 'decrease', words: ['decrease', 'lower', 'down', 'quieter', 'reduce', 'minus'] },
      { verb: 'mute', words: ['mute', 'silence', 'silent'] },
      { verb: 'unmute', words: ['unmute', 'un-silence'] },
      { verb: 'search', words: ['search', 'google', 'find', 'lookup', 'look', 'locate', 'get', 'fetch'] },
      { verb: 'play', words: ['play', 'stream', 'watch', 'queue', 'listen'] },
      { verb: 'pause', words: ['pause', 'hold'] },
      { verb: 'resume', words: ['resume', 'continue', 'unpause', 'proceed', 'carry', 'carryon'] },
      { verb: 'stop', words: ['stop', 'end', 'terminate', 'cease'] },
      { verb: 'set', words: ['set', 'change', 'adjust', 'configure'] },
      { verb: 'remind', words: ['remind', 'alert', 'notify'] },
      { verb: 'delete', words: ['delete', 'remove', 'trash', 'discard', 'erase', 'eliminate'] },
      { verb: 'create', words: ['create', 'make', 'new', 'add', 'generate', 'build'] },
      { verb: 'send', words: ['send', 'share', 'deliver', 'dispatch', 'mail', 'post'] },
      { verb: 'call', words: ['call', 'phone', 'dial', 'ring', 'contact'] },
      { verb: 'message', words: ['message', 'text', 'sms', 'whatsapp', 'chat'] },
      { verb: 'remember', words: ['remember', 'note', 'memorize', 'recall', 'store', 'save', 'keep'] },
      { verb: 'forget', words: ['forget', 'ignore', 'clear', 'delete', 'remove'] },
      { verb: 'maximize', words: ['maximize', 'fullscreen', 'expand', 'enlarge', 'bigger', 'grow'] },
      { verb: 'minimize', words: ['minimize', 'shrink', 'smaller', 'collapse', 'hide'] }
    ];

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (protectedQueryTokens.has(token)) {
        continue;
      }

      for (const group of groups) {
        if (group.words.includes(token)) {
          return { verb: group.verb, index };
        }
      }

      for (const group of groups) {
        if (!token || token.length <= 2) {
          continue;
        }

        const match = Normalizer.findClosestOption(token, group.words, {
          minSimilarity: token.length >= 5 ? 0.74 : 0.78,
          maxDistance: 1
        });
        if (match && Math.abs(String(match.normalizedMatch || '').length - token.length) <= 1) {
          return { verb: group.verb, index };
        }
      }
    }

    return null;
  }

  _buildCommandTail(tokens, actionIndex, verb) {
    const tail = tokens.slice(actionIndex);
    if (tail.length === 0) {
      return '';
    }

    const cleaned = tail.filter((token, index) => {
      if (!token) {
        return false;
      }
      if (index === 0) {
        return true;
      }
      if (['uh', 'um', 'please', 'ok', 'okay', 'sir', 'assistant', 'openx', 'jarvis'].includes(token)) {
        return false;
      }
      return true;
    });

    if (cleaned.length === 0) {
      return '';
    }

    if (verb === 'search' && cleaned[0] === 'find' && !cleaned.includes('file')) {
      cleaned[0] = 'search';
    }

    if (verb === 'search' && cleaned[0] === 'lookup') {
      cleaned.splice(0, 1, 'look', 'up');
    }

    if (verb === 'remind' && cleaned[0] === 'remind' && cleaned[1] !== 'me') {
      cleaned.splice(1, 0, 'me');
    }

    return cleaned.join(' ').trim();
  }

  _findKnownPlaceOrApp(tokens, actionIndex) {
    const aliases = {
      ...(EntityExtractor.APP_ALIASES || {}),
      ...(EntityExtractor.FOLDER_ALIASES || {})
    };
    const aliasKeys = Object.keys(aliases);
    const maxWindowSize = aliasKeys.reduce((max, alias) => {
      return Math.max(max, Normalizer.tokenize(alias).length);
    }, 1);
    const searchOrder = [
      tokens.slice(actionIndex + 1),
      tokens.slice(0, actionIndex)
    ];

    for (const segment of searchOrder) {
      for (let windowSize = maxWindowSize; windowSize >= 1; windowSize -= 1) {
        for (let index = 0; index <= segment.length - windowSize; index += 1) {
          const candidate = segment.slice(index, index + windowSize).join(' ').trim();
          if (!candidate) {
            continue;
          }
          const direct = aliases[candidate];
          if (direct) {
            return candidate;
          }
          const match = Normalizer.findClosestOption(candidate, aliasKeys, {
            minSimilarity: 0.64,
            maxDistance: candidate.length >= 7 ? 2 : 1
          });
          if (match) {
            return match.normalizedMatch;
          }
        }
      }
    }

    return '';
  }

  _findKnownUtilityTarget(tokens) {
    const utilityTargets = ['volume', 'brightness'];
    for (const token of tokens) {
      if (utilityTargets.includes(token)) {
        return token;
      }
      const match = Normalizer.findClosestOption(token, utilityTargets, {
        minSimilarity: 0.68,
        maxDistance: 2
      });
      if (match) {
        return match.normalizedMatch;
      }
    }
    return '';
  }

  _countNoiseTokens(tokens) {
    if (!Array.isArray(tokens)) {
      return 0;
    }

    return tokens.filter(token => {
      if (!token || FILLER_WORDS.has(token) || /^\d+$/.test(token)) {
        return false;
      }
      if (this.vocabularySet.has(token)) {
        return false;
      }
      if (/\./.test(token)) {
        return false;
      }
      return true;
    }).length;
  }

  _countActionTokens(tokens) {
    if (!Array.isArray(tokens)) {
      return 0;
    }

    const actionWords = new Set([
      'activate',
      'add',
      'adjust',
      'boost',
      'build',
      'call',
      'carry',
      'carryon',
      'cease',
      'change',
      'chat',
      'close',
      'configure',
      'continue',
      'create',
      'decrease',
      'delete',
      'deliver',
      'dispatch',
      'dial',
      'eliminate',
      'end',
      'enlarge',
      'erase',
      'exit',
      'expand',
      'fetch',
      'find',
      'focus',
      'generate',
      'get',
      'go',
      'goto',
      'grow',
      'hide',
      'hold',
      'ignore',
      'increase',
      'launch',
      'learn',
      'listen',
      'locate',
      'look',
      'lookup',
      'lower',
      'mail',
      'make',
      'maximize',
      'message',
      'minimize',
      'memorize',
      'modify',
      'mute',
      'new',
      'notify',
      'open',
      'pause',
      'phone',
      'play',
      'proceed',
      'queue',
      'quit',
      'raise',
      'recall',
      'reduce',
      'remember',
      'remove',
      'rename',
      'ring',
      'run',
      'save',
      'search',
      'send',
      'set',
      'share',
      'show',
      'shutdown',
      'silence',
      'sms',
      'start',
      'stop',
      'stream',
      'switch',
      'tell',
      'terminate',
      'text',
      'trash',
      'unmute',
      'watch',
      'whatsapp'
    ]);

    return tokens.filter(token => actionWords.has(token)).length;
  }

  _countRepairContextTokens(tokens) {
    const action = this._findNoisyAction(tokens);
    if (!action || action.index <= 0) {
      return 0;
    }

    return tokens.slice(0, action.index).filter(Boolean).length;
  }
}

module.exports = NlpProcessor;
