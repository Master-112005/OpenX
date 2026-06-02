'use strict';

const Fuse = require('fuse.js');
const { doubleMetaphone } = require('./phonetic');
const artists = require('./data/artists.json');

const MIN_CONFIDENCE = 0.72;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function metaphone(value) {
  return unique(doubleMetaphone(normalize(value)).filter(Boolean));
}

function levenshtein(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const substitution = previous[j] + (a[i] === b[j] ? 0 : 1);
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        substitution
      );
    }
    for (let j = 0; j < current.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - (distance / Math.max(a.length, b.length)));
}

class ArtistMatcher {
  constructor(options = {}) {
    this.artists = options.artists || artists;
    this.entries = this._buildEntries(this.artists);
    this.fuse = new Fuse(this.entries, {
      keys: ['label'],
      includeScore: true,
      threshold: 0.42,
      ignoreLocation: true,
      minMatchCharLength: 2
    });
  }

  match(input) {
    const query = normalize(input);
    if (!query) {
      return { match: null, confidence: 0, reason: 'empty' };
    }

    const exact = this.entries.find(entry => entry.label === query);
    if (exact) {
      return this._result(exact, 1, 'exact');
    }

    const tokenWindowMatch = this._matchTokenWindows(query);
    const fuseMatch = this._matchFuse(query);
    const phoneticMatch = this._matchPhonetic(query);

    const best = [tokenWindowMatch, fuseMatch, phoneticMatch]
      .filter(Boolean)
      .sort((left, right) => right.confidence - left.confidence)[0];

    if (!best || best.confidence < MIN_CONFIDENCE) {
      return { match: null, confidence: best?.confidence || 0, reason: 'low-confidence' };
    }

    return best;
  }

  _buildEntries(sourceArtists) {
    return sourceArtists.flatMap(artist => {
      const names = unique([artist.name, ...(artist.aliases || [])]);
      return names.map(label => ({
        artist: artist.name,
        label: normalize(label),
        metaphones: metaphone(label)
      }));
    });
  }

  _result(entry, confidence, reason) {
    return {
      match: entry.artist,
      confidence: Number(confidence.toFixed(2)),
      reason
    };
  }

  _matchFuse(query) {
    const result = this.fuse.search(query, { limit: 1 })[0];
    if (!result) return null;
    const confidence = Math.max(0, 1 - result.score);
    return this._result(result.item, confidence, 'fuzzy');
  }

  _matchPhonetic(query) {
    const queryCodes = metaphone(query);
    if (queryCodes.length === 0) return null;

    let best = null;
    for (const entry of this.entries) {
      const codeMatch = entry.metaphones.some(code => queryCodes.includes(code));
      if (!codeMatch) continue;

      const score = Math.max(0.78, similarity(query, entry.label));
      const candidate = this._result(entry, score, 'phonetic');
      if (!best || candidate.confidence > best.confidence) {
        best = candidate;
      }
    }

    return best;
  }

  _matchTokenWindows(query) {
    const tokens = query.split(/\s+/).filter(Boolean);
    let best = null;

    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = tokens.length; end > start; end -= 1) {
        const window = tokens.slice(start, end).join(' ');
        const exact = this.entries.find(entry => entry.label === window);
        if (exact) {
          const candidate = this._result(exact, window === query ? 1 : 0.93, 'token-window');
          if (!best || candidate.confidence > best.confidence) {
            best = candidate;
          }
        }
      }
    }

    return best;
  }
}

module.exports = {
  ArtistMatcher,
  normalize,
  metaphone,
  similarity
};
