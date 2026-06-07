const DANGEROUS_ACTION_PATTERN = /\b(?:delete|format|restart|shutdown|shut\s+down|terminate|power\s+off)\b/i;

class VoiceConfidenceGate {
  constructor(options = {}) {
    this.autoExecuteThreshold = Number(options.autoExecuteThreshold) > 0
      ? Number(options.autoExecuteThreshold)
      : 0.85;
    this.confirmationThreshold = Number(options.confirmationThreshold) > 0
      ? Number(options.confirmationThreshold)
      : 0.6;
  }

  assess(input, confidence) {
    const text = String(input || '');
    const score = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;

    if (DANGEROUS_ACTION_PATTERN.test(text)) {
      return {
        action: 'confirm',
        reason: 'dangerous-action',
        confidence: score
      };
    }

    if (score >= this.autoExecuteThreshold) {
      return {
        action: 'execute',
        reason: 'high-confidence',
        confidence: score
      };
    }

    if (score >= this.confirmationThreshold) {
      return {
        action: 'confirm',
        reason: 'medium-confidence',
        confidence: score
      };
    }

    return {
      action: 'ignore',
      reason: 'low-confidence',
      confidence: score
    };
  }
}

module.exports = VoiceConfidenceGate;
