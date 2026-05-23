const Normalizer = require('../../shared/index').Normalizer;
const {
  LEAD_IN_PATTERNS,
  PHRASE_REPLACEMENTS
} = require('./constants');

function applyPhraseReplacements(text) {
  let result = String(text || '');
  for (const replacement of PHRASE_REPLACEMENTS) {
    result = result.replace(replacement.from, replacement.to);
  }
  return result;
}

function stripLeadIns(text) {
  let result = String(text || '').trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of LEAD_IN_PATTERNS) {
      const next = result.replace(pattern, '').trim();
      if (next !== result) {
        result = next;
        changed = true;
      }
    }
  }

  return result;
}

function collapseRepeatedTokens(tokens) {
  const collapsed = [];
  for (const token of tokens) {
    if (!token) continue;
    if (collapsed[collapsed.length - 1] === token) continue;
    collapsed.push(token);
  }
  return collapsed;
}

function buildBigrams(tokens) {
  const result = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    result.push(`${tokens[index]} ${tokens[index + 1]}`);
  }
  return result;
}

function preprocessCommand(text) {
  const expanded = Normalizer.expandContractions(text || '');
  const normalized = Normalizer.normalizeText(expanded);
  const stripped = stripLeadIns(normalized);
  const replaced = applyPhraseReplacements(stripped);
  const tokens = collapseRepeatedTokens(Normalizer.tokenize(replaced));

  return {
    normalizedText: tokens.join(' ').trim(),
    tokens
  };
}

module.exports = {
  applyPhraseReplacements,
  buildBigrams,
  collapseRepeatedTokens,
  preprocessCommand,
  stripLeadIns
};
