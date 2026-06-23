'use strict';

const { BaseStore } = require('./BaseStore');
const LearningGuard = require('./LearningGuard');

const VALID_PREFERENCE_KINDS = new Set([
  'browser',
  'editor',
  'terminal',
  'music_provider',
  'video_provider',
  'mail_client',
  'search_engine',
  'file_manager',
  'media_player',
  'messenger',
  'photo_library',
  'download_folder',
  'language',
  'theme',
  'timezone'
]);

const MAX_PREFERENCES = 100;

class PreferenceStore extends BaseStore {
  constructor(filePath, options = {}) {
    super(filePath, options);
  }

  getDefaultData() {
    return {
      version: 1,
      preferences: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
  }

  validateData(value) {
    return super.validateData(value) &&
      value.version === 1 &&
      value.preferences && typeof value.preferences === 'object' && !Array.isArray(value.preferences) &&
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) &&
      Object.entries(value.preferences).every(([key, entry]) =>
        VALID_PREFERENCE_KINDS.has(key) && entry && typeof entry === 'object' &&
        typeof entry.value === 'string' && entry.value.length <= 200
      );
  }

  _normalizeKind(kind) {
    if (!kind || typeof kind !== 'string') return null;
    return kind.toLowerCase().trim().replace(/\s+/g, '_').substring(0, 50);
  }

  _validateValue(value) {
    if (!value || typeof value !== 'string') {
      return { valid: false, reason: 'Value must be a non-empty string' };
    }
    const sanitized = LearningGuard.sanitizeForLearning(value);
    if (sanitized.length === 0) {
      return { valid: false, reason: 'Value is empty after sanitization' };
    }
    if (sanitized.length > 200) {
      return { valid: false, reason: 'Value is too long' };
    }
    return { valid: true, sanitized };
  }

  setPreference(kind, value, source = 'user') {
    const normalizedKind = this._normalizeKind(kind);
    if (!normalizedKind) {
      return { success: false, reason: 'Invalid preference kind' };
    }
    if (!VALID_PREFERENCE_KINDS.has(normalizedKind)) {
      return { success: false, reason: 'Preference kind is not allowed' };
    }

    const guardResult = LearningGuard.isAllowedLearning('preference', normalizedKind, value);
    if (!guardResult.allowed) {
      return { success: false, reason: guardResult.reason };
    }

    const valueValidation = this._validateValue(value);
    if (!valueValidation.valid) {
      return { success: false, reason: valueValidation.reason };
    }

    const now = new Date().toISOString();
    const existing = this.data.preferences[normalizedKind];
    
    this.data.preferences[normalizedKind] = {
      value: valueValidation.sanitized,
      source: source,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    
    this.data.metadata.updatedAt = now;
    this._prunePreferences();
    const saved = this._save();
    if (!saved) return { success: false, reason: 'Could not safely persist preference' };
    return {
      success: true, 
      kind: normalizedKind, 
      value: valueValidation.sanitized,
      previousValue: existing?.value || null
    };
  }

  getPreference(kind) {
    const normalizedKind = this._normalizeKind(kind);
    if (!normalizedKind) return null;
    const pref = this.data.preferences[normalizedKind];
    return pref ? { kind: normalizedKind, ...pref } : null;
  }

  getAllPreferences() {
    const result = {};
    for (const [kind, pref] of Object.entries(this.data.preferences || {})) {
      result[kind] = { kind, ...pref };
    }
    return result;
  }

  removePreference(kind) {
    const normalizedKind = this._normalizeKind(kind);
    if (!normalizedKind) return false;
    if (!this.data.preferences[normalizedKind]) return false;
    delete this.data.preferences[normalizedKind];
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  hasPreference(kind) {
    const normalizedKind = this._normalizeKind(kind);
    if (!normalizedKind) return false;
    return normalizedKind in this.data.preferences;
  }

  getPreferredValue(kind, defaultValue = null) {
    const pref = this.getPreference(kind);
    return pref ? pref.value : defaultValue;
  }

  _prunePreferences() {
    const preferences = this.data.preferences;
    const keys = Object.keys(preferences);
    
    if (keys.length <= MAX_PREFERENCES) {
      return;
    }

    const sorted = keys.sort((a, b) => {
      const aTime = Date.parse(preferences[a]?.updatedAt || preferences[a]?.createdAt || 0) || 0;
      const bTime = Date.parse(preferences[b]?.updatedAt || preferences[b]?.createdAt || 0) || 0;
      return bTime - aTime;
    });

    const keep = new Set(sorted.slice(0, MAX_PREFERENCES));
    
    for (const key of keys) {
      if (!keep.has(key)) {
        delete preferences[key];
      }
    }
  }

  getPreferenceKinds() {
    return Object.keys(this.data.preferences || {});
  }

  getMetadata() {
    return { ...this.data.metadata };
  }

  getStats() {
    return {
      totalPreferences: Object.keys(this.data.preferences || {}).length,
      kinds: Object.keys(this.data.preferences || {}),
      metadata: this.data.metadata
    };
  }
}

module.exports = PreferenceStore;
