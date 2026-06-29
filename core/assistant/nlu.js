const { Normalizer } = require('./Data');
const EntityExtractor = require('./entities');
const { FILLER_WORDS } = require('./nlp/preprocessor');
const { parseLearningDirective } = require('./active-learning/LearningLanguage');
const { analyzeDiscourse } = require('./ContextLanguage');
const { buildWordRelations } = require('./language-relations');

const CONNECTOR_PATTERN = /\s*(?:;|,|\b(?:and then|then|after that|afterwards|and|also|plus|additionally|furthermore)\b)\s*/i;

const ACTION_ALIASES = new Map([
  ['add', 'set'],
  ['activate', 'switch'],
  ['adjust', 'set'],
  ['boost', 'increase'],
  ['close', 'close'],
  ['continue', 'resume'],
  ['decrease', 'decrease'],
  ['dim', 'decrease'],
  ['down', 'decrease'],
  ['end', 'stop'],
  ['exit', 'close'],
  ['find', 'search'],
  ['focus', 'switch'],
  ['fullscreen', 'maximize'],
  ['go', 'open'],
  ['goto', 'open'],
  ['hide', 'minimize'],
  ['increase', 'increase'],
  ['launch', 'open'],
  ['listen', 'play'],
  ['locate', 'search'],
  ['look', 'search'],
  ['lower', 'decrease'],
  ['maximize', 'maximize'],
  ['minimize', 'minimize'],
  ['mute', 'mute'],
  ['next', 'next'],
  ['open', 'open'],
  ['pause', 'pause'],
  ['play', 'play'],
  ['previous', 'previous'],
  ['quit', 'close'],
  ['raise', 'increase'],
  ['alert', 'remind'],
  ['resume', 'resume'],
  ['remind', 'remind'],
  ['notify', 'remind'],
  ['run', 'open'],
  ['search', 'search'],
  ['send', 'send'],
  ['set', 'set'],
  ['show', 'show'],
  ['share', 'send'],
  ['skip', 'next'],
  ['start', 'open'],
  ['stop', 'stop'],
  ['stream', 'play'],
  ['switch', 'switch'],
  ['terminate', 'close'],
  ['transfer', 'send'],
  ['turn', 'set'],
  ['unmute', 'unmute'],
  ['unpause', 'resume'],
  ['up', 'increase'],
  ['watch', 'play']
]);

const DOMAIN_TERMS = {
  media: new Set(['audio', 'media', 'movie', 'music', 'playback', 'playlist', 'player', 'song', 'songs', 'track', 'tracks', 'video', 'videos']),
  mediaPlatform: new Set(['youtube', 'spotify', 'vlc', 'soundcloud', 'gaana', 'jiosaavn']),
  volume: new Set(['audio', 'sound', 'volume']),
  brightness: new Set(['brightness', 'display', 'light', 'screen']),
  window: new Set(['fullscreen', 'maximize', 'minimize', 'screen', 'tab', 'window']),
  file: new Set(['directory', 'document', 'documents', 'file', 'files', 'folder', 'folders', 'pdf', 'photo', 'photos', 'picture', 'pictures']),
  phoneTransfer: new Set(['android', 'device', 'iphone', 'mobile', 'phone']),
  web: new Set(['browser', 'chrome', 'edge', 'firefox', 'google', 'internet', 'site', 'website', 'web', 'youtube']),
  schedule: new Set(['alarm', 'alarms', 'alert', 'clock', 'notify', 'remind', 'reminder', 'reminders', 'timer', 'timers'])
};

