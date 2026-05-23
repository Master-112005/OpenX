const Normalizer = require('../../shared/index').Normalizer;
const Logger = require('../../shared/index').Logger;
const { stripLeadIns } = require('../nlp/preprocessor');

class InputParser {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.wakeWord = config?.voice?.wakeWord || 'jarvis';
  }

  parse(text) {
    if (!text || typeof text !== 'string') {
      return {
        raw: '',
        normalized: '',
        commandText: '',
        rawCommandText: '',
        wakeWordDetected: false,
        hasCommand: false
      };
    }

    const raw = text.trim();
    const normalized = Normalizer.normalizeText(raw);
    const wakeWordDetected = this._detectWakeWord(normalized);
    const commandText = stripLeadIns(wakeWordDetected ? this._stripWakeWord(normalized) : normalized);
    const rawCommandText = this._stripLeadInRaw(wakeWordDetected ? this._stripWakeWordRaw(raw) : raw);
    const hasCommand = rawCommandText.length > 0;

    return {
      raw,
      normalized,
      wakeWordDetected,
      commandText,
      rawCommandText,
      hasCommand
    };
  }

  _detectWakeWord(text) {
    if (!text) return false;
    return new RegExp(`^(?:hey\\s+)?${this.wakeWord}\\b|\\b${this.wakeWord}\\b[:,]?\\s+`, 'i').test(text);
  }

  _stripWakeWord(text) {
    let result = text.replace(new RegExp(`^${this.wakeWord}\\s*`, 'i'), '');
    result = result.replace(new RegExp(`\\s*${this.wakeWord}\\s*`, 'i'), ' ');
    return result.trim();
  }

  _stripWakeWordRaw(text) {
    let result = text.replace(new RegExp(`^(?:hey\\s+)?${this.wakeWord}\\b[:,]?\\s*`, 'i'), '');
    result = result.replace(new RegExp(`\\b${this.wakeWord}\\b[:,]?`, 'i'), ' ');
    return result.replace(/\s+/g, ' ').trim();
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

  isActivation(text) {
    const normalized = Normalizer.normalizeText(text);
    return normalized === this.wakeWord || normalized === `hey ${this.wakeWord}`;
  }
}

module.exports = InputParser;
