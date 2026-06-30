'use strict';

const SENSITIVE_KEYS = new Set([
  'audio',
  'pcm',
  'buffer',
  'sample',
  'samples',
  'transcript',
  'partialTranscript',
  'finalTranscript',
  'normalizedTranscript',
  'originalTranscript',
  'cleanedTranscript',
  'input',
  'text',
  'response',
  'password',
  'secret',
  'token'
]);

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMetadata(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const sanitized = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) {
      sanitized[`${key}Length`] = typeof raw === 'string' ? raw.length : Array.isArray(raw) ? raw.length : 0;
      continue;
    }
    sanitized[key] = sanitizeMetadata(raw, depth + 1);
  }
  return sanitized;
}

module.exports = {
  SENSITIVE_KEYS,
  sanitizeMetadata
};
