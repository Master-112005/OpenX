class NaturalLanguageExecution {
  constructor(automationEngine) {
    this.automation = automationEngine;
  }

  execute(actionId, entities = {}, context = {}) {
    if (!this.automation || typeof this.automation.execute !== 'function') {
      return Promise.resolve({ success: false, error: 'Automation engine is unavailable' });
    }
    return this.automation.execute(actionId, entities, context);
  }
}

module.exports = NaturalLanguageExecution;
