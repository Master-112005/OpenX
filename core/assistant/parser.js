const Normalizer = require('./Data').Normalizer;
const Logger = require('./Data').Logger;
const { stripLeadIns } = require('./nlp/preprocessor');
const { parseLearningDirective } = require('./active-learning/LearningLanguage');
const { analyzeDiscourse } = require('./ContextLanguage');
const { buildWordRelations } = require('./language-relations');

class InputParser {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
  }

  parse(text) {
    if (!text || typeof text !== 'string') {
      return {
        raw: '',
        normalized: '',
        commandText: '',
        rawCommandText: '',
        wakeWordDetected: false,
        hasCommand: false,
        discourse: analyzeDiscourse('')
      };
    }

    const raw = text.trim();
    const normalized = Normalizer.normalizeText(raw);
    const commandText = stripLeadIns(normalized);
    const rawCommandText = this._stripLeadInRaw(raw);
    const hasCommand = rawCommandText.length > 0;
    const learningDirective = parseLearningDirective(rawCommandText);
    const discourse = analyzeDiscourse(rawCommandText);
    const commandTokens = Normalizer.tokenize(commandText);
    const commandClauses = this._buildCommandClauses(commandText);

    return {
      raw,
      normalized,
      wakeWordDetected: false,
      commandText,
      rawCommandText,
      hasCommand,
      learningDirective,
      discourse,
      commandTokens,
      wordRelations: buildWordRelations(commandTokens),
      commandClauses
    };
  }

  _buildCommandClauses(commandText) {
    const clauses = String(commandText || '')
      .split(/\s*(?:;|,|\b(?:and then|then|after that|afterwards|and|also|plus)\b)\s*/i)
      .map(clause => clause.trim())
      .filter(Boolean);

    return (clauses.length ? clauses : [String(commandText || '').trim()].filter(Boolean))
      .map((clause, index) => {
        const tokens = Normalizer.tokenize(clause);
        return {
          index,
          text: clause,
          tokens,
          relations: buildWordRelations(tokens)
        };
      });
  }

  _stripLeadInRaw(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';

    let result = raw;
    const leadIns = [
      /^(?:please\s+)+/i,
      /^(?:can|could|would|will)\s+you\s+/i,
      /^(?:i\s+need\s+you\s+to|i\s+want\s+you\s+to)\s+/i
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const pattern of leadIns) {
        const next = result.replace(pattern, '').trim();
        if (next !== result) {
          result = next;
          changed = true;
        }
      }
    }

    return result.replace(/\s+/g, ' ').trim();
  }

  isActivation() {
    return false;
  }
}

module.exports = InputParser;

