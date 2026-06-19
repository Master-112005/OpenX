'use strict';

const Logger = require('../shared/index').Logger;
const { PlatformMapper } = require('./platform-mapper');

const GENERIC_MEDIA_TERMS = new Set([
  'music',
  'song',
  'songs',
  'track',
  'tracks',
  'video',
  'videos'
]);

const GENRES = new Set([
  'punjabi',
  'hindi',
  'bollywood',
  'lofi',
  'lo-fi',
  'devotional',
  'bhajan',
  'rock',
  'pop',
  'classical',
  'rap'
]);

const CONTROL_PATTERNS = [
  { intent: 'media.next', regex: /\b(?:next|skip|next song|next track|play next)\b/ },
  { intent: 'media.previous', regex: /\b(?:previous|prev|go back|back song|play previous)\b/ },
  { intent: 'media.pause', regex: /\b(?:pause|pause song|pause music|pause playback)\b/ },
  { intent: 'media.resume', regex: /\b(?:resume|continue|unpause|play again|resume playback)\b/ },
  { intent: 'media.stop', regex: /\b(?:stop music|stop song|stop playback|stop media)\b/ }
];

const PLAY_VERB_PATTERN = /\b(?:play|stream|listen\s+to|watch|queue|put\s+on|start\s+playing)\b/;
const SEARCH_VERB_PATTERN = /\b(?:search|find|look\s+up)\b/;

