'use strict';

const { BaseStore } = require('./BaseStore');
const LearningGuard = require('./LearningGuard');

const MIN_SEQUENCE_LENGTH = 2;
const MIN_OCCURRENCES_TO_SUGGEST = 3;
const MAX_WORKFLOWS = 50;
const MAX_WORKFLOW_LENGTH = 20;

const WORKFLOW_CATEGORIES = new Set([
  'morning',
  'evening',
  'work',
  'personal',
  'development',
  'communication',
  'media',
  'custom'
]);

class WorkflowStore extends BaseStore {
  constructor(filePath, options = {}) {
    super(filePath, options);
    this.sequenceBuffer = new Map();
  }

  getDefaultData() {
    return {
      version: 1,
      workflows: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        totalCreated: 0
      }
    };
  }

  validateData(value) {
    return super.validateData(value) &&
      value.version === 1 &&
      value.workflows && typeof value.workflows === 'object' && !Array.isArray(value.workflows) &&
      value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata) &&
      Object.entries(value.workflows).every(([key, entry]) =>
        !LearningGuard.isUnsafeObjectKey(key) && entry && typeof entry === 'object' &&
        Array.isArray(entry.commands) && entry.commands.length >= MIN_SEQUENCE_LENGTH &&
        entry.commands.length <= MAX_WORKFLOW_LENGTH &&
        entry.commands.every(command => typeof command === 'string' && command.length <= 300)
      );
  }

  _normalizeWorkflowName(name) {
    if (!name || typeof name !== 'string') return null;
    const validation = LearningGuard.validateWorkflowName(name);
    return validation.valid ? validation.sanitized : null;
  }

  _normalizeCommand(command) {
    if (!command || typeof command !== 'string') return null;
    return command.toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 300);
  }

  _createSequenceSignature(commands) {
    return commands.map(cmd => this._normalizeCommand(cmd)).filter(Boolean).join('|');
  }

  recordCommandSequence(commands, sourceInput = null) {
    if (!Array.isArray(commands) || commands.length < MIN_SEQUENCE_LENGTH) {
      return { stage: 'ignored', reason: 'Sequence too short' };
    }

    if (commands.length > MAX_WORKFLOW_LENGTH) {
      return { stage: 'ignored', reason: 'Sequence too long' };
    }

    const normalizedCommands = commands.map(cmd => this._normalizeCommand(cmd)).filter(Boolean);
    if (normalizedCommands.length < MIN_SEQUENCE_LENGTH) {
      return { stage: 'ignored', reason: 'Invalid commands in sequence' };
    }
    const blocked = normalizedCommands.find(command =>
      !LearningGuard.isAllowedLearning('workflow', 'command', command).allowed
    );
    if (blocked) return { stage: 'blocked', reason: 'Sequence contains sensitive data' };

    const signature = this._createSequenceSignature(normalizedCommands);
    
    const existingWorkflow = this._findWorkflowBySignature(signature);
    if (existingWorkflow) {
      const name = existingWorkflow;
      this.data.workflows[name].useCount = (this.data.workflows[name].useCount || 0) + 1;
      this.data.workflows[name].lastUsed = new Date().toISOString();
      this._save();
      return { stage: 'reinforced', workflow: name, useCount: this.data.workflows[name].useCount };
    }

    let bufferEntry = this.sequenceBuffer.get(signature) || {
      commands: normalizedCommands,
      sourceInput: sourceInput ? '[redacted]' : null,
      count: 0,
      firstSeen: null,
      lastSeen: null
    };
    
    bufferEntry.count += 1;
    if (!bufferEntry.firstSeen) {
      bufferEntry.firstSeen = new Date().toISOString();
    }
    bufferEntry.lastSeen = new Date().toISOString();
    this.sequenceBuffer.set(signature, bufferEntry);

    if (bufferEntry.count === 1) {
      return { stage: 'ignored', reason: 'First occurrence - ignoring' };
    }

    if (bufferEntry.count === 2) {
      return { stage: 'observing', count: bufferEntry.count, reason: 'Second occurrence - observing' };
    }

    if (bufferEntry.count >= MIN_OCCURRENCES_TO_SUGGEST) {
      const suggestedName = this._generateWorkflowName(normalizedCommands);
      return {
        stage: 'ready_to_learn',
        suggestedName,
        commands: normalizedCommands,
        count: bufferEntry.count,
        suggestion: `I noticed you often run these commands together: ${normalizedCommands.slice(0, 3).join(', ')}${normalizedCommands.length > 3 ? '...' : ''}. Would you like to save this as a workflow?`
      };
    }

    return { stage: 'observing', count: bufferEntry.count };
  }

  approveWorkflow(name, commands, category = 'custom') {
    const normalizedName = this._normalizeWorkflowName(name);
    if (!normalizedName) {
      return { success: false, reason: 'Invalid workflow name' };
    }

    if (!Array.isArray(commands) || commands.length < MIN_SEQUENCE_LENGTH) {
      return { success: false, reason: 'Workflow must have at least 2 commands' };
    }
    if (commands.length > MAX_WORKFLOW_LENGTH) {
      return { success: false, reason: `Workflow cannot exceed ${MAX_WORKFLOW_LENGTH} commands` };
    }

    if (this.data.workflows[normalizedName]) {
      return { success: false, reason: 'Workflow with this name already exists' };
    }

    if (!WORKFLOW_CATEGORIES.has(category)) {
      category = 'custom';
    }

    const normalizedCommands = commands.map(cmd => this._normalizeCommand(cmd)).filter(Boolean);
    if (normalizedCommands.length < MIN_SEQUENCE_LENGTH) {
      return { success: false, reason: 'Invalid commands' };
    }
    const blocked = normalizedCommands.find(command =>
      !LearningGuard.isAllowedLearning('workflow', 'command', command).allowed
    );
    if (blocked) return { success: false, reason: 'Workflow contains sensitive data' };

    const signature = this._createSequenceSignature(normalizedCommands);
    this.sequenceBuffer.delete(signature);

    this.data.workflows[normalizedName] = {
      name: normalizedName,
      commands: normalizedCommands,
      category: category,
      useCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUsed: null
    };
    
    this.data.metadata.totalCreated = (this.data.metadata.totalCreated || 0) + 1;
    this.data.metadata.updatedAt = new Date().toISOString();
    
    this._pruneWorkflows();
    const saved = this._save();
    return saved
      ? { success: true, name: normalizedName, commands: normalizedCommands }
      : { success: false, reason: 'Could not safely persist workflow' };
  }

  executeWorkflow(name) {
    const normalizedName = this._normalizeWorkflowName(name);
    if (!normalizedName) return null;
    
    const workflow = this.data.workflows[normalizedName];
    if (!workflow) return null;

    workflow.useCount = (workflow.useCount || 0) + 1;
    workflow.lastUsed = new Date().toISOString();
    workflow.updatedAt = new Date().toISOString();
    this._save();
    
    return {
      found: true,
      name: normalizedName,
      commands: [...workflow.commands]
    };
  }

  getWorkflow(name) {
    const normalizedName = this._normalizeWorkflowName(name);
    if (!normalizedName) return null;
    const workflow = this.data.workflows[normalizedName];
    return workflow ? { ...workflow, commands: [...workflow.commands], name: normalizedName } : null;
  }

  getAllWorkflows() {
    const result = {};
    for (const [name, workflow] of Object.entries(this.data.workflows || {})) {
      result[name] = { ...workflow, commands: [...workflow.commands], name };
    }
    return result;
  }

  removeWorkflow(name) {
    const normalizedName = this._normalizeWorkflowName(name);
    if (!normalizedName) return false;
    if (!this.data.workflows[normalizedName]) return false;
    delete this.data.workflows[normalizedName];
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save();
  }

  updateWorkflow(name, newCommands) {
    const normalizedName = this._normalizeWorkflowName(name);
    if (!normalizedName) return { success: false, reason: 'Invalid name' };

    const workflow = this.data.workflows[normalizedName];
    if (!workflow) return { success: false, reason: 'Workflow not found' };

    if (!Array.isArray(newCommands) || newCommands.length < MIN_SEQUENCE_LENGTH) {
      return { success: false, reason: 'Workflow must have at least 2 commands' };
    }
    if (newCommands.length > MAX_WORKFLOW_LENGTH) {
      return { success: false, reason: `Workflow cannot exceed ${MAX_WORKFLOW_LENGTH} commands` };
    }

    const normalizedCommands = newCommands.map(cmd => this._normalizeCommand(cmd)).filter(Boolean);
    if (normalizedCommands.length < MIN_SEQUENCE_LENGTH) {
      return { success: false, reason: 'Invalid commands' };
    }
    const blocked = normalizedCommands.find(command =>
      !LearningGuard.isAllowedLearning('workflow', 'command', command).allowed
    );
    if (blocked) return { success: false, reason: 'Workflow contains sensitive data' };

    workflow.commands = normalizedCommands;
    workflow.updatedAt = new Date().toISOString();
    this.data.metadata.updatedAt = new Date().toISOString();
    return this._save()
      ? { success: true, name: normalizedName, commands: [...normalizedCommands] }
      : { success: false, reason: 'Could not safely persist workflow' };
  }

  getWorkflowsByCategory(category) {
    if (!WORKFLOW_CATEGORIES.has(category)) return {};
    const result = {};
    for (const [name, workflow] of Object.entries(this.data.workflows || {})) {
      if (workflow.category === category) {
        result[name] = { ...workflow, name };
      }
    }
    return result;
  }

  getRecentWorkflows(limit = 10) {
    const workflows = Object.entries(this.data.workflows || {})
      .map(([name, w]) => ({ name, ...w }))
      .filter(w => w.lastUsed)
      .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
      .slice(0, limit);
    return workflows;
  }

  getFrequentWorkflows(limit = 10) {
    const workflows = Object.entries(this.data.workflows || {})
      .map(([name, w]) => ({ name, ...w }))
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
      .slice(0, limit);
    return workflows;
  }

  getPendingSuggestions() {
    const suggestions = [];
    for (const data of this.sequenceBuffer.values()) {
      if (data.count >= MIN_OCCURRENCES_TO_SUGGEST) {
        const suggestedName = this._generateWorkflowName(data.commands);
        suggestions.push({
          suggestedName,
          commands: [...data.commands],
          count: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          suggestion: `I noticed you often run these commands together: ${data.commands.slice(0, 3).join(', ')}${data.commands.length > 3 ? '...' : ''}. Would you like to save this as a workflow?`
        });
      }
    }
    return suggestions;
  }

  clearSequenceBuffer() {
    this.sequenceBuffer.clear();
  }

  _findWorkflowBySignature(signature) {
    for (const [name, workflow] of Object.entries(this.data.workflows || {})) {
      const workflowSignature = this._createSequenceSignature(workflow.commands);
      if (workflowSignature === signature) {
        return name;
      }
    }
    return null;
  }

  _generateWorkflowName(commands) {
    const firstCmd = commands[0] || 'workflow';
    const cleaned = firstCmd.replace(/[^a-z0-9]/g, '_').substring(0, 20);
    return cleaned || 'workflow';
  }

  _pruneWorkflows() {
    const workflows = this.data.workflows;
    const keys = Object.keys(workflows);
    
    if (keys.length <= MAX_WORKFLOWS) {
      return;
    }

    const sorted = keys.sort((a, b) => {
      const aUses = workflows[a]?.useCount || 0;
      const bUses = workflows[b]?.useCount || 0;
      return bUses - aUses;
    });

    const keep = new Set(sorted.slice(0, MAX_WORKFLOWS));
    
    for (const key of keys) {
      if (!keep.has(key)) {
        delete workflows[key];
      }
    }
  }

  getMetadata() {
    return { ...this.data.metadata };
  }

  getStats() {
    return {
      totalWorkflows: Object.keys(this.data.workflows || {}).length,
      pendingSuggestions: this.sequenceBuffer.size,
      byCategory: Object.values(this.data.workflows || {}).reduce((acc, w) => {
        acc[w.category] = (acc[w.category] || 0) + 1;
        return acc;
      }, {}),
      metadata: this.data.metadata
    };
  }
}

module.exports = WorkflowStore;
