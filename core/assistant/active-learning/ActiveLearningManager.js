'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const AliasStore = require('./AliasStore');
const PreferenceStore = require('./PreferenceStore');
const CorrectionStore = require('./CorrectionStore');
const WorkflowStore = require('./WorkflowStore');
const UsageStatsStore = require('./UsageStatsStore');

const DATA_ROOT_NAME = 'OpenX_Data';
const LEARNING_DIR_NAME = 'learning';

function resolveLearningPath(config = {}) {
  const configured = String(config?.app?.dataDir || process.env.OPENX_DATA_DIR || '').trim();
  const dataRoot = path.resolve(configured || path.join(os.homedir(), DATA_ROOT_NAME));
  return path.join(dataRoot, LEARNING_DIR_NAME);
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class ActiveLearningManager {
  constructor(config = {}) {
    this.config = config;
    this.learningPath = resolveLearningPath(config);
    this.enabled = config?.activeLearning?.enabled !== false;
    this._initializeStores();
  }

  _initializeStores() {
    ensureDirectory(this.learningPath);

    this.aliasStore = new AliasStore(path.join(this.learningPath, 'aliases.json'));
    this.preferenceStore = new PreferenceStore(path.join(this.learningPath, 'preferences.json'));
    this.correctionStore = new CorrectionStore(path.join(this.learningPath, 'corrections.json'));
    this.workflowStore = new WorkflowStore(path.join(this.learningPath, 'workflows.json'));
    this.usageStatsStore = new UsageStatsStore(path.join(this.learningPath, 'usage_stats.json'));
  }

  getLearningPath() {
    return this.learningPath;
  }

  isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  learnAlias(aliasKey, target) {
    if (!this.enabled) return null;
    return this.aliasStore.recordOccurrence(aliasKey, target);
  }

  approveAlias(aliasKey, target, category = 'application') {
    if (!this.enabled) return null;
    return this.aliasStore.approveLearning(aliasKey, target, category);
  }

  resolveAlias(aliasKey) {
    if (!this.enabled) return null;
    return this.aliasStore.resolveAlias(aliasKey);
  }

  getAllAliases() {
    return this.aliasStore.getAllAliases();
  }

  removeAlias(aliasKey) {
    return this.aliasStore.removeAlias(aliasKey);
  }

  setPreference(kind, value, source = 'user') {
    if (!this.enabled) return null;
    return this.preferenceStore.setPreference(kind, value, source);
  }

  getPreference(kind) {
    if (!this.enabled) return null;
    return this.preferenceStore.getPreference(kind);
  }

  getAllPreferences() {
    return this.preferenceStore.getAllPreferences();
  }

  removePreference(kind) {
    return this.preferenceStore.removePreference(kind);
  }

  getPreferredValue(kind, defaultValue = null) {
    return this.preferenceStore.getPreferredValue(kind, defaultValue);
  }

  recordCorrection(input, resolvedValue) {
    if (!this.enabled) return null;
    return this.correctionStore.recordClarification(input, resolvedValue);
  }

  approveCorrection(input, resolvedValue) {
    if (!this.enabled) return null;
    return this.correctionStore.approveLearning(input, resolvedValue);
  }

  resolveCorrection(input) {
    if (!this.enabled) return null;
    return this.correctionStore.resolveCorrection(input);
  }

  getAllCorrections() {
    return this.correctionStore.getAllCorrections();
  }

  removeCorrection(input) {
    return this.correctionStore.removeCorrection(input);
  }

  recordCommandSequence(commands, sourceInput = null) {
    if (!this.enabled) return null;
    return this.workflowStore.recordCommandSequence(commands, sourceInput);
  }

  approveWorkflow(name, commands, category = 'custom') {
    if (!this.enabled) return null;
    return this.workflowStore.approveWorkflow(name, commands, category);
  }

  executeWorkflow(name) {
    if (!this.enabled) return null;
    return this.workflowStore.executeWorkflow(name);
  }

  getAllWorkflows() {
    return this.workflowStore.getAllWorkflows();
  }

  removeWorkflow(name) {
    return this.workflowStore.removeWorkflow(name);
  }

  updateWorkflow(name, newCommands) {
    return this.workflowStore.updateWorkflow(name, newCommands);
  }

  recordUsage(itemKey, increment = 1) {
    if (!this.enabled) return null;
    return this.usageStatsStore.recordUsage(itemKey, increment);
  }

  incrementUsage(itemKey) {
    if (!this.enabled) return null;
    return this.usageStatsStore.incrementUsage(itemKey);
  }

  getUsageStats(itemKey) {
    return this.usageStatsStore.getStats(itemKey);
  }

  getAllUsageStats() {
    return this.usageStatsStore.getAllStats();
  }

  getTopUsed(limit = 10) {
    return this.usageStatsStore.getTopItems(limit);
  }

  getRankedItems(itemKeys) {
    return this.usageStatsStore.getRankedList(itemKeys);
  }

  getPendingSuggestions() {
    return {
      aliases: this.aliasStore.getPendingSuggestions(),
      corrections: this.correctionStore.getPendingSuggestions(),
      workflows: this.workflowStore.getPendingSuggestions()
    };
  }

  clearAllPendingSuggestions() {
    this.aliasStore.clearOccurrenceBuffer();
    this.correctionStore.clearOccurrenceBuffer();
    this.workflowStore.clearSequenceBuffer();
    return true;
  }

  showAliases() {
    const aliases = this.getAllAliases();
    if (Object.keys(aliases).length === 0) {
      return { found: false, message: 'No aliases learned yet.' };
    }
    return { found: true, aliases };
  }

  showPreferences() {
    const preferences = this.getAllPreferences();
    if (Object.keys(preferences).length === 0) {
      return { found: false, message: 'No preferences learned yet.' };
    }
    return { found: true, preferences };
  }

  showWorkflows() {
    const workflows = this.getAllWorkflows();
    if (Object.keys(workflows).length === 0) {
      return { found: false, message: 'No workflows learned yet.' };
    }
    return { found: true, workflows };
  }

  showUsageStats() {
    return this.usageStatsStore.getStatsSummary();
  }

  forgetAlias(aliasKey) {
    const result = this.removeAlias(aliasKey);
    return {
      success: result,
      message: result 
        ? `Alias "${aliasKey}" has been forgotten.` 
        : `Alias "${aliasKey}" not found.`
    };
  }

  forgetPreference(kind) {
    const result = this.removePreference(kind);
    return {
      success: result,
      message: result 
        ? `Preference "${kind}" has been forgotten.` 
        : `Preference "${kind}" not found.`
    };
  }

  forgetCorrection(input) {
    const result = this.removeCorrection(input);
    return {
      success: result,
      message: result 
        ? `Correction for "${input}" has been forgotten.` 
        : `Correction for "${input}" not found.`
    };
  }

  forgetWorkflow(name) {
    const result = this.removeWorkflow(name);
    return {
      success: result,
      message: result 
        ? `Workflow "${name}" has been forgotten.` 
        : `Workflow "${name}" not found.`
    };
  }

  resetActiveLearning() {
    const saved = [
      this.aliasStore.clear(),
      this.preferenceStore.clear(),
      this.correctionStore.clear(),
      this.workflowStore.clear(),
      this.usageStatsStore.clearAllStats()
    ];
    this.clearAllPendingSuggestions();
    const success = saved.every(Boolean);
    return {
      success,
      message: success
        ? 'All active learning data has been reset.'
        : 'Active learning reset could not be fully persisted.'
    };
  }

  resetAliases() {
    this.aliasStore.clear();
    return { success: true, message: 'All aliases have been reset.' };
  }

  resetPreferences() {
    this.preferenceStore.clear();
    return { success: true, message: 'All preferences have been reset.' };
  }

  resetCorrections() {
    this.correctionStore.clear();
    return { success: true, message: 'All corrections have been reset.' };
  }

  resetWorkflows() {
    this.workflowStore.clear();
    return { success: true, message: 'All workflows have been reset.' };
  }

  resetUsageStats() {
    this.usageStatsStore.clearAllStats();
    return { success: true, message: 'All usage statistics have been reset.' };
  }

  getStats() {
    return {
      alias: this.aliasStore.getStats(),
      preference: this.preferenceStore.getStats(),
      correction: this.correctionStore.getStats(),
      workflow: this.workflowStore.getStats(),
      usageStats: this.usageStatsStore.getStatsSummary(),
      pendingSuggestions: this.getPendingSuggestions()
    };
  }

  getStatus() {
    return {
      enabled: this.enabled,
      learningPath: this.learningPath,
      stores: {
        aliases: this.aliasStore.exists(),
        preferences: this.preferenceStore.exists(),
        corrections: this.correctionStore.exists(),
        workflows: this.workflowStore.exists(),
        usageStats: this.usageStatsStore.exists()
      }
    };
  }

  handleUserCommand(command) {
    const normalized = (command || '').toLowerCase().trim();

    if (normalized === 'show my learned aliases' || normalized === 'show aliases') {
      return this.showAliases();
    }
    if (normalized === 'show my preferences' || normalized === 'show preferences') {
      return this.showPreferences();
    }
    if (normalized === 'show my workflows' || normalized === 'show workflows') {
      return this.showWorkflows();
    }
    if (normalized === 'show my usage' || normalized === 'show usage stats' || normalized === 'show usage statistics') {
      return this.showUsageStats();
    }
    if (normalized === 'show pending suggestions' || normalized === 'show suggestions') {
      const suggestions = this.getPendingSuggestions();
      const hasAny = suggestions.aliases.length > 0 || 
                     suggestions.corrections.length > 0 || 
                     suggestions.workflows.length > 0;
      return hasAny ? suggestions : { found: false, message: 'No pending suggestions.' };
    }

    const forgetAliasMatch = normalized.match(/^forget\s+alias\s+(.+)$/);
    if (forgetAliasMatch) {
      return this.forgetAlias(forgetAliasMatch[1]);
    }

    const forgetPrefMatch = normalized.match(/^forget\s+preference\s+(.+)$/);
    if (forgetPrefMatch) {
      return this.forgetPreference(forgetPrefMatch[1]);
    }

    const forgetCorrectionMatch = normalized.match(/^forget\s+correction\s+(.+)$/);
    if (forgetCorrectionMatch) {
      return this.forgetCorrection(forgetCorrectionMatch[1]);
    }

    const forgetWorkflowMatch = normalized.match(/^forget\s+workflow\s+(.+)$/);
    if (forgetWorkflowMatch) {
      return this.forgetWorkflow(forgetWorkflowMatch[1]);
    }

    if (normalized === 'reset active learning' || normalized === 'reset all learning') {
      return this.resetActiveLearning();
    }

    return null;
  }

  reload() {
    this.aliasStore.reload();
    this.preferenceStore.reload();
    this.correctionStore.reload();
    this.workflowStore.reload();
    this.usageStatsStore.reload();
    return { success: true };
  }
}

module.exports = ActiveLearningManager;
module.exports.resolveLearningPath = resolveLearningPath;
