'use strict';

const REFERENCE_PATTERN = /\b(?:it|that|this|them|those|these|same|one|ones|there)\b/i;
const CONTINUATION_PATTERN = /^(?:and|also|then|what\s+about|how\s+about|same\s+(?:thing\s+)?(?:with|for)|do\s+(?:the\s+)?same\s+(?:with|for))\b/i;

function analyzeDiscourse(input) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  const normalized = text.toLowerCase();
  const references = normalized.match(/\b(?:it|that|this|them|those|these|same|one|ones|there)\b/g) || [];
  const continuation = normalized.match(CONTINUATION_PATTERN)?.[0] || '';
  return {
    isFollowUp: Boolean(continuation || references.length > 0),
    continuation,
    references: [...new Set(references)],
    requiresContext: Boolean(continuation || REFERENCE_PATTERN.test(normalized))
  };
}

module.exports = { analyzeDiscourse };