const CommandFrameParser = (() => {
const { Normalizer } = require('./Data');
const { parseLearningDirective } = require('./active-learning/LearningLanguage');
const { buildWordRelations } = require('./language-relations');

const ACTION_ALIASES = new Map([
  ['close', 'close'],
  ['quit', 'close'],
  ['exit', 'close'],
  ['terminate', 'close'],
  ['stop', 'stop'],
  ['end', 'stop'],
  ['pause', 'pause'],
  ['hold', 'pause'],
  ['resume', 'resume'],
  ['continue', 'resume'],
  ['unpause', 'resume'],
  ['play', 'play'],
  ['send', 'send'],
  ['share', 'send'],
  ['transfer', 'send'],
  ['open', 'open'],
  ['launch', 'open'],
  ['start', 'open'],
  ['run', 'open'],
  ['skip', 'next'],
  ['next', 'next'],
  ['previous', 'previous'],
  ['prev', 'previous'],
  ['back', 'previous'],
  ['mute', 'mute'],
  ['unmute', 'unmute'],
  ['set', 'set'],
  ['change', 'set'],
  ['adjust', 'set'],
  ['increase', 'increase'],
  ['raise', 'increase'],
  ['decrease', 'decrease'],
  ['lower', 'decrease'],
  ['find', 'find'],
  ['search', 'search'],
  ['locate', 'find']
]);

const MEDIA_TARGETS = new Set([
  'audio',
  'media',
  'movie',
  'music',
  'playback',
  'player',
  'song',
  'songs',
  'sound',
  'track',
  'tracks',
  'video',
  'videos'
]);

const MEDIA_PLATFORMS = new Set([
  'amazon',
  'apple',
  'itunes',
  'spotify',
  'vlc',
  'youtube'
]);

const UTILITY_TARGETS = new Set([
  'brightness',
  'light',
  'sound',
  'volume'
]);

const APP_CUES = new Set([
  'app',
  'application',
  'program',
  'process',
  'window'
]);

const FILLER = new Set([
  'a',
  'an',
  'can',
  'could',
  'for',
  'me',
  'my',
  'now',
  'please',
  'the',
  'to',
  'you'
]);

class CommandFrameParser {
  parse(rawText, preparedInput = {}) {
    const raw = String(rawText || '').trim();
    const corrected = String(preparedInput?.correctedText || raw).trim();
    const tokens = Array.isArray(preparedInput?.tokens) && preparedInput.tokens.length
      ? preparedInput.tokens.map(token => String(token || '').toLowerCase()).filter(Boolean)
      : Normalizer.tokenize(corrected || raw);
    const learningDirective = preparedInput?.learningDirective || parseLearningDirective(raw);

    if (learningDirective?.kind === 'repair-learning') {
      return {
        rawText: raw,
        correctedText: corrected,
        tokens,
        tokenRoles: tokens.map(token => ({ token, role: 'learning-feedback' })),
        action: 'repair',
        actionToken: 'wrong learning',
        actionIndex: -1,
        targetTokens: [],
        targetText: learningDirective.correction,
        domain: 'active-learning',
        appRouteAllowed: false,
        learningDirective,
        validation: { status: 'passed', reason: 'Active-learning repair request detected' }
      };
    }

    const actionIndex = tokens.findIndex(token => ACTION_ALIASES.has(token));
    const actionToken = actionIndex >= 0 ? tokens[actionIndex] : '';
    const action = ACTION_ALIASES.get(actionToken) || '';
    const targetTokens = actionIndex >= 0
      ? tokens.slice(actionIndex + 1).filter(token => !FILLER.has(token))
      : [];
    const targetText = targetTokens.join(' ').trim();
    const domain = this._inferDomain(action, targetTokens, corrected || raw);
    const tokenRoles = tokens.map((token, index) => ({
      token,
      role: index === actionIndex
        ? 'action'
        : targetTokens.includes(token)
          ? this._targetRole(token)
          : FILLER.has(token)
            ? 'filler'
            : 'context'
    }));

    const appRouteAllowed = domain !== 'media' || this._hasExplicitAppCue(targetTokens);

    return {
      rawText: raw,
      correctedText: corrected,
      tokens,
      tokenRoles,
      relations: buildWordRelations(tokens, { actionIndex, targetTokens }),
      action,
      actionToken,
      actionIndex,
      targetTokens,
      targetText,
      domain,
      appRouteAllowed,
      validation: {
        status: action ? 'passed' : 'unknown',
        reason: action
          ? `Action "${action}" with ${domain} target "${targetText || 'none'}"`
          : 'No actionable verb found'
      }
    };
  }

  _inferDomain(action, targetTokens, text) {
    const tokenSet = new Set(targetTokens);
    const normalizedText = String(text || '').toLowerCase();
    const hasMediaTarget = targetTokens.some(token => MEDIA_TARGETS.has(token));
    const hasPlatform = targetTokens.some(token => MEDIA_PLATFORMS.has(token)) ||
      /\byou\s*tube\b/.test(normalizedText);
    const hasUtility = targetTokens.some(token => UTILITY_TARGETS.has(token));
    const hasFile = /\b(?:file|folder|directory|document|pdf|docx?|txt|java|py|js|xlsx?|pptx?)\b/.test(normalizedText);

    if (action === 'open' && /\bnew\s+(?:chrome\s+)?tab\b/.test(normalizedText)) {
      return 'browser-tab';
    }

    if (hasFile && action === 'send' && /\b(?:phone|mobile|iphone|android|device)\b/.test(normalizedText)) {
      return 'phone-transfer';
    }

    if (hasFile) {
      return 'local-file';
    }

    if (hasUtility && ['set', 'increase', 'decrease', 'mute', 'unmute'].includes(action)) {
      return tokenSet.has('brightness') || tokenSet.has('light') ? 'brightness' : 'volume';
    }

    if (hasMediaTarget && ['stop', 'pause', 'resume', 'next', 'previous', 'mute', 'unmute'].includes(action)) {
      return 'media';
    }

    if (hasPlatform && ['pause', 'resume', 'next', 'previous', 'mute', 'unmute'].includes(action)) {
      return 'media';
    }

    if (hasPlatform && action === 'stop' && hasMediaTarget) {
      return 'media';
    }

    return 'app';
  }

  _targetRole(token) {
    if (MEDIA_TARGETS.has(token) || MEDIA_PLATFORMS.has(token)) {
      return 'media-target';
    }
    if (UTILITY_TARGETS.has(token)) {
      return 'utility-target';
    }
    if (APP_CUES.has(token)) {
      return 'app-cue';
    }
    return 'target';
  }

  _hasExplicitAppCue(tokens) {
    return tokens.some(token => APP_CUES.has(token));
  }
}

return CommandFrameParser;

})();
module.exports.CommandFrameParser = CommandFrameParser;
