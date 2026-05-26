const Normalizer = require('../../shared/index').Normalizer;
const Logger = require('../../shared/index').Logger;
const { stripLeadIns } = require('../nlp/preprocessor');

class InputParser {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
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
    const commandText = stripLeadIns(normalized);
    const rawCommandText = this._stripLeadInRaw(raw);
    const hasCommand = rawCommandText.length > 0;

    return {
      raw,
      normalized,
      wakeWordDetected: false,
      commandText,
      rawCommandText,
      hasCommand
    };
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
