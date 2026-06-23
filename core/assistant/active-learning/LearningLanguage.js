'use strict';

const WRONG_LEARNING_PATTERNS = [
  /^(?:no\s*,?\s*)?(?:this|that|it)\s+(?:learning|thing\s+you\s+learned)\s+is\s+(?:wrong|incorrect|false)\b/i,
  /^(?:no\s*,?\s*)?(?:what|the\s+thing)\s+you\s+learned\s+is\s+(?:wrong|incorrect|false)\b/i,
  /^(?:no\s*,?\s*)?(?:you\s+)?learned\s+(?:that|it)\s+(?:wrong|incorrectly)\b/i,
  /^(?:no\s*,?\s*)?(?:this|that|it)\s+is\s+(?:wrong|incorrect|false)\s*$/i,
  /^(?:wrong|incorrect|false)\s+learning\b/i
];

const CANCEL_PATTERN = /^(?:cancel|never\s*mind|nevermind|forget\s+it|stop)\b/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractReplacement(input) {
  const text = cleanText(input);
  if (!text) return '';

  const explicit = text.match(/\b(?:instead\s+(?:learn|remember)|correct\s+(?:it|that)\s+to|it\s+should\s+be|the\s+correction\s+is)\s+(.+)$/i);
  if (explicit?.[1]) return cleanText(explicit[1]);

  return cleanText(text
    .replace(/^(?:no|nope|nah)\s*,?\s*/i, '')
    .replace(/^(?:actually\s*,?\s*|instead\s*,?\s*|learn\s+instead\s+|remember\s+instead\s+|it\s+should\s+be\s+|the\s+correction\s+is\s+)/i, ''));
}

function parseLearningDirective(input) {
  const text = cleanText(input);
  if (!text) return null;
  if (CANCEL_PATTERN.test(text)) return { kind: 'cancel', correction: '' };

  const matched = WRONG_LEARNING_PATTERNS.find(pattern => pattern.test(text));
  if (!matched) return null;

  const remainder = cleanText(text.replace(matched, '').replace(/^[,;:\s-]+/, ''));
  return {
    kind: 'repair-learning',
    correction: remainder ? extractReplacement(remainder) : '',
    confidence: 1
  };
}

module.exports = {
  extractReplacement,
  parseLearningDirective
};
