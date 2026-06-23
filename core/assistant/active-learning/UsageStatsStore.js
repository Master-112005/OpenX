'use strict';

const { BaseStore } = require('./BaseStore');
const LearningGuard = require('./LearningGuard');

const MAX_TRACKED_ITEMS = 1000;
const MIN_COUNT_TO_RANK = 1;

class UsageStatsStore extends BaseStore {
  constructor(filePath, options = {}) {
    super(filePath, options);
  }

  getDefaultData() {
    return {
      version: 1,
      stats: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalRecorded: 0
      }
    };
  }

  validateData(value) {
    return super.validateData(value) &&
      value.version === 1 &&
      value.stats && typeof value.stats === 'object' && !Array.isArray(value.stats) &&
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) &&
      Object.entries(value.stats).every(([key, entry]) =>
        !LearningGuard.isUnsafeObjectKey(key) && entry && typeof entry === 'object' &&
        Number.isFinite(entry.count) && entry.count >= 0
      );
  }

  _normalizeKey(key) {
    if (!key || typeof key !== 'string') return null;
    return key.toLowerCase().trim().replace(/\s+/g, '_').substring(0, 100);
  }

  recordUsage(itemKey, increment = 1) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) {
      return { success: false, reason: 'Invalid key' };
    }
    const guardResult = LearningGuard.isAllowedLearning('usage', normalizedKey, itemKey);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason };
    }

    const count = Number(increment) || 1;
    if (count <= 0 || !Number.isFinite(count)) {
      return { success: false, reason: 'Invalid increment value' };
    }

    const now = new Date().toISOString();
    const existing = this.data.stats[normalizedKey];
    
    if (existing) {
      existing.count = (existing.count || 0) + count;
      existing.updatedAt = now;
    } else {
      this.data.stats[normalizedKey] = {
        count: count,
        firstSeen: now,
        updatedAt: now
      };
    }
    
    this.data.metadata.totalRecorded = (this.data.metadata.totalRecorded || 0) + count;
    this.data.metadata.updatedAt = now;
    
    this._pruneStats();
    const saved = this._save();
    if (!saved) return { success: false, reason: 'Could not safely persist usage statistics' };
    return {
      success: true, 
      key: normalizedKey, 
      count: this.data.stats[normalizedKey].count 
    };
  }

  getCount(itemKey) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) return 0;
    const stat = this.data.stats[normalizedKey];
    return stat ? (stat.count || 0) : 0;
  }

  getStats(itemKey) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) return null;
    const stat = this.data.stats[normalizedKey];
    return stat ? { key: normalizedKey, ...stat } : null;
  }

  getAllStats() {
    const result = {};
    for (const [key, stat] of Object.entries(this.data.stats || {})) {
      result[key] = { key, ...stat };
    }
    return result;
  }

  removeStats(itemKey) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) return false;
    if (!this.data.stats[normalizedKey]) return false;
    delete this.data.stats[normalizedKey];
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  incrementUsage(itemKey) {
    return this.recordUsage(itemKey, 1);
  }

  decrementUsage(itemKey, decrement = 1) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) {
      return { success: false, reason: 'Invalid key' };
    }

    const count = Number(decrement) || 1;
    if (count <= 0 || !Number.isFinite(count)) {
      return { success: false, reason: 'Invalid decrement value' };
    }

    const existing = this.data.stats[normalizedKey];
    if (!existing) {
      return { success: false, reason: 'Key not found' };
    }

    const newCount = Math.max(0, (existing.count || 0) - count);
    existing.count = newCount;
    existing.updatedAt = new Date().toISOString();
    this.data.metadata.updatedAt = new Date().toISOString();
    this._save();
    
    return { success: true, key: normalizedKey, count: newCount };
  }

  resetStats(itemKey) {
    const normalizedKey = this._normalizeKey(itemKey);
    if (!normalizedKey) return false;
    if (!this.data.stats[normalizedKey]) return false;
    
    this.data.stats[normalizedKey] = {
      count: 0,
      firstSeen: this.data.stats[normalizedKey].firstSeen,
      updatedAt: new Date().toISOString()
    };
    this.data.metadata.updatedAt = new Date().toISOString();
    this._save();
    return true;
  }

  getTopItems(limit = 10, minCount = MIN_COUNT_TO_RANK) {
    return Object.entries(this.data.stats || {})
      .filter(([, stat]) => (stat.count || 0) >= minCount)
      .map(([key, stat]) => ({ key, count: stat.count || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(1, Number(limit) || 10));
  }

  getRankedList(itemKeys, defaultCount = 0) {
    if (!Array.isArray(itemKeys)) return [];
    
    const ranked = itemKeys.map(key => {
      const normalizedKey = this._normalizeKey(key);
      const stat = this.data.stats?.[normalizedKey];
      return {
        key,
        normalizedKey,
        count: stat ? (stat.count || 0) : defaultCount
      };
    });
    
    ranked.sort((a, b) => b.count - a.count);
    return ranked;
  }

  getMostUsed(itemKey, comparedKeys = []) {
    const targetCount = this.getCount(itemKey);
    const comparedCounts = comparedKeys.map(key => ({
      key,
      count: this.getCount(key)
    }));
    
    const highestOther = Math.max(0, ...comparedCounts.map(c => c.count));
    
    return {
      item: itemKey,
      count: targetCount,
      isHighest: targetCount >= highestOther,
      ranking: comparedKeys.filter(k => this.getCount(k) > targetCount).length + 1
    };
  }

  clearAllStats() {
    this.data.stats = {};
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  _pruneStats() {
    const stats = this.data.stats;
    const keys = Object.keys(stats);
    
    if (keys.length <= MAX_TRACKED_ITEMS) {
      return;
    }

    const sorted = keys
      .map(key => ({ key, count: stats[key]?.count || 0, updatedAt: stats[key]?.updatedAt || 0 }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

    const keep = new Set(sorted.slice(0, MAX_TRACKED_ITEMS).map(s => s.key));
    
    for (const key of keys) {
      if (!keep.has(key)) {
        delete stats[key];
      }
    }
  }

  getMetadata() {
    return { ...this.data.metadata };
  }

  getStatsSummary() {
    const stats = Object.values(this.data.stats || {});
    const counts = stats.map(s => s.count || 0).sort((a, b) => b - a);
    
    const total = counts.reduce((sum, c) => sum + c, 0);
    const unique = stats.length;
    
    let median = 0;
    if (counts.length > 0) {
      const mid = Math.floor(counts.length / 2);
      median = counts.length % 2 === 0 
        ? (counts[mid - 1] + counts[mid]) / 2 
        : counts[mid];
    }
    
    return {
      total,
      unique,
      median,
      top10: this.getTopItems(10),
      metadata: this.data.metadata
    };
  }
}

module.exports = UsageStatsStore;
