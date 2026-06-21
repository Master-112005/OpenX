class Personality {
  constructor(config) {
    this.config = config;
    this.persona = {
      name: config?.assistant?.displayName,
      title: 'Desktop Assistant',
      greeting: 'How may I assist you, sir?',
      farewell: 'Awaiting your next command, sir.',
      error: 'Unable to complete that request, sir.',
      style: 'professional'
    };

    this.titles = {
      generic: 'sir',
      professional: 'sir',
      casual: 'sir'
    };
  }

  get title() {
    return this.titles[this.persona.style] || 'sir';
  }

  applyToResponse(response) {
    if (!response) return '';

    let result = String(response).replace(/\s+/g, ' ').trim();

    if (result.includes('{title}')) {
      result = result.replace(/{title}/g, this.title);
    }

    if (!result) return '';
    return result;
  }

  getPersona() {
    return { ...this.persona };
  }

  setStyle(style) {
    if (this.titles[style]) {
      this.persona.style = style;
      return true;
    }
    return false;
  }
}

module.exports = Personality;
