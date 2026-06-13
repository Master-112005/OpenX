const DEFAULT_HALLUCINATION_PHRASES = [
  'background music',
  'blank audio',
  'blank_audio',
  'captioned by',
  'dont forget to subscribe',
  'foreign',
  'like and subscribe',
  'music',
  'no speech',
  'no_speech',
  'oh',
  'silence',
  'subscribe',
  'thank you',
  'thanks for watching'
];

const DESTRUCTIVE_PATTERN = /\b(?:delete|erase|format|restart|shutdown|shut\s+down|terminate|kill|power\s+off|remove)\b/i;

const ACTION_TOKENS = new Set([
  'answer',
  'attach',
  'call',
  'clean',
  'close',
  'continue',
  'copy',
  'create',
  'decrease',
  'delete',
  'draft',
  'extract',
  'find',
  'go',
  'increase',
  'launch',
  'list',
  'look',
  'lookup',
  'lower',
  'maximize',
  'message',
  'minimize',
  'move',
  'mute',
  'open',
  'pause',
  'play',
  'read',
  'rename',
  'resume',
  'search',
  'send',
  'set',
  'share',
  'show',
  'skip',
  'start',
  'stop',
  'summarize',
  'switch',
  'tell',
  'turn',
  'undo',
  'unmute',
  'watch'
]);

const QUESTION_START = /^(?:what|who|when|where|why|how|which|can|could|is|are|do|does|did)\b/i;

const CONVERSATIONAL_PHRASES = new Set([
  'bye',
  'good afternoon',
  'good evening',
  'good morning',
  'hello',
  'help',
  'hey',
  'hi',
  'how are you',
  'thank you',
  'thanks',
  'what can you do',
  'what is your name',
  'whats your name'
]);

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

function uniqueTokenRatio(tokens) {
  if (!tokens.length) {
    return 0;
  }
  return new Set(tokens).size / tokens.length;
}

class VoiceTurnAnalyzer {
  constructor(options = {}) {
    this.options = options || {};
    this.hallucinationPhrases = new Set([
      ...DEFAULT_HALLUCINATION_PHRASES,
      ...(Array.isArray(options.hallucinationPhrases) ? options.hallucinationPhrases : [])
    ].map(phrase => String(phrase || '').trim().toLowerCase()).filter(Boolean));
    this.highConfidenceThreshold = Number(options.highConfidenceThreshold) > 0
      ? Number(options.highConfidenceThreshold)
      : 0.85;
    this.confirmationThreshold = Number(options.confirmationThreshold) > 0
      ? Number(options.confirmationThreshold)
      : 0.6;
    this.lowConfidenceThreshold = Number(options.lowConfidenceThreshold) > 0
      ? Number(options.lowConfidenceThreshold)
      : 0.35;
    this.maxNoSpeechProbability = Number(options.maxNoSpeechProbability) > 0
      ? Number(options.maxNoSpeechProbability)
      : 0.55;
    this.maxCompressionRatio = Number(options.maxCompressionRatio) > 0
      ? Number(options.maxCompressionRatio)
      : 2.4;
  }

  analyze(turn = {}) {
    const text = String(turn.text || '').trim().toLowerCase();
    const tokens = text.split(/\s+/).filter(Boolean);
    const rawConfidence = Number(turn.confidence);
    const confidence = Number.isFinite(rawConfidence) ? clamp(rawConfidence) : 0.5;
    const noSpeechProbability = Number(turn.noSpeechProbability);
    const compressionRatio = Number(turn.compressionRatio);
    const mode = String(turn.mode || 'command');
    const speaker = this._assessSpeaker(turn.speaker || turn.speakerLock);

    const signals = {
      commandLike: this._looksCommandLike(text, tokens),
      questionLike: QUESTION_START.test(text),
      conversational: this._looksConversational(text, tokens),
      destructive: DESTRUCTIVE_PATTERN.test(text),
      knownHallucination: this.hallucinationPhrases.has(text),
      repetitive: tokens.length >= 5 && uniqueTokenRatio(tokens) <= 0.45,
      tooShort: tokens.length === 0 || (
        tokens.length === 1
        && !ACTION_TOKENS.has(tokens[0])
        && !CONVERSATIONAL_PHRASES.has(text)
        && mode !== 'confirmation'
      ),
      highNoSpeech: Number.isFinite(noSpeechProbability) && noSpeechProbability > this.maxNoSpeechProbability,
      highCompression: Number.isFinite(compressionRatio) && compressionRatio > this.maxCompressionRatio,
      speakerMismatch: speaker.status === 'mismatch'
    };

    let quality = confidence;
    if (signals.commandLike || signals.questionLike || signals.conversational) quality += 0.12;
    if (signals.destructive) quality -= 0.2;
    if (signals.knownHallucination) quality -= 0.5;
    if (signals.repetitive) quality -= 0.25;
    if (signals.tooShort) quality -= 0.25;
    if (signals.highNoSpeech) quality -= Math.min(0.45, (noSpeechProbability - this.maxNoSpeechProbability) * 1.2);
    if (signals.highCompression) quality -= 0.25;
    if (signals.speakerMismatch) quality -= 0.45;
    if (speaker.status === 'verified') quality += 0.04;
    quality = clamp(quality);

    const reasons = Object.entries(signals)
      .filter(([, active]) => active)
      .map(([name]) => name);

    let decision = 'ignore';
    if (signals.speakerMismatch) {
      decision = 'ignore';
      reasons.push('speaker-not-verified');
    } else if (signals.destructive) {
      decision = quality >= this.lowConfidenceThreshold ? 'confirm' : 'ignore';
      reasons.push('destructive-action');
    } else if (quality >= this.highConfidenceThreshold) {
      decision = 'execute';
    } else if (quality >= this.confirmationThreshold) {
      decision = 'confirm';
    } else if ((signals.commandLike || signals.questionLike || signals.conversational) && quality >= this.lowConfidenceThreshold) {
      decision = 'execute';
      reasons.push('actionable-low-confidence');
    }

    if (signals.knownHallucination || signals.tooShort || signals.repetitive) {
      decision = 'ignore';
    }
    if (signals.highNoSpeech && quality < this.confirmationThreshold && !signals.conversational) {
      decision = 'ignore';
    }

    return {
      accepted: decision !== 'ignore',
      decision,
      quality,
      confidence,
      mode,
      reasons: Array.from(new Set(reasons)),
      speaker,
      signals
    };
  }

  _looksCommandLike(text, tokens) {
    if (!text || !tokens.length) {
      return false;
    }
    if (ACTION_TOKENS.has(tokens[0])) {
      return true;
    }
    return tokens.some(token => ACTION_TOKENS.has(token));
  }

  _looksConversational(text, tokens) {
    if (!text) {
      return false;
    }
    if (CONVERSATIONAL_PHRASES.has(text)) {
      return true;
    }
    return tokens.length <= 5 && /^(?:hi|hello|hey|good|thanks|thank|bye)\b/.test(text);
  }

  _assessSpeaker(speaker = {}) {
    if (!speaker || typeof speaker !== 'object') {
      return { status: 'unknown' };
    }
    if (speaker.verified === true || speaker.match === true) {
      return { status: 'verified', score: Number(speaker.score) || null };
    }
    if (speaker.verified === false || speaker.match === false) {
      return { status: 'mismatch', score: Number(speaker.score) || null };
    }
    return { status: 'unknown', score: Number(speaker.score) || null };
  }
}

module.exports = VoiceTurnAnalyzer;
