const { Normalizer } = require('../../shared/index');
const EntityExtractor = require('../entities/index');
const { FILLER_WORDS } = require('../nlp/constants');

const CONNECTOR_PATTERN = /\s*(?:;|,|\b(?:and then|then|after that|afterwards|and|also|plus|additionally|furthermore)\b)\s*/i;

const ACTION_ALIASES = new Map([
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
  ['resume', 'resume'],
  ['run', 'open'],
  ['search', 'search'],
  ['set', 'set'],
  ['show', 'show'],
  ['skip', 'next'],
  ['start', 'open'],
  ['stop', 'stop'],
  ['stream', 'play'],
  ['switch', 'switch'],
  ['terminate', 'close'],
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
  web: new Set(['browser', 'chrome', 'edge', 'firefox', 'google', 'internet', 'site', 'website', 'web', 'youtube'])
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

    return {
      version: 'semantic-frame-v1',
      rawText: raw,
      correctedText: corrected,
      multiIntent: frames.length > 1,
      clauses,
      frames,
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

    if (/\.[a-z0-9]{1,10}\b/i.test(text) || has('file')) {
      return 'local-file';
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

    if (domain === 'app') {
      if (action === 'open') return 'app.open';
      if (action === 'close') return 'app.close';
      if (action === 'switch') return 'app.switch';
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
}

module.exports = NaturalLanguageRouter;
