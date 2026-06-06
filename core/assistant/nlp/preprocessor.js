const Normalizer = require('../../shared/index').Normalizer;
const {
  LEAD_IN_PATTERNS,
  PHRASE_REPLACEMENTS,
  TOKEN_SEQUENCE_REPLACEMENTS
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

function applyTokenSequenceReplacements(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const result = [];

  for (let index = 0; index < tokens.length; index += 1) {
    let matched = false;

    for (const replacement of TOKEN_SEQUENCE_REPLACEMENTS) {
      const source = replacement.from || [];
      if (source.length === 0 || index + source.length > tokens.length) {
        continue;
      }

      const isMatch = source.every((token, offset) => tokens[index + offset] === token);
      if (!isMatch) {
        continue;
      }

      result.push(...replacement.to);
      index += source.length - 1;
      matched = true;
      break;
    }

    if (!matched) {
      result.push(tokens[index]);
    }
  }

  return result;
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
  const spaced = expanded
    .replace(/\b([a-zA-Z]{2,})(\d{2,4})\b/g, '$1 $2')
    .replace(/\b(\d{2,4})([a-zA-Z]{2,})\b/g, '$1 $2');
  const normalized = Normalizer.normalizeText(spaced);
  const stripped = stripLeadIns(normalized);
  const replaced = applyPhraseReplacements(stripped);
  const sequenceRepaired = applyTokenSequenceReplacements(Normalizer.tokenize(replaced));
  const tokens = collapseRepeatedTokens(sequenceRepaired);

  return {
    normalizedText: tokens.join(' ').trim(),
    tokens
  };
}

module.exports = {
  applyPhraseReplacements,
  applyTokenSequenceReplacements,
  buildBigrams,
  collapseRepeatedTokens,
  preprocessCommand,
  stripLeadIns
};
