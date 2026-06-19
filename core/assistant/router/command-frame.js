const { Normalizer } = require('../../shared/index');

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

module.exports = CommandFrameParser;
