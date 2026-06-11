const Normalizer = require('../../shared/index').Normalizer;

const TRUSTED_WEB_TARGETS = {
  chatgpt: { title: 'ChatGPT', url: 'https://chatgpt.com/' },
  'claude ai': { title: 'Claude', url: 'https://claude.ai/' },
  'google gemini': { title: 'Google Gemini', url: 'https://gemini.google.com/' },
  'perplexity ai': { title: 'Perplexity', url: 'https://www.perplexity.ai/' },
  github: { title: 'GitHub', url: 'https://github.com/' },
  gmail: { title: 'Gmail', url: 'https://mail.google.com/' },
  'google maps': { title: 'Google Maps', url: 'https://maps.google.com/' },
  'google photos': { title: 'Google Photos', url: 'https://photos.google.com/' },
  'google drive': { title: 'Google Drive', url: 'https://drive.google.com/' },
  'google docs': { title: 'Google Docs', url: 'https://docs.google.com/' },
  'google colab': { title: 'Google Colab', url: 'https://colab.research.google.com/' },
  notion: { title: 'Notion', url: 'https://www.notion.so/' },
  canva: { title: 'Canva', url: 'https://www.canva.com/' },
  figma: { title: 'Figma', url: 'https://www.figma.com/' }
};

const WEB_TARGET_ALIASES = {
  chatgpt: 'chatgpt',
  'chat gpt': 'chatgpt',
  'openai chatgpt': 'chatgpt',
  'open ai chatgpt': 'chatgpt',
  claude: 'claude ai',
  gemini: 'google gemini',
  perplexity: 'perplexity ai',
  github: 'github',
  gmail: 'gmail',
  mail: 'gmail',
  'google mail': 'gmail',
  maps: 'google maps',
  'google maps': 'google maps',
  photos: 'google photos',
  photes: 'google photos',
  photesw: 'google photos',
  phots: 'google photos',
  'google photos': 'google photos',
  'google photes': 'google photos',
  'google phots': 'google photos',
  drive: 'google drive',
  'google drive': 'google drive',
  docs: 'google docs',
  'google docs': 'google docs',
  colab: 'google colab',
  collab: 'google colab',
  'google colab': 'google colab',
  'google collab': 'google colab',
  'google colaboratory': 'google colab',
  notion: 'notion',
  canva: 'canva',
  figma: 'figma'
};

function normalizeWebTarget(value, options = {}) {
  const target = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\b(?:website|web\s+app|site)\b/g, ' ')
    .replace(options.keepAppWord ? /\s+/g : /\bapp\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!target) {
    return null;
  }

  if (WEB_TARGET_ALIASES[target]) {
    return WEB_TARGET_ALIASES[target];
  }

  const fuzzy = Normalizer.findClosestOption(target, Object.keys(WEB_TARGET_ALIASES), {
    minSimilarity: 0.78,
    maxDistance: 2
  });
  return fuzzy ? WEB_TARGET_ALIASES[fuzzy.normalizedMatch] : null;
}

function resolveTrustedWebTarget(value) {
  const key = normalizeWebTarget(value);
  const target = key ? TRUSTED_WEB_TARGETS[key] : null;
  return target ? { key, ...target } : null;
}

module.exports = {
  TRUSTED_WEB_TARGETS,
  WEB_TARGET_ALIASES,
  normalizeWebTarget,
  resolveTrustedWebTarget
};