const PREPOSITIONS = new Set(['at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'onto', 'to', 'with', 'using', 'via']);
const APP_CUES = new Set(['app', 'application', 'program', 'process']);

class NaturalLanguageRouter {
  constructor({ intentRegistry, entityExtractor, nlp } = {}) {
    this.intentRegistry = intentRegistry || null;
    this.entityExtractor = entityExtractor || new EntityExtractor();
    this.nlp = nlp || null;
    this.appAliases = EntityExtractor.APP_ALIASES || {};
  }

  parse(rawText, preparedInput = {}) {
    const raw = String(rawText || '').trim();
    const corrected = String(preparedInput?.correctedText || raw).trim();
    const clauses = this._splitClauses(raw, corrected);
    const frames = clauses.map((clause, index) => this._parseClause(clause, index));
    const executableFrames = frames.filter(frame => frame.validation.status === 'passed' && frame.intentId);
    const discourse = preparedInput?.discourse || analyzeDiscourse(rawText);
    const tokens = Normalizer.tokenize(corrected || raw);

    return {
      version: 'semantic-frame-v1',
      rawText: raw,
      correctedText: corrected,
      multiIntent: frames.length > 1,
      clauses,
      relations: buildWordRelations(tokens),
      frames,
      discourse,
      validation: {
        status: executableFrames.length > 0 ? 'passed' : 'unknown',
        reason: executableFrames.length > 0
          ? `${executableFrames.length} executable frame${executableFrames.length === 1 ? '' : 's'} parsed`
          : 'No executable semantic frame found'
      }
    };
  }

  resolveIntent(rawText, preparedInput = {}) {
    const semanticParse = preparedInput?.semanticParse || this.parse(rawText, preparedInput);
    if (!semanticParse || semanticParse.frames.length !== 1) {
      return null;
    }

    const frame = semanticParse.frames[0];
    if (!frame.intentId || frame.validation.status !== 'passed') {
      return null;
    }

    const intent = this.intentRegistry?.get?.(frame.intentId);
    if (!intent) {
      return null;
    }

    return {
      intent,
      confidence: frame.confidence,
      entities: {
        ...frame.entities,
        routeSource: 'natural-language-router'
      },
      semanticFrame: frame
    };
  }

  _splitClauses(raw, corrected) {
    const source = raw || corrected;
    if (!source) {
      return [];
    }

    const parts = source
      .split(CONNECTOR_PATTERN)
      .map(part => part.trim())
      .filter(Boolean)
      .slice(0, 8);

    return parts.length > 0 ? parts : [source];
  }

  _parseClause(clause, index) {
    const prepared = this.nlp?.prepare ? this.nlp.prepare(clause) : null;
    const correctedText = String(prepared?.correctedText || clause || '').trim().toLowerCase();
    const tokens = Array.isArray(prepared?.tokens) && prepared.tokens.length
      ? prepared.tokens
      : Normalizer.tokenize(correctedText);
    const learningDirective = prepared?.learningDirective || parseLearningDirective(clause);
    if (learningDirective?.kind === 'repair-learning') {
      return {
        index,
        text: clause,
        correctedText,
        tokens,
        tokenRoles: tokens.map(token => ({ token, role: 'learning-feedback' })),
        action: 'repair',
        actionToken: 'wrong learning',
        targetText: learningDirective.correction,
        domain: 'active-learning',
        intentId: 'assistant.learningRepair',
        entities: {
          repairKind: learningDirective.kind,
          ...(learningDirective.correction ? { correction: learningDirective.correction } : {})
        },
        confidence: 1,
        validation: { status: 'passed', reason: 'Active-learning repair request detected' }
      };
    }
    const action = this._findAction(tokens, correctedText);
    const value = this._extractValue(correctedText);
    const domain = this._inferDomain(tokens, correctedText, action?.verb || '', value);
    const targetTokens = this._extractTargetTokens(tokens, action?.index ?? -1);
    const targetText = this._cleanTargetText(targetTokens.join(' '));
    const intentId = this._intentForFrame(action?.verb || '', domain, tokens, correctedText, value);
    const intent = intentId ? this.intentRegistry?.get?.(intentId) : null;
    const entities = intent ? this._extractEntities(intent, clause, {
      action: action?.verb || '',
      domain,
      targetText,
      value,
      correctedText,
      tokens
    }) : {};
    const validation = this._validate(intent, entities, action, domain, targetText);

    return {
      index,
      text: clause,
      correctedText,
      tokens,
      tokenRoles: this._buildTokenRoles(tokens, action?.index ?? -1, domain, value),
      relations: buildWordRelations(tokens, {
        actionIndex: action?.index ?? -1,
        targetTokens
      }),
      action: action?.verb || null,
      actionToken: action?.token || null,
      targetText,
      domain,
      intentId,
      entities,
      confidence: this._confidence(action, domain, intentId, validation),
      validation
    };
  }

  _findAction(tokens, text) {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === 'look' && tokens[index + 1] === 'up') {
        return { verb: 'search', token: 'look up', index };
      }
      if (token === 'turn' && ['on', 'off', 'up', 'down'].includes(tokens[index + 1])) {
        const next = tokens[index + 1];
        const verb = next === 'up'
          ? 'increase'
          : next === 'down'
            ? 'decrease'
            : 'set';
        return { verb, token: `turn ${next}`, index };
      }
      const direct = ACTION_ALIASES.get(token);
      if (direct) {
        return { verb: direct, token, index };
      }
    }

    if (/\b(?:volume|sound)\b/.test(text) && Number.isFinite(this._extractValue(text))) {
      return { verb: 'set', token: 'implicit-set', index: -1 };
    }

    return null;
  }

  _extractTargetTokens(tokens, actionIndex) {
    const source = actionIndex >= 0 ? tokens.slice(actionIndex + 1) : tokens;
    return source.filter(token => (
      token &&
      !FILLER_WORDS.has(token) &&
      !PREPOSITIONS.has(token) &&
      !/^\d+$/.test(token)
    ));
  }

  _inferDomain(tokens, text, action, value) {
    const tokenSet = new Set(tokens);
    const has = domain => tokens.some(token => DOMAIN_TERMS[domain]?.has(token));
    const appMatch = this._findKnownApp(tokens);

    if (action === 'open' && /\bnew\s+(?:chrome\s+)?tab\b/.test(text)) {
      return 'browser-tab';
    }

    if ((/\.[a-z0-9]{1,10}\b/i.test(text) || has('file')) && action === 'send' && has('phoneTransfer')) {
      return 'phone-transfer';
    }
    if (/\.[a-z0-9]{1,10}\b/i.test(text) || has('file')) {
      return 'local-file';
    }
    if (has('schedule') || (action === 'set' && /\btime\s+for\s+(?:\d+|one|two|three|four|five|ten)\s+(?:seconds?|minutes?|hours?)\b/.test(text))) {
      return 'schedule';
    }
    if (has('brightness')) {
      return 'brightness';
    }
    if (has('mediaPlatform') && (has('media') || has('volume')) &&
      ['play', 'pause', 'resume', 'stop', 'next', 'previous', 'mute', 'unmute', 'increase', 'decrease'].includes(action)) {
      return 'media';
    }
    if (has('volume') && ['set', 'increase', 'decrease', 'mute', 'unmute', null, ''].includes(action)) {
      return 'volume';
    }
    if (has('media') && ['play', 'pause', 'resume', 'stop', 'next', 'previous', 'mute', 'unmute', 'increase', 'decrease'].includes(action)) {
      return 'media';
    }
    if (has('mediaPlatform') && ['play', 'pause', 'resume', 'stop', 'next', 'previous', 'mute', 'unmute'].includes(action)) {
      return 'media';
    }
    if (['maximize', 'minimize'].includes(action) || (has('window') && ['show', 'close'].includes(action))) {
      return 'window';
    }
    if (['search'].includes(action) && (has('web') || !tokenSet.has('file'))) {
      return 'web';
    }
    if (Number.isFinite(value) && has('volume')) {
      return 'volume';
    }
    if (appMatch || ['open', 'close', 'switch'].includes(action) || tokens.some(token => APP_CUES.has(token))) {
      return 'app';
    }
    return 'unknown';
  }

  _intentForFrame(action, domain, tokens, text, value) {
    if (domain === 'browser-tab' && action === 'open') {
      return 'browser.open';
    }

    if (domain === 'volume') {
      if (action === 'set' && Number.isFinite(value)) return 'volume.set';
      if (action === 'increase') return 'volume.up';
      if (action === 'decrease') return 'volume.down';
      if (action === 'mute') return 'volume.mute';
      if (action === 'unmute') return 'volume.unmute';
    }

    if (domain === 'brightness') {
      if (action === 'set' && Number.isFinite(value)) return 'brightness.set';
      if (action === 'increase') return 'brightness.up';
      if (action === 'decrease') return 'brightness.down';
    }

    if (domain === 'media') {
      const map = {
        play: 'media.play',
        pause: 'media.pause',
        resume: 'media.resume',
        stop: 'media.stop',
        next: 'media.next',
        previous: 'media.previous',
        mute: 'media.mute',
        unmute: 'media.unmute'
      };
      if (action === 'increase' && /\b(?:volume|sound|quiet|louder)\b/.test(text)) return 'media.volumeUp';
      if (action === 'decrease' && /\b(?:volume|sound|loud|lower)\b/.test(text)) return 'media.volumeDown';
      return map[action] || null;
    }

    if (domain === 'window') {
      if (action === 'minimize') return 'window.minimize';
      if (action === 'maximize') return 'window.maximize';
      if (action === 'close') return 'window.close';
    }

    if (domain === 'schedule' && ['set', 'open', 'remind'].includes(action)) {
      if (/\b(?:alert|notify|remind|reminder|reminders)\b/.test(text)) return 'reminder.set';
      if (/\b(?:alarm|alarms|wake\s+me)\b/.test(text)) return 'alarm.set';
      if (/\b(?:timer|timers)\b/.test(text) || /\btime\s+for\b/.test(text)) return 'timer.set';
    }

    if (domain === 'app') {
      if (action === 'open') return 'app.open';
      if (action === 'close') return 'app.close';
      if (action === 'switch') return 'app.switch';
    }

    if (domain === 'phone-transfer' && action === 'send') {
      return 'phone.sendFile';
    }

    if (domain === 'local-file' && action === 'search') {
      return /\b(?:folder|folders|directory|directories)\b/.test(text)
        ? 'folder.search'
        : 'file.search';
    }

    if (domain === 'web' && action === 'search') {
      return 'browser.search';
    }

    return null;
  }

  _extractEntities(intent, rawText, frame) {
    const extracted = this.entityExtractor.extract(intent, rawText) || {};
    const entities = { ...extracted };
    const value = Number.isFinite(frame.value) ? Math.max(0, Math.min(100, frame.value)) : null;

    if ((intent.id === 'volume.set' || intent.id === 'brightness.set') && value !== null) {
      entities.value = value;
    }

    if (intent.id === 'media.play') {
      entities.mediaQuery = entities.mediaQuery || this._extractMediaQuery(rawText, frame);
      entities.mediaPlatform = entities.mediaPlatform || this._extractMediaPlatform(frame.correctedText) || 'youtube';
    }

    if (intent.id === 'browser.search') {
      entities.query = entities.query || this._extractSearchQuery(rawText, frame);
    }

    if (intent.id === 'file.search' || intent.id === 'folder.search') {
      entities.query = this._extractLocalSearchQuery(rawText, frame);
    }

    if (intent.id === 'phone.sendFile') {
      entities.transferKind = /\b(?:folder|directory)\b/i.test(rawText)
        ? 'folder'
        : /\b(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\b/i.test(rawText)
          ? 'image'
          : 'file';
      const source = rawText
        .replace(/^(?:send|share|transfer)\s+/i, '')
        .replace(/\s+(?:to|with)\s+(?:my\s+)?(?:phone|mobile|iphone|android|device|this\s+phone)\s*$/i, '')
        .trim();
      entities.path = entities.path || source;
    }

    if (intent.id === 'browser.open' && frame.domain === 'browser-tab') {
      const browserMatch = frame.correctedText.match(/\b(chrome|browser|edge|firefox)\b/);
      entities.url = 'about:newtab';
      entities.browserName = browserMatch?.[1] || 'browser';
      entities.newTab = true;
    }

    return Object.fromEntries(
      Object.entries(entities).filter(([, value]) => value !== null && value !== undefined && value !== '')
    );
  }

  _validate(intent, entities, action, domain, targetText) {
    if (!action) {
      return { status: 'unknown', reason: 'No action token found' };
    }
    if (!intent) {
      return { status: 'unknown', reason: `No executable intent for ${domain}.${action.verb}` };
    }

    const required = (intent.entities || [])
      .filter(entity => entity.required)
      .map(entity => entity.name)
      .filter(name => entities[name] === undefined || entities[name] === null || entities[name] === '');

    if (required.length > 0) {
      return {
        status: 'incomplete',
        reason: `Missing required entities: ${required.join(', ')}`
      };
    }

    return {
      status: 'passed',
      reason: `Parsed ${action.verb} ${domain}${targetText ? ` target "${targetText}"` : ''}`
    };
  }

  _buildTokenRoles(tokens, actionIndex, domain, value) {
    return tokens.map((token, index) => {
      let role = 'target';
      if (index === actionIndex) {
        role = 'action';
      } else if (FILLER_WORDS.has(token)) {
        role = 'filler';
      } else if (PREPOSITIONS.has(token)) {
        role = 'preposition';
      } else if (/^\d+$/.test(token) || (Number.isFinite(value) && Number(token) === value)) {
        role = 'value';
      } else if (Object.values(DOMAIN_TERMS).some(set => set.has(token))) {
        role = 'domain';
      }
      return { token, role, domain: role === 'domain' ? domain : undefined };
    });
  }

  _confidence(action, domain, intentId, validation) {
    if (validation.status !== 'passed' || !intentId) {
      return 0;
    }
    let confidence = 0.72;
    if (action?.verb) confidence += 0.1;
    if (domain && domain !== 'unknown') confidence += 0.1;
    if (intentId) confidence += 0.08;
    return Math.min(0.99, confidence);
  }

  _extractValue(text) {
    const number = Normalizer.extractNumber(String(text || ''));
    return number === null ? null : number;
  }

  _findKnownApp(tokens) {
    const joined = tokens.join(' ');
    if (this.appAliases[joined]) {
      return this.appAliases[joined];
    }
    for (const alias of Object.keys(this.appAliases)) {
      const aliasTokens = Normalizer.tokenize(alias);
      if (aliasTokens.length === 0) continue;
      for (let index = 0; index <= tokens.length - aliasTokens.length; index += 1) {
        const candidate = tokens.slice(index, index + aliasTokens.length).join(' ');
        if (candidate === alias) {
          return this.appAliases[alias];
        }
      }
    }
    return null;
  }

  _cleanTargetText(value) {
    return String(value || '')
      .replace(/\b(?:app|application|program|window|level|percent|percentage)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractMediaQuery(rawText, frame) {
    const cleaned = String(rawText || frame.correctedText || '')
      .replace(/^(?:play|stream|listen\s+to|watch|queue|put\s+on|start\s+playing)\s+/i, '')
      .replace(/\s+(?:on|in|via)\s+(?:youtube|spotify|soundcloud|gaana|jiosaavn|amazon\s*music|apple\s*music).*$/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .trim();
    return cleaned || frame.targetText || 'music';
  }

  _extractMediaPlatform(text) {
    if (/\byoutube\b/i.test(text)) return 'youtube';
    if (/\bspotify\b/i.test(text)) return 'spotify';
    if (/\bvlc\b/i.test(text)) return 'vlc';
    return null;
  }

  _extractSearchQuery(rawText, frame) {
    return String(rawText || frame.correctedText || '')
      .replace(/^(?:search|find|look\s+up|google|show\s+me|tell\s+me\s+about|tell\s+about)\s+(?:for\s+)?/i, '')
      .trim();
  }

  _extractLocalSearchQuery(rawText, frame) {
    return String(rawText || frame.correctedText || '')
      .replace(/^(?:locate|find|search|serch|seach|searh|saerch|serach)(?:\s+for)?\s+/i, '')
      .replace(/^(?:look\s+for)\s+/i, '')
      .replace(/^(?:(?:the|a|an|my)\s+)?(?:file|folder|foldr|floder|foler|directory|diretory|dirctory)\s+/i, '')
      .replace(/^(?:the|a|an|my)\s+/i, '')
      .replace(/\s+(?:file|folder|foldr|floder|foler|directory|diretory|dirctory|location|path)\s*$/i, '')
      .trim();
  }
}

module.exports = NaturalLanguageRouter;

const AppCommandLanguage = (() => {
const Normalizer = require('./Data').Normalizer;

const ACTIONS = new Map([
  ['open', 'open'],
  ['launch', 'open'],
  ['start', 'open'],
  ['run', 'open'],
  ['show', 'open'],
  ['close', 'close'],
  ['quit', 'close'],
  ['exit', 'close'],
  ['terminate', 'close'],
  ['stop', 'close'],
  ['switch', 'focus'],
  ['focus', 'focus'],
  ['activate', 'focus']
]);

const NEW_WINDOW_PATTERN = /\b(?:new|another|additional|separate|fresh)\b|\bone\s+more\b|\bnew\s+(?:window|instance)\b/i;
const LEAD_IN_PATTERN = /^(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+)+/i;

class AppCommandLanguage {
  parse(rawText, correctedText = rawText) {
    const raw = String(rawText || '').trim();
    const corrected = String(correctedText || raw).trim();
    const source = corrected.replace(LEAD_IN_PATTERN, '').trim();
    const appTab = source.match(/^(?:open|create|make|show)\s+(?:(?:a|an)\s+)?(?:(?:another|new|fresh)\s+)*(?:one\s+more\s+)?tab\s+(?:in|on)\s+(?:the\s+)?(.+)$/i);
    if (appTab?.[1] && !/^(?:chrome|browser|edge|firefox)$/i.test(appTab[1].trim())) {
      const targetText = appTab[1]
        .replace(/\s+(?:app|application|program)$/i, '')
        .trim();
      return {
        version: 'app-language-v1',
        rawText: raw,
        correctedText: corrected,
        action: 'new-tab',
        actionToken: 'open',
        targetText,
        forceNewWindow: false,
        requestedOperation: 'open-new-tab',
        confidence: targetText ? 1 : 0,
        tokenRoles: Normalizer.tokenize(source).map(token => ({
          token,
          role: /^(?:open|create|make|show)$/.test(token)
            ? 'action'
            : (/^(?:new|another|fresh|tab)$/.test(token) ? 'modifier' : 'target')
        })),
        validation: targetText
          ? { status: 'passed', reason: `Parsed new tab target "${targetText}"` }
          : { status: 'incomplete', reason: 'No application target was provided' }
      };
    }
    const tokens = Normalizer.tokenize(source);
    if (tokens.length === 0) return null;

    let actionIndex = tokens.findIndex(token => ACTIONS.has(token));
    let actionToken = actionIndex >= 0 ? tokens[actionIndex] : null;
    let action = actionToken ? ACTIONS.get(actionToken) : null;
    if (!action) return null;

    const forceNewWindow = action === 'open' && (
      NEW_WINDOW_PATTERN.test(raw) || NEW_WINDOW_PATTERN.test(corrected)
    );
    const targetText = this._extractTarget(source, actionIndex);
    const validation = this._validate(action, targetText, source);

    return {
      version: 'app-language-v1',
      rawText: raw,
      correctedText: corrected,
      action,
      actionToken,
      targetText,
      forceNewWindow,
      requestedOperation: action === 'open'
        ? (forceNewWindow ? 'open-new-window' : 'open-or-focus')
        : action,
      confidence: validation.status === 'passed' ? (actionIndex >= 0 ? 1 : 0.86) : 0,
      tokenRoles: tokens.map((token, index) => ({
        token,
        role: index === actionIndex
          ? 'action'
          : (NEW_WINDOW_PATTERN.test(token) ? 'modifier' : 'target')
      })),
      validation
    };
  }

  _extractTarget(source, actionIndex) {
    const tokens = Normalizer.tokenize(source);
    const targetTokens = actionIndex >= 0 ? tokens.slice(actionIndex + 1) : tokens;
    return targetTokens
      .join(' ')
      .replace(/^(?:up\s+|me\s+)+/i, '')
      .replace(/\b(?:in|as)\s+(?:a\s+)?(?:new|another|separate)\s+(?:window|instance)\b/gi, ' ')
      .replace(/\bone\s+more\b/gi, ' ')
      .replace(/\b(?:new|another|additional|separate|fresh)\b/gi, ' ')
      .replace(/^(?:a|an|the|my)\s+/i, '')
      .replace(/\s+(?:app|application|program|window|instance)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _validate(action, targetText, source) {
    if (!targetText) {
      return { status: 'incomplete', reason: 'No application target was provided' };
    }
    if (/\b(?:tabs?|website|site|url|files?|folders?|directories?)\b/i.test(source) || /\.[a-z0-9]{1,10}\b/i.test(source)) {
      return { status: 'rejected', reason: 'The target belongs to another command domain' };
    }
    return {
      status: 'passed',
      reason: `Parsed app ${action} target "${targetText}"`
    };
  }
}

return AppCommandLanguage;

})();
const BrowserCommandLanguage = (() => {
const Normalizer = require('./Data').Normalizer;

class BrowserCommandLanguage {
  parse(rawText, correctedText = rawText) {
    const raw = String(rawText || '').trim();
    const corrected = String(correctedText || raw).trim();
    const repaired = corrected
      .replace(/\b([a-z0-9]{8,})in\s+(chrome|browser|edge|firefox)\b/gi, '$1 in $2')
      .replace(/\s+/g, ' ')
      .trim();
    const text = Normalizer.normalizeText(repaired);
    if (!text || !/\b(?:tabs?|chrome|browser|edge|firefox)\b/.test(text)) return null;

    const browserName = this._browserName(text);
    if (/^(?:how many|count|number of|tell me how many)\s+(?:open\s+)?tabs?\s+(?:are\s+)?(?:open\s+)?(?:in|on)\s+(?:the\s+)?(?:chrome|browser|edge|firefox)$/.test(text)) {
      return this._frame('list-tabs', browserName, { responseMode: 'count' }, repaired);
    }

    if (/^(?:what|which|show|list|tell me)\b.*\btabs?\b.*\b(?:chrome|browser|edge|firefox)\b/.test(text)) {
      return this._frame('list-tabs', browserName, { responseMode: 'list' }, repaired);
    }

    if (/^(?:open|create|make|launch)\s+(?:me\s+)?(?:(?:a|an)\s+)?(?:(?:another|new|fresh)\s+)*(?:one\s+more\s+)?(?:chrome\s+|browser\s+|edge\s+|firefox\s+)?tabs?(?:\s+(?:in|on)\s+(?:the\s+)?(?:chrome|browser|edge|firefox))?$/.test(text)) {
      return this._frame('new-tab', browserName, { forceNewTab: true }, repaired);
    }

    const namedTab = text.match(/^(?:open|show|focus|activate|select|switch\s+to|go\s+to)\s+(.+?)\s+tabs?(?:\s+(?:in|on)\s+(?:the\s+)?(chrome|browser|edge|firefox))?$/);
    if (namedTab?.[1]) {
      const forceNewTab = /^(?:new|another|fresh)\b/.test(namedTab[1]);
      const tabQuery = namedTab[1]
        .replace(/^(?:the|a|an|new|another|fresh)\s+/, '')
        .trim();
      if (tabQuery) {
        return this._frame('open-named-tab', namedTab[2] || browserName, {
          tabQuery,
          forceNewTab
        }, repaired);
      }
    }

    const browserTarget = text.match(/^(?:open|show|find|search(?:\s+for)?)\s+(.+?)\s+(?:in|on)\s+(?:the\s+)?(chrome|browser|edge|firefox)$/);
    if (browserTarget?.[1]) {
      const requestedTarget = browserTarget[1].trim();
      const newTab = /\s+(?:in|on)\s+(?:a\s+)?new\s+tab$/.test(requestedTarget);
      return this._frame('open-browser-target', browserTarget[2], {
        query: requestedTarget
          .replace(/\s+(?:in|on)\s+(?:a\s+)?new\s+tab$/, '')
          .trim(),
        newTab
      }, repaired);
    }

    return null;
  }

  _browserName(text) {
    return text.match(/\b(chrome|browser|edge|firefox)\b/)?.[1] || 'browser';
  }

  _frame(operation, browserName, entities, correctedText) {
    return {
      version: 'browser-language-v1',
      operation,
      browserName: browserName || 'browser',
      entities,
      correctedText,
      confidence: 1,
      validation: { status: 'passed', reason: `Parsed browser operation ${operation}` }
    };
  }
}

return BrowserCommandLanguage;

})();
module.exports.AppCommandLanguage = AppCommandLanguage;
module.exports.BrowserCommandLanguage = BrowserCommandLanguage;