function cleanup(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\bspoti\s+fy\b/g, 'spotify')
    .replace(/\byou\s+tube\b/g, 'youtube')
    .replace(/\bapple\s+musix\b/g, 'apple music')
    .replace(/\bapplemusic\b/g, 'apple music')
    .replace(/\bplay\s+nexr\s+sony\b/g, 'play next song')
    .replace(/\bsony\b/g, 'song')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPoliteNoise(input) {
  return String(input || '')
    .replace(/\b(?:please|kindly|now|can you|could you|would you|open)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removePlatformClause(input) {
  return String(input || '')
    .replace(/\b(?:on|in|via|using)\s+(?:youtube|spotify|apple music|amazon music|soundcloud|gaana|jiosaavn|saavn|you tube|spoti fy|browser|chrome|edge|firefox|local media|local)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstPlayTail(input) {
  const match = input.match(PLAY_VERB_PATTERN);
  if (match) {
    return input.slice(match.index + match[0].length).trim();
  }
  return '';
}

function tokenize(input) {
  return String(input || '').split(/\s+/).filter(Boolean);
}

function restoreKnownTitleCompounds(entityText, normalizedText) {
  const entity = String(entityText || '').trim();
  const source = String(normalizedText || '').trim();

  if (/\bplay\s+date(?:\s+(?:song|songs|music|track|tracks|video|videos))?\b/.test(source) &&
    /^date(?:\s+(?:song|songs|music|track|tracks|video|videos))?$/.test(entity)) {
    return entity.replace(/^date\b/, 'playdate');
  }

  return entity;
}

class MediaParser {
  constructor(options = {}) {
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.platformMapper = options.platformMapper || new PlatformMapper(options);
  }

  parse(input, context = {}) {
    const originalText = String(input || '');
    const normalizedText = cleanup(originalText);
    if (!normalizedText) {
      return this._empty(originalText, normalizedText);
    }

    const control = CONTROL_PATTERNS.find(pattern => pattern.regex.test(normalizedText));
    if (control) {
      const explicitPlatform = this._extractPlatformText(normalizedText);
      const platform = this.platformMapper.infer(explicitPlatform, context);
      return this._result({
        intent: control.intent,
        platform: platform.platform,
        platformConfidence: platform.confidence,
        confidence: 0.96,
        originalText,
        normalizedText
      });
    }

    const hasPlayVerb = PLAY_VERB_PATTERN.test(normalizedText);
    const hasSearchVerb = SEARCH_VERB_PATTERN.test(normalizedText);
    const hasMediaTerm = tokenize(normalizedText).some(token => GENERIC_MEDIA_TERMS.has(token));
    if (!hasPlayVerb && !(hasSearchVerb && hasMediaTerm)) {
      return this._empty(originalText, normalizedText);
    }

    const explicitPlatform = this._extractPlatformText(normalizedText);
    const inferredPlatform = this.platformMapper.infer(explicitPlatform, context);
    const tail = removePlatformClause(stripPoliteNoise(firstPlayTail(normalizedText) || normalizedText));
    const entityText = restoreKnownTitleCompounds(this._cleanEntityText(tail), normalizedText);
    const genre = this._extractGenre(entityText);
    const query = this._buildQuery({ genre, entityText });

    const intent = hasPlayVerb ? 'media.play' : 'media.search';
    const confidence = this._score({
      hasPlayVerb,
      platformConfidence: inferredPlatform.confidence,
      query
    });

    return this._result({
      intent,
      genre,
      platform: inferredPlatform.platform,
      platformConfidence: inferredPlatform.confidence,
      query,
      confidence,
      originalText,
      normalizedText
    });
  }

  _empty(originalText, normalizedText) {
    return {
      intent: null,
      genre: null,
      platform: null,
      query: null,
      confidence: 0,
      originalText,
      normalizedText
    };
  }

  _result(result) {
    const parsed = {
      intent: result.intent,
      genre: result.genre || null,
      platform: result.platform || null,
      query: result.query || null,
      confidence: Number(Math.max(0, Math.min(1, result.confidence || 0)).toFixed(2)),
      platformConfidence: Number((result.platformConfidence || 0).toFixed(2)),
      originalText: result.originalText,
      normalizedText: result.normalizedText
    };

    this.logger.info(`[Media] Parsed -> ${parsed.intent || 'none'}`);
    if (parsed.platform) this.logger.info(`[Media] Platform inferred -> ${parsed.platform}`);
    this.logger.info(`[Media] Confidence -> ${parsed.confidence}`);
    return parsed;
  }

  _extractPlatformText(input) {
    const source = cleanup(input);
    const match = source.match(/\b(?:on|in|via|using|open)\s+([a-z\s]+?)(?=\s+(?:and|play|songs?|tracks?|$)|$)/);
    if (match && match[1]) {
      return match[1].trim();
    }

    for (const platform of ['apple music', 'amazon music', 'soundcloud', 'jiosaavn', 'saavn', 'youtube', 'you tube', 'spotify', 'spoti fy', 'gaana', 'chrome', 'browser', 'local media']) {
      if (source.includes(platform)) {
        return platform;
      }
    }

    return null;
  }

  _cleanEntityText(input) {
    return String(input || '')
      .replace(/\b(?:and|play|open|on|in|via|using)\b/g, ' ')
      .replace(/\b(?:the|a|an|called|named)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractGenre(input) {
    const tokens = tokenize(input);
    const genre = tokens.find(token => GENRES.has(token));
    return genre || null;
  }

  _buildQuery({ genre, entityText }) {
    const preferenceMatch = String(entityText || '').match(/\b(?:liked|favorite|favourite)\s+(?:song|songs|music|tracks?)\b/i);
    if (preferenceMatch) return preferenceMatch[0].toLowerCase();

    const original = String(entityText || '').trim();
    const cleaned = String(entityText || '')
      .replace(/\b(?:song|songs|music|tracks?|videos?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned && original) {
      return original;
    }

    if (genre) return `${genre} songs`;

    return cleaned || 'music';
  }

  _score({ hasPlayVerb, platformConfidence, query }) {
    let score = 0.35;
    if (hasPlayVerb) score += 0.24;
    if (query) score += 0.16;
    score += Math.min(0.09, (platformConfidence || 0) * 0.09);
    return score;
  }
}

module.exports = {
  MediaParser,
  cleanup
};
