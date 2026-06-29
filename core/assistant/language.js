'use strict';

const REFERENCE_PATTERN = /\b(?:it|that|this|them|those|these|same|one|ones|there)\b/i;
const CONTINUATION_PATTERN = /^(?:and|also|then|what\s+about|how\s+about|same\s+(?:thing\s+)?(?:with|for)|do\s+(?:the\s+)?same\s+(?:with|for))\b/i;

const PREPOSITIONS = new Set(['at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'onto', 'to', 'with', 'using', 'via']);
const CONNECTORS = new Set(['and', 'then', 'also', 'plus']);
const FILLERS = new Set(['a', 'an', 'me', 'my', 'please', 'the', 'you']);
const REFERENCES = new Set(['it', 'that', 'this', 'them', 'those', 'one']);

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

function cleanTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map(token => String(token || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function nearestContentToken(tokens, start, direction) {
  for (let index = start; index >= 0 && index < tokens.length; index += direction) {
    const token = tokens[index];
    if (!token || FILLERS.has(token) || PREPOSITIONS.has(token) || CONNECTORS.has(token)) {
      continue;
    }
    return { index, token };
  }
  return null;
}

function pushRelation(relations, relation) {
  if (!relation || relation.fromIndex === relation.toIndex) return;
  const key = `${relation.type}:${relation.fromIndex}:${relation.toIndex}:${relation.marker || ''}`;
  if (relations.some(existing => `${existing.type}:${existing.fromIndex}:${existing.toIndex}:${existing.marker || ''}` === key)) {
    return;
  }
  relations.push(relation);
}

function buildWordRelations(tokens, options = {}) {
  const safeTokens = cleanTokens(tokens);
  if (safeTokens.length === 0) return [];

  const relations = [];
  const actionIndex = Number.isInteger(options.actionIndex) ? options.actionIndex : -1;
  const targetTokens = new Set(cleanTokens(options.targetTokens));

  if (actionIndex >= 0 && actionIndex < safeTokens.length) {
    safeTokens.forEach((token, index) => {
      if (index > actionIndex && targetTokens.has(token)) {
        pushRelation(relations, {
          type: 'action-target',
          fromIndex: actionIndex,
          from: safeTokens[actionIndex],
          toIndex: index,
          to: token
        });
      }
    });
  }

  safeTokens.forEach((token, index) => {
    if (PREPOSITIONS.has(token)) {
      const from = nearestContentToken(safeTokens, index - 1, -1);
      const to = nearestContentToken(safeTokens, index + 1, 1);
      if (from && to) {
        pushRelation(relations, {
          type: 'prepositional-link',
          marker: token,
          fromIndex: from.index,
          from: from.token,
          toIndex: to.index,
          to: to.token
        });
      }
      return;
    }

    if (CONNECTORS.has(token)) {
      const from = nearestContentToken(safeTokens, index - 1, -1);
      const to = nearestContentToken(safeTokens, index + 1, 1);
      if (from && to) {
        pushRelation(relations, {
          type: 'sequence',
          marker: token,
          fromIndex: from.index,
          from: from.token,
          toIndex: to.index,
          to: to.token
        });
      }
      return;
    }

    if (/^\d+$/.test(token)) {
      const target = nearestContentToken(safeTokens, index - 1, -1) ||
        nearestContentToken(safeTokens, index + 1, 1);
      if (target) {
        pushRelation(relations, {
          type: 'value-of',
          fromIndex: index,
          from: token,
          toIndex: target.index,
          to: target.token
        });
      }
      return;
    }

    if (REFERENCES.has(token)) {
      pushRelation(relations, {
        type: 'context-reference',
        fromIndex: index,
        from: token,
        toIndex: -1,
        to: 'previous-context'
      });
    }
  });

  return relations;
}

module.exports = {
  analyzeDiscourse,
  buildWordRelations
};
