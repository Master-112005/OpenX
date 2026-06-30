'use strict';

const { DictionaryLoadFailureError } = require('./NormalizationErrors');

const DEFAULT_DICTIONARIES = Object.freeze({
  applications: Object.freeze({
    'vs code': 'VS Code',
    'visual studio code': 'VS Code',
    'chrome browser': 'Google Chrome',
    chrome: 'Google Chrome',
    'edge browser': 'Microsoft Edge',
    edge: 'Microsoft Edge',
    'file explorer': 'File Explorer',
    powershell: 'PowerShell',
    'github desktop': 'GitHub Desktop'
  }),
  technologies: Object.freeze({
    'git hub': 'GitHub',
    github: 'GitHub',
    wifi: 'Wi-Fi',
    'wi fi': 'Wi-Fi',
    'usb c': 'USB-C',
    'node js': 'Node.js',
    'electron js': 'Electron',
    electron: 'Electron',
    npm: 'npm'
  }),
  acronyms: Object.freeze({
    'c p u': 'CPU',
    cpu: 'CPU',
    'g p u': 'GPU',
    gpu: 'GPU',
    ram: 'RAM',
    usb: 'USB',
    api: 'API',
    cli: 'CLI',
    dns: 'DNS',
    url: 'URL',
    json: 'JSON',
    http: 'HTTP',
    https: 'HTTPS'
  }),
  commands: Object.freeze({
    'shut down': 'Shut down',
    'log in': 'Log in',
    'sign in': 'Sign in'
  }),
  openx: Object.freeze({
    openx: 'OpenX',
    jaanu: 'OpenX'
  })
});

/**
 * Purpose: Centralizes deterministic transcript replacement dictionaries.
 * Responsibility: Store categorized application, technology, acronym, command, and OpenX terminology mappings.
 * Dependencies: NormalizationErrors for dictionary failures.
 * Pipeline position: Dictionary source used by dedicated normalizer stages.
 * Future extension notes: Add deterministic entries here instead of scattering replacements across files.
 */
class DictionaryNormalizer {
  /**
   * Create a dictionary normalizer.
   * @param {{dictionaries?: object}} options Dictionary options.
   */
  constructor(options = {}) {
    try {
      this.dictionaries = {
        applications: { ...DEFAULT_DICTIONARIES.applications, ...(options.dictionaries?.applications || {}) },
        technologies: { ...DEFAULT_DICTIONARIES.technologies, ...(options.dictionaries?.technologies || {}) },
        acronyms: { ...DEFAULT_DICTIONARIES.acronyms, ...(options.dictionaries?.acronyms || {}) },
        commands: { ...DEFAULT_DICTIONARIES.commands, ...(options.dictionaries?.commands || {}) },
        openx: { ...DEFAULT_DICTIONARIES.openx, ...(options.dictionaries?.openx || {}) }
      };
    } catch (error) {
      throw new DictionaryLoadFailureError('Transcript normalization dictionaries failed to load.', {
        details: { error: error.message }
      });
    }
  }

  /**
   * Return a dictionary category.
   * @param {string} category Dictionary category.
   * @returns {object}
   */
  getCategory(category) {
    return { ...(this.dictionaries[category] || {}) };
  }

  /**
   * Apply all dictionary categories in deterministic order.
   * @param {string} text Input text.
   * @returns {{text: string, transformations: object[]}}
   */
  normalize(text) {
    let next = String(text || '');
    const transformations = [];
    for (const category of ['commands', 'technologies', 'applications', 'acronyms', 'openx']) {
      const result = DictionaryNormalizer.applyDictionary(next, this.getCategory(category), category);
      next = result.text;
      transformations.push(...result.transformations);
    }
    return { text: next, transformations };
  }

  /**
   * Apply a dictionary to text using phrase boundaries.
   * @param {string} text Input text.
   * @param {object} dictionary Replacement dictionary.
   * @param {string} category Category name.
   * @returns {{text: string, transformations: object[]}}
   */
  static applyDictionary(text, dictionary, category = 'dictionary') {
    let next = String(text || '');
    const transformations = [];
    const entries = Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length);
    if (entries.length === 0) {
      return { text: next, transformations };
    }

    const lookup = new Map(entries.map(([source, replacement]) => [source.toLowerCase(), { source, replacement }]));
    const escapedEntries = entries.map(([source]) => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`\\b(${escapedEntries.join('|')})\\b`, 'gi');
    const seen = new Set();

    next = next.replace(pattern, match => {
      const entry = lookup.get(match.toLowerCase());
      if (!entry) {
        return match;
      }
      const key = `${entry.source}->${entry.replacement}`;
      if (!seen.has(key)) {
        seen.add(key);
        transformations.push({ stage: category, from: entry.source, to: entry.replacement });
      }
      return entry.replacement;
    });

    return { text: next, transformations };
  }
}

DictionaryNormalizer.DEFAULT_DICTIONARIES = DEFAULT_DICTIONARIES;

module.exports = DictionaryNormalizer;
