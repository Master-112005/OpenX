class NaturalLanguageExecution {
  constructor(automationEngine) {
    this.automation = automationEngine;
  }

  execute(actionId, entities = {}, context = {}) {
    if (actionId === 'assistant.learningRepair') {
      return Promise.resolve({
        success: true,
        needsAssistantHandling: true,
        data: { entities, context },
        response: entities.correction
          ? 'I understood the replacement for the incorrect learning.'
          : 'Tell me what I should learn instead.'
      });
    }
    if (!this.automation || typeof this.automation.execute !== 'function') {
      return Promise.resolve({ success: false, error: 'Automation engine is unavailable' });
    }
    return this.automation.execute(actionId, entities, context);
  }
}

module.exports = NaturalLanguageExecution;
