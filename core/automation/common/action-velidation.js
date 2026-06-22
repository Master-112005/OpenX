class ActionValidation {
  validate(intent, entities = {}) {
    const required = Array.isArray(intent?.entities)
      ? intent.entities.filter(entity => entity.required).map(entity => entity.name)
      : [];
    const missing = required.filter(name => entities[name] === undefined || entities[name] === null || entities[name] === '');
    return {
      valid: missing.length === 0,
      status: missing.length === 0 ? 'passed' : 'failed',
      missing
    };
  }
}

module.exports = ActionValidation;
