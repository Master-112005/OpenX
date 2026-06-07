const Fuse = require('fuse.js');
const { Normalizer } = require('../../shared/index');
const { INTENT_DEFINITIONS } = require('../../assistant/intents/index');

const DEFAULT_TERMS = [
  'chrome',
  'google chrome',
  'youtube',
  'you tube',
  'spotify',
  'edge',
  'microsoft edge',
  'firefox',
  'notepad',
  'calculator',
  'whatsapp',
  'discord',
  'terminal',
  'command prompt',
  'powershell',
  'vscode',
  'visual studio code',
  'desktop',
  'documents',
  'downloads',
  'open chrome',
  'close chrome',
  'open youtube',
  'play music',
  'play liked songs',
  'search chatgpt in chrome',
  'open first result',
  'set volume to',
  'increase volume',
  'decrease volume',
  'mute volume',
  'unmute volume'
];

const COMMON_TOKEN_CORRECTIONS = new Map([
  ['crow', 'chrome'],
  ['crome', 'chrome'],
  ['chrom', 'chrome'],
  ['chrm', 'chrome'],
  ['spotfy', 'spotify'],
  ['spotifi', 'spotify'],
  ['yotube', 'youtube'],
  ['youtubr', 'youtube']
]);

const COMMON_PHRASE_CORRECTIONS = [
  [/\bv\s+s\s+code\b/g, 'vscode'],
  [/\bvs\s+code\b/g, 'vscode'],
  [/\byou\s+tube\b/g, 'youtube']
];

class CommandRecoveryReranker {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.minConfidence = Number(options.minConfidence) > 0
      ? Number(options.minConfidence)
      : 0.8;
    this.maxTokenCorrections = Number(options.maxTokenCorrections) > 0
      ? Number(options.maxTokenCorrections)
      : 3;
    this.sources = this._buildSources(options.sources || []);
    this.fuse = new Fuse(this.sources.map(value => ({ value })), {
      keys: ['value'],
      includeScore: true,
      threshold: 0.38,
      ignoreLocation: true,
      minMatchCharLength: 3
    });
  }

  recover(input) {
    const originalText = String(input || '').trim();
    const workingText = this._applyPhraseCorrections(originalText);
    if (!this.enabled || !workingText) {
      return { originalText, correctedText: originalText, confidence: 1, changed: false };
    }

    const phrase = this._recoverPhrase(workingText);
    const token = this._recoverTokens(workingText);
    const best = [phrase, token]
      .filter(candidate => candidate && candidate.correctedText)
      .sort((left, right) => right.confidence - left.confidence)[0];

    if (!best || best.confidence < this.minConfidence) {
      return { originalText, correctedText: originalText, confidence: best?.confidence || 1, changed: false };
    }

    return {
      originalText,
      correctedText: best.correctedText,
      confidence: best.confidence,
      changed: best.correctedText.toLowerCase() !== originalText.toLowerCase()
    };
  }

  _recoverPhrase(input) {
    const normalized = Normalizer.normalizeText(input);
    if (!normalized) {
      return null;
    }

    const [match] = this.fuse.search(normalized, { limit: 1 });
    if (!match?.item?.value) {
      return null;
    }

    const confidence = Math.max(0, Math.min(1, 1 - Number(match.score || 0)));
    return {
      correctedText: match.item.value,
      confidence
    };
  }

  _recoverTokens(input) {
    const tokens = String(input || '').split(/\s+/).filter(Boolean);
    let corrections = 0;
    const corrected = tokens.map(token => {
      const normalized = Normalizer.normalizeText(token);
      if (!normalized || normalized.length <= 3) {
        return token;
      }

      if (COMMON_TOKEN_CORRECTIONS.has(normalized)) {
        corrections += 1;
        return COMMON_TOKEN_CORRECTIONS.get(normalized);
      }

      const closest = Normalizer.findClosestOption(normalized, this.sources, {
        minSimilarity: normalized.length >= 6 ? 0.76 : 0.82,
        maxDistance: normalized.length >= 6 ? 2 : 1
      });

      if (!closest || closest.normalizedMatch.includes(' ') || corrections >= this.maxTokenCorrections) {
        return token;
      }

      corrections += 1;
      return closest.match;
    });

    if (corrections === 0) {
      return { correctedText: input, confidence: 1 };
    }

    return {
      correctedText: corrected.join(' ').replace(/\s+/g, ' ').trim(),
      confidence: Math.max(0.6, 1 - corrections * 0.08)
    };
  }

  _buildSources(extraSources) {
    const intentPatterns = INTENT_DEFINITIONS.flatMap(intent => intent.patterns || []);
    const raw = [
      ...DEFAULT_TERMS,
      ...intentPatterns,
      ...extraSources
    ];

    return Array.from(new Set(raw
      .map(value => Normalizer.normalizeText(value))
      .filter(Boolean)))
      .sort();
  }

  _applyPhraseCorrections(input) {
    return COMMON_PHRASE_CORRECTIONS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      String(input || '').toLowerCase()
    );
  }
}

module.exports = CommandRecoveryReranker;
