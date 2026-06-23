'use strict';

const { BaseStore } = require('./BaseStore');
const LearningGuard = require('./LearningGuard');

const OCCURRENCE_IGNORE = 1;
const OCCURRENCE_OBSERVE = 2;
const OCCURRENCE_LEARN = 3;

const ALIAS_CATEGORIES = new Set([
  'application',
  'website',
  'folder',
  'file',
  'command'
]);

class AliasStore extends BaseStore {
  constructor(filePath, options = {}) {
    super(filePath, options);
    this.occurrenceBuffer = new Map();
  }

  getDefaultData() {
    return {
      version: 1,
      aliases: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalLearned: 0
      }
    };
  }

  validateData(value) {
    return super.validateData(value) &&
      value.version === 1 &&
      value.aliases && typeof value.aliases === 'object' && !Array.isArray(value.aliases) &&
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) &&
      Object.entries(value.aliases).every(([key, entry]) =>
        !LearningGuard.isUnsafeObjectKey(key) && entry && typeof entry === 'object' &&
        typeof entry.target === 'string' && entry.target.length <= 500
      );
  }

  _normalizeAliasKey(key) {
    if (!key || typeof key !== 'string') return null;
    return key.toLowerCase().trim().replace(/\s+/g, '_').substring(0, 100);
  }

  recordOccurrence(aliasKey, target) {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey || !target) {
      return { stage: 'ignored', reason: 'Invalid input' };
    }

    const guardResult = LearningGuard.isAllowedLearning('alias', normalizedKey, target);
    if (!guardResult.allowed) {
      return { stage: 'blocked', reason: guardResult.reason };
    }

    const targetValidation = LearningGuard.validateAliasTarget(target);
    if (!targetValidation.valid) {
      return { stage: 'blocked', reason: targetValidation.reason };
    }

    const existing = this.data.aliases[normalizedKey];
    if (existing) {
      if (existing.target.toLowerCase() === target.toLowerCase()) {
        existing.useCount = (existing.useCount || 0) + 1;
        existing.updatedAt = new Date().toISOString();
        this._save();
        return { stage: 'reinforced', alias: normalizedKey, target, useCount: existing.useCount };
      }
    }

    const bufferKey = JSON.stringify([normalizedKey, targetValidation.sanitized]);
    const current = this.occurrenceBuffer.get(bufferKey) || {
      alias: normalizedKey,
      target: targetValidation.sanitized,
      count: 0,
      firstSeen: null
    };
    current.count += 1;
    if (!current.firstSeen) {
      current.firstSeen = new Date().toISOString();
    }
    this.occurrenceBuffer.set(bufferKey, current);

    if (current.count === OCCURRENCE_IGNORE) {
      return { stage: 'ignored', alias: normalizedKey, target, reason: 'First occurrence - ignoring' };
    }

    if (current.count === OCCURRENCE_OBSERVE) {
      return { stage: 'observing', alias: normalizedKey, target, count: current.count, reason: 'Second occurrence - observing' };
    }

    if (current.count >= OCCURRENCE_LEARN) {
      return { 
        stage: 'ready_to_learn', 
        alias: normalizedKey, 
        target: targetValidation.sanitized,
        suggestion: `I noticed you often use "${normalizedKey}" for ${targetValidation.sanitized}. Should I remember that?`
      };
    }

    return { stage: 'buffered', alias: normalizedKey, target, count: current.count };
  }

  approveLearning(aliasKey, target, category = 'application') {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey || !target) {
      return { success: false, reason: 'Invalid input' };
    }

    const guardResult = LearningGuard.isAllowedLearning('alias', normalizedKey, target);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason };
    }

    const targetValidation = LearningGuard.validateAliasTarget(target);
    if (!targetValidation.valid) {
      return { success: false, reason: targetValidation.reason };
    }

    if (!ALIAS_CATEGORIES.has(category)) {
      category = 'application';
    }

    const sanitizedTarget = targetValidation.sanitized;
    this.data.aliases[normalizedKey] = {
      target: sanitizedTarget,
      category: category,
      useCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.metadata.totalLearned = (this.data.metadata.totalLearned || 0) + 1;
    this.data.metadata.updatedAt = new Date().toISOString();
    
    const bufferKey = JSON.stringify([normalizedKey, sanitizedTarget]);
    this.occurrenceBuffer.delete(bufferKey);
    
    const saved = this._save();
    return saved
      ? { success: true, alias: normalizedKey, target: sanitizedTarget }
      : { success: false, reason: 'Could not safely persist alias' };
  }

  resolveAlias(aliasKey) {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey) return null;

    const alias = this.data.aliases[normalizedKey];
    if (alias) {
      alias.useCount = (alias.useCount || 0) + 1;
      alias.updatedAt = new Date().toISOString();
      this._save();
      return {
        found: true,
        alias: normalizedKey,
        target: alias.target,
        category: alias.category
      };
    }
    return null;
  }

  getAlias(aliasKey) {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey) return null;
    const alias = this.data.aliases[normalizedKey];
    return alias ? { ...alias, alias: normalizedKey } : null;
  }

  getAllAliases() {
    const result = {};
    for (const [key, alias] of Object.entries(this.data.aliases || {})) {
      result[key] = { ...alias, alias: key };
    }
    return result;
  }

  removeAlias(aliasKey) {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey) return false;
    if (!this.data.aliases[normalizedKey]) return false;
    delete this.data.aliases[normalizedKey];
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  updateAlias(aliasKey, newTarget) {
    const normalizedKey = this._normalizeAliasKey(aliasKey);
    if (!normalizedKey) return { success: false, reason: 'Invalid key' };
    
    const guardResult = LearningGuard.isAllowedLearning('alias', normalizedKey, newTarget);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason };
    }
    const targetValidation = LearningGuard.validateAliasTarget(newTarget);
    if (!targetValidation.valid) {
      return { success: false, reason: targetValidation.reason };
    }

    const alias = this.data.aliases[normalizedKey];
    if (!alias) {
      return { success: false, reason: 'Alias not found' };
    }

    alias.target = targetValidation.sanitized;
    alias.updatedAt = new Date().toISOString();
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save()
      ? { success: true, alias: normalizedKey, target: targetValidation.sanitized }
      : { success: false, reason: 'Could not safely persist alias' };
  }

  getAliasesByCategory(category) {
    if (!ALIAS_CATEGORIES.has(category)) return {};
    const result = {};
    for (const [key, alias] of Object.entries(this.data.aliases || {})) {
      if (alias.category === category) {
        result[key] = { ...alias, alias: key };
      }
    }
    return result;
  }

  getPendingSuggestions() {
    const suggestions = [];
    for (const data of this.occurrenceBuffer.values()) {
      if (data.count >= OCCURRENCE_LEARN) {
        suggestions.push({
          alias: data.alias,
          target: data.target,
          count: data.count,
          firstSeen: data.firstSeen,
          suggestion: `I noticed you often use "${data.alias}" for ${data.target}. Should I remember that?`
        });
      }
    }
    return suggestions;
  }

  clearOccurrenceBuffer() {
    this.occurrenceBuffer.clear();
  }

  getMetadata() {
    return { ...this.data.metadata };
  }

  getStats() {
    return {
      totalAliases: Object.keys(this.data.aliases || {}).length,
      pendingSuggestions: this.occurrenceBuffer.size,
      metadata: this.data.metadata
    };
  }
}

module.exports = AliasStore;
