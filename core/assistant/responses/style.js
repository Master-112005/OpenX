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

function applyFormalAddress(text, config) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  if (hasHonorific(source)) return source;

  const honorific = resolveHonorific(config);
  const punctuationMatch = source.match(/[.!?]$/);
  const punctuation = punctuationMatch ? punctuationMatch[0] : '.';
  const base = punctuationMatch ? source.slice(0, -1).trim() : source;

  return `${base}, ${honorific}${punctuation}`;
}

module.exports = {
  applyFormalAddress,
  hasHonorific,
  resolveHonorific
};
