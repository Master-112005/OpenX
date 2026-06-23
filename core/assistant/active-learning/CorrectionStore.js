'use strict';

const { BaseStore } = require('./BaseStore');
const LearningGuard = require('./LearningGuard');

const OCCURRENCE_IGNORE = 1;
const OCCURRENCE_OBSERVE = 2;
const OCCURRENCE_LEARN = 3;

const MAX_CORRECTIONS = 500;

class CorrectionStore extends BaseStore {
  constructor(filePath, options = {}) {
    super(filePath, options);
    this.occurrenceBuffer = new Map();
  }

  getDefaultData() {
    return {
      version: 1,
      corrections: {},
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
      value.corrections && typeof value.corrections === 'object' && !Array.isArray(value.corrections) &&
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) &&
      Object.entries(value.corrections).every(([key, entry]) =>
        !LearningGuard.isUnsafeObjectKey(key) && entry && typeof entry === 'object' &&
        typeof entry.resolved === 'string' && entry.resolved.length <= 200
      );
  }

  _normalizeInput(input) {
    if (!input || typeof input !== 'string') return null;
    return input.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 200);
  }

  _normalizeCorrection(correction) {
    if (!correction || typeof correction !== 'string') return null;
    return correction.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 200);
  }

  recordClarification(input, resolvedValue) {
    const normalizedInput = this._normalizeInput(input);
    const normalizedValue = this._normalizeCorrection(resolvedValue);
    
    if (!normalizedInput || !normalizedValue) {
      return { stage: 'ignored', reason: 'Invalid input' };
    }

    const guardResult = LearningGuard.isAllowedLearning('correction', normalizedInput, normalizedValue);
    if (!guardResult.allowed) {
      return { stage: 'blocked', reason: guardResult.reason };
    }

    const existing = this.data.corrections[normalizedInput];
    if (existing) {
      if (existing.resolved === normalizedValue) {
        existing.count = (existing.count || 0) + 1;
        existing.updatedAt = new Date().toISOString();
        this._save();
        return { stage: 'reinforced', input: normalizedInput, resolved: normalizedValue, count: existing.count };
      }
    }

    const bufferKey = JSON.stringify([normalizedInput, normalizedValue]);
    const current = this.occurrenceBuffer.get(bufferKey) || {
      input: normalizedInput,
      resolved: normalizedValue,
      count: 0,
      firstSeen: null
    };
    current.count += 1;
    if (!current.firstSeen) {
      current.firstSeen = new Date().toISOString();
    }
    this.occurrenceBuffer.set(bufferKey, current);

    if (current.count === OCCURRENCE_IGNORE) {
      return { stage: 'ignored', input: normalizedInput, reason: 'First occurrence - ignoring' };
    }

    if (current.count === OCCURRENCE_OBSERVE) {
      return { stage: 'observing', input: normalizedInput, resolved: normalizedValue, count: current.count };
    }

    if (current.count >= OCCURRENCE_LEARN) {
      return { 
        stage: 'ready_to_learn', 
        input: normalizedInput, 
        resolved: normalizedValue,
        suggestion: `I noticed you often mean "${normalizedValue}" when you say "${normalizedInput}". Should I remember that?`
      };
    }

    return { stage: 'buffered', input: normalizedInput, resolved: normalizedValue, count: current.count };
  }

  approveLearning(input, resolvedValue) {
    const normalizedInput = this._normalizeInput(input);
    const normalizedValue = this._normalizeCorrection(resolvedValue);
    
    if (!normalizedInput || !normalizedValue) {
      return { success: false, reason: 'Invalid input' };
    }

    const guardResult = LearningGuard.isAllowedLearning('correction', normalizedInput, normalizedValue);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason };
    }

    this.data.corrections[normalizedInput] = {
      resolved: normalizedValue,
      count: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.data.metadata.totalLearned = (this.data.metadata.totalLearned || 0) + 1;
    this.data.metadata.updatedAt = new Date().toISOString();
    
    const bufferKey = JSON.stringify([normalizedInput, normalizedValue]);
    this.occurrenceBuffer.delete(bufferKey);
    
    this._pruneCorrections();
    const saved = this._save();
    return saved
      ? { success: true, input: normalizedInput, resolved: normalizedValue }
      : { success: false, reason: 'Could not safely persist correction' };
  }

  resolveCorrection(input) {
    const normalizedInput = this._normalizeInput(input);
    if (!normalizedInput) return null;

    const correction = this.data.corrections[normalizedInput];
    if (correction) {
      correction.count = (correction.count || 0) + 1;
      correction.updatedAt = new Date().toISOString();
      this._save();
      return {
        found: true,
        input: normalizedInput,
        resolved: correction.resolved
      };
    }
    return null;
  }

  getCorrection(input) {
    const normalizedInput = this._normalizeInput(input);
    if (!normalizedInput) return null;
    const correction = this.data.corrections[normalizedInput];
    return correction ? { input: normalizedInput, ...correction } : null;
  }

  getAllCorrections() {
    const result = {};
    for (const [input, correction] of Object.entries(this.data.corrections || {})) {
      result[input] = { input, ...correction };
    }
    return result;
  }

  removeCorrection(input) {
    const normalizedInput = this._normalizeInput(input);
    if (!normalizedInput) return false;
    if (!this.data.corrections[normalizedInput]) return false;
    delete this.data.corrections[normalizedInput];
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  updateCorrection(input, newResolvedValue) {
    const normalizedInput = this._normalizeInput(input);
    const normalizedValue = this._normalizeCorrection(newResolvedValue);
    
    if (!normalizedInput || !normalizedValue) {
      return { success: false, reason: 'Invalid input' };
    }
    const guardResult = LearningGuard.isAllowedLearning('correction', normalizedInput, normalizedValue);
    if (!guardResult.allowed) return { success: false, reason: guardResult.reason };

    const correction = this.data.corrections[normalizedInput];
    if (!correction) {
      return { success: false, reason: 'Correction not found' };
    }

    correction.resolved = normalizedValue;
    correction.updatedAt = new Date().toISOString();
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save()
      ? { success: true, input: normalizedInput, resolved: normalizedValue }
      : { success: false, reason: 'Could not safely persist correction' };
  }

  getPendingSuggestions() {
    const suggestions = [];
    for (const data of this.occurrenceBuffer.values()) {
      if (data.count >= OCCURRENCE_LEARN) {
        suggestions.push({
          input: data.input,
          resolved: data.resolved,
          count: data.count,
          firstSeen: data.firstSeen,
          suggestion: `I noticed you often mean "${data.resolved}" when you say "${data.input}". Should I remember that?`
        });
      }
    }
    return suggestions;
  }

  clearOccurrenceBuffer() {
    this.occurrenceBuffer.clear();
  }

  _pruneCorrections() {
    const corrections = this.data.corrections;
    const keys = Object.keys(corrections);
    
    if (keys.length <= MAX_CORRECTIONS) {
      return;
    }

    const sorted = keys.sort((a, b) => {
      const aCount = corrections[a]?.count || 0;
      const bCount = corrections[b]?.count || 0;
      return bCount - aCount;
    });

    const keep = new Set(sorted.slice(0, MAX_CORRECTIONS));
    
    for (const key of keys) {
      if (!keep.has(key)) {
        delete corrections[key];
      }
    }
  }

  getMetadata() {
    return { ...this.data.metadata };
  }

  getStats() {
    return {
      totalCorrections: Object.keys(this.data.corrections || {}).length,
      pendingSuggestions: this.occurrenceBuffer.size,
      metadata: this.data.metadata
    };
  }
}

module.exports = CorrectionStore;
