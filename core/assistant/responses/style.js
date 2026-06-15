const ALLOWED_HONORIFICS = new Set(['sir', 'master', 'boss', 'commander']);

function resolveHonorific(config) {
  const candidate = String(
    config?.assistant?.honorific ||
    config?.assistant?.addressing?.defaultHonorific ||
    'sir'
  ).trim().toLowerCase();

  if (ALLOWED_HONORIFICS.has(candidate)) {
    return candidate;
  }

  return 'sir';
}

function hasHonorific(text) {
  return /\b(?:sir|master|boss|commander)\b/i.test(String(text || ''));
}

function hashSeed(value) {
  const source = String(value || '');
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function applyFormalAddress(text, config) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  if (hasHonorific(source)) return source;

  if (config?.assistant?.addressing?.useHonorific === false) {
    return source;
  }

  const honorific = resolveHonorific(config);
  const isTest = typeof global.it === 'function' || process.env.NODE_ENV === 'test';

  const punctuationMatch = source.match(/[.!?]$/);
  const punctuation = punctuationMatch ? punctuationMatch[0] : '.';
  const base = punctuationMatch ? source.slice(0, -1).trim() : source;

  if (isTest) {
    return `${base}, ${honorific}${punctuation}`;
  }

  return `${base}, ${honorific}${punctuation}`;
}

module.exports = {
  applyFormalAddress,
  hasHonorific,
  resolveHonorific,
  hashSeed
};
