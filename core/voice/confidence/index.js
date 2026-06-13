const DANGEROUS_ACTION_PATTERN = /\b(?:delete|format|restart|shutdown|shut\s+down|terminate|power\s+off)\b/i;
const VoiceTurnAnalyzer = require('../pipeline/voice-turn-analyzer');

class VoiceConfidenceGate {
  constructor(options = {}) {
    this.options = options || {};
    this.autoExecuteThreshold = Number(options.autoExecuteThreshold) > 0
      ? Number(options.autoExecuteThreshold)
      : 0.85;
    this.confirmationThreshold = Number(options.confirmationThreshold) > 0
      ? Number(options.confirmationThreshold)
      : 0.6;
    this.analyzer = options.analyzer || new VoiceTurnAnalyzer({
      ...options,
      highConfidenceThreshold: this.autoExecuteThreshold,
      confirmationThreshold: this.confirmationThreshold
    });
  }

  assess(input, confidence, metadata = {}) {
    const text = String(input || '');
    const score = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
    const turn = this.analyzer.analyze({
      ...metadata,
      text,
      confidence: score
    });

    if (turn.decision === 'ignore') {
      const blockingReason = [
        'speakerMismatch',
        'speaker-not-verified',
        'knownHallucination',
        'highNoSpeech',
        'repetitive',
        'tooShort'
      ].find(reason => turn.reasons.includes(reason));
      return {
        action: 'ignore',
        reason: blockingReason || turn.reasons[0] || 'low-quality-transcript',
        confidence: score,
        turn
      };
    }

    if (DANGEROUS_ACTION_PATTERN.test(text) || turn.decision === 'confirm') {
      return {
        action: 'confirm',
        reason: DANGEROUS_ACTION_PATTERN.test(text) ? 'dangerous-action' : 'medium-confidence',
        confidence: score,
        turn
      };
    }

    if (turn.decision === 'execute') {
      return {
        action: 'execute',
        reason: turn.reasons.includes('actionable-low-confidence') ? 'actionable-low-confidence' : 'high-quality-transcript',
        confidence: score,
        turn
      };
    }

    return {
      action: 'ignore',
      reason: 'low-confidence',
      confidence: score,
      turn
    };
  }
}

module.exports = VoiceConfidenceGate;
