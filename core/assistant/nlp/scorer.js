const Normalizer = require('../../shared/index').Normalizer;

function countOrderedMatches(inputTokens, patternTokens) {
  let matches = 0;
  let cursor = 0;

  for (const token of inputTokens) {
    if (
      cursor < patternTokens.length &&
      (
        token === patternTokens[cursor] ||
        Normalizer.similarity(token, patternTokens[cursor]) >= 0.84
      )
    ) {
      matches += 1;
      cursor += 1;
    }
  }

  return matches;
}

function countOverlap(inputTokens, patternTokens) {
  let overlap = 0;

  for (const token of patternTokens) {
    if (inputTokens.includes(token)) {
      overlap += 1;
      continue;
    }

    const fuzzyMatch = inputTokens.some(candidate => Normalizer.similarity(candidate, token) >= 0.82);
    if (fuzzyMatch) {
      overlap += 1;
    }
  }

  return overlap;
}

function ratioMatch(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || right.length === 0) {
    return 0;
  }

  const overlap = right.filter(item => (
    left.includes(item) ||
    left.some(candidate => Normalizer.similarity(candidate, item) >= 0.86)
  )).length;
  return overlap / right.length;
}

function scorePreparedPattern(preparedInput, patternPrepared) {
  const inputText = preparedInput.intentText || preparedInput.correctedText;
  const patternText = patternPrepared.intentText || patternPrepared.correctedText;

  if (!inputText || !patternText) return 0;
  if (inputText === patternText) return 1;
  if (inputText.startsWith(`${patternText} `)) return 0.98;
  if (inputText.endsWith(` ${patternText}`) || inputText.includes(` ${patternText} `)) return 0.92;

  const inputTokens = preparedInput.intentTokens.length > 0 ? preparedInput.intentTokens : preparedInput.tokens;
  const patternTokens = patternPrepared.intentTokens.length > 0 ? patternPrepared.intentTokens : patternPrepared.tokens;
  if (patternTokens.length === 0) return 0;

  const overlap = countOverlap(inputTokens, patternTokens);
  const coverage = overlap / patternTokens.length;
  const precision = overlap / Math.max(1, inputTokens.length);
  const ordered = countOrderedMatches(inputTokens, patternTokens) / patternTokens.length;
  const stringSimilarity = Normalizer.similarity(inputText, patternText);
  const inputBigrams = preparedInput.intentBigrams || preparedInput.bigrams || [];
  const patternBigrams = patternPrepared.intentBigrams || patternPrepared.bigrams || [];
  const bigramScore = ratioMatch(inputBigrams, patternBigrams);
  const leadingVerbMatch = inputTokens[0] && patternTokens[0] && (
    inputTokens[0] === patternTokens[0] ||
    Normalizer.similarity(inputTokens[0], patternTokens[0]) >= 0.84
  ) ? 1 : 0;

  return Math.max(
    0,
    Math.min(
      1,
      (coverage * 0.36) +
      (precision * 0.12) +
      (ordered * 0.16) +
      (bigramScore * 0.14) +
      (stringSimilarity * 0.16) +
      (leadingVerbMatch * 0.06)
    )
  );
}

module.exports = {
  scorePreparedPattern
};
