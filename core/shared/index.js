const os = require('os');
const crypto = require('crypto');
const { AssistantEventBus, EVENTS } = require('./events');

class Logger {
  constructor(config) {
    this.level = config?.level || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
  }

  _log(level, message, data) {
    if (this.levels[level] > this.levels[this.level]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data || null
    };
    if (level === 'error') {
      console.error(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
    } else {
      console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
    }
  }

  error(message, data) { this._log('error', message, data); }
  warn(message, data) { this._log('warn', message, data); }
  info(message, data) { this._log('info', message, data); }
  debug(message, data) { this._log('debug', message, data); }
}

class Validator {
  static isString(value) {
    return typeof value === 'string';
  }

  static isNumber(value) {
    return typeof value === 'number' && !Number.isNaN(value);
  }

  static isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  static isInRange(value, min, max) {
    return value >= min && value <= max;
  }

  static isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  static sanitizePath(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>:"|?*]/g, '').trim();
  }

  static sanitizeCommand(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[;&|`$(){}\n\r]/g, '').trim();
  }

  static isValidFilename(name) {
    if (typeof name !== 'string') return false;
    if (name.length === 0 || name.length > 255) return false;
    return !/[<>:"/\\|?*\x00-\x1f]/.test(name);
  }
}

class IdGenerator {
  static generate() {
    return crypto.randomUUID();
  }

  static short() {
    return crypto.randomBytes(4).toString('hex');
  }
}

class Normalizer {
  static normalizeWhitespace(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/\s+/g, ' ').trim();
  }

  static normalizeText(input) {
    if (typeof input !== 'string') return '';
    return this.normalizeWhitespace(
      input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
    );
  }

  static extractNumber(text) {
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  static extractPercentage(text) {
    const match = text.match(/(\d+)\s*%/);
    return match ? parseInt(match[0], 10) : null;
  }

  static tokenize(text) {
    const normalized = this.normalizeText(text);
    if (!normalized) return [];
    return normalized.split(/\s+/).filter(Boolean);
  }

  static expandContractions(text) {
    if (typeof text !== 'string') return '';

    const contractions = {
      "can't": 'cannot',
      "won't": 'will not',
      "don't": 'do not',
      "didn't": 'did not',
      "doesn't": 'does not',
      "i'm": 'i am',
      "it's": 'it is',
      "that's": 'that is',
      "what's": 'what is',
      "whats": 'what is',
      "you're": 'you are',
      "couldn't": 'could not',
      "shouldn't": 'should not',
      "wouldn't": 'would not'
    };

    let result = text;
    for (const [from, to] of Object.entries(contractions)) {
      result = result.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), to);
    }
    return result;
  }

  static damerauLevenshtein(a, b) {
    const source = a || '';
    const target = b || '';

    if (source === target) return 0;
    if (!source.length) return target.length;
    if (!target.length) return source.length;

    const matrix = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));

    for (let i = 0; i <= source.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= target.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= source.length; i += 1) {
      for (let j = 1; j <= target.length; j += 1) {
        const cost = source[i - 1] === target[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );

        if (
          i > 1 &&
          j > 1 &&
          source[i - 1] === target[j - 2] &&
          source[i - 2] === target[j - 1]
        ) {
          matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
        }
      }
    }

    return matrix[source.length][target.length];
  }

  static similarity(a, b) {
    const source = this.normalizeText(a);
    const target = this.normalizeText(b);

    if (!source && !target) return 1;
    if (!source || !target) return 0;

    const distance = this.damerauLevenshtein(source, target);
    return 1 - (distance / Math.max(source.length, target.length));
  }

  static findClosestOption(input, options, config = {}) {
    const normalizedInput = this.normalizeText(input);
    if (!normalizedInput || !Array.isArray(options) || options.length === 0) {
      return null;
    }

    const minSimilarity = config.minSimilarity ?? 0.72;
    const maxDistance = config.maxDistance ?? (normalizedInput.length >= 7 ? 2 : 1);
    let best = null;

    for (const option of options) {
      const normalizedOption = this.normalizeText(option);
      if (!normalizedOption) continue;

      const distance = this.damerauLevenshtein(normalizedInput, normalizedOption);
      const similarity = 1 - (distance / Math.max(normalizedInput.length, normalizedOption.length));

      if (distance > maxDistance || similarity < minSimilarity) {
        continue;
      }

      if (
        !best ||
        similarity > best.similarity ||
        (similarity === best.similarity && distance < best.distance)
      ) {
        best = {
          match: option,
          normalizedMatch: normalizedOption,
          similarity,
          distance
        };
      }
    }

    return best;
  }
}

module.exports = {
  Logger,
  Validator,
  IdGenerator,
  Normalizer,
  AssistantEventBus,
  EVENTS
};
