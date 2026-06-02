'use strict';

const Fuse = require('fuse.js');
const { doubleMetaphone } = require('./phonetic');

const DEFAULT_PLATFORM = 'youtube';

const PLATFORMS = Object.freeze([
  {
    id: 'youtube',
    name: 'YouTube',
    aliases: ['youtube', 'you tube', 'yt', 'tube', 'browser playback']
  },
  {
    id: 'spotify',
    name: 'Spotify',
    aliases: ['spotify', 'spoti fy', 'spotyfy', 'spotifie']
  },
  {
    id: 'local',
    name: 'local media',
    aliases: ['local', 'local media', 'my music', 'offline music']
  },
  {
    id: 'browser',
    name: 'browser playback',
    aliases: ['browser', 'chrome', 'edge', 'firefox']
  }
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phonetic(value) {
  return doubleMetaphone(normalize(value)).filter(Boolean);
}

class PlatformMapper {
  constructor(options = {}) {
    this.defaultPlatform = options.defaultPlatform || DEFAULT_PLATFORM;
    this.platforms = options.platforms || PLATFORMS;
    this.entries = this.platforms.flatMap(platform => {
      return [platform.id, platform.name, ...(platform.aliases || [])].map(alias => ({
        platform,
        label: normalize(alias),
        codes: phonetic(alias)
      }));
    });
    this.fuse = new Fuse(this.entries, {
      keys: ['label'],
      includeScore: true,
      threshold: 0.35,
      ignoreLocation: true
    });
  }

  normalizePlatform(input) {
    const source = normalize(input);
    if (!source) return null;

    const exact = this.entries.find(entry => entry.label === source);
    if (exact) {
      return { platform: exact.platform.id, confidence: 1, reason: 'exact' };
    }

    const sourceCodes = phonetic(source);
    const phoneticMatch = this.entries.find(entry => {
      return entry.codes.some(code => sourceCodes.includes(code));
    });
    if (phoneticMatch) {
      return { platform: phoneticMatch.platform.id, confidence: 0.91, reason: 'phonetic' };
    }

    const result = this.fuse.search(source, { limit: 1 })[0];
    if (!result || 1 - result.score < 0.72) {
      return null;
    }

    return {
      platform: result.item.platform.id,
      confidence: Number((1 - result.score).toFixed(2)),
      reason: 'fuzzy'
    };
  }

  infer(explicitPlatform, context = {}) {
    const explicit = this.normalizePlatform(explicitPlatform);
    if (explicit) return explicit;

    const runningApps = Array.isArray(context.runningApps) ? context.runningApps : [];
    const activeApp = normalize(context.activeApp);
    const activeTitle = normalize(context.activeTitle);
    const currentMode = String(context.currentMode || '').toUpperCase();
    const appText = normalize([activeApp, activeTitle, ...runningApps].join(' '));

    if (currentMode === 'MEDIA_MODE') {
      if (appText.includes('spotify')) {
        return { platform: 'spotify', confidence: 0.88, reason: 'media-mode-spotify' };
      }
      if (appText.includes('youtube') || appText.includes('chrome') || appText.includes('msedge')) {
        return { platform: 'youtube', confidence: 0.86, reason: 'media-mode-browser' };
      }
    }

    if (appText.includes('spotify')) {
      return { platform: 'spotify', confidence: 0.86, reason: 'running-app' };
    }

    if (activeApp.includes('chrome') || activeApp.includes('msedge') || activeApp.includes('firefox')) {
      return { platform: 'youtube', confidence: 0.82, reason: 'active-browser' };
    }

    return { platform: this.defaultPlatform, confidence: 0.75, reason: 'default' };
  }
}

module.exports = {
  DEFAULT_PLATFORM,
  PLATFORMS,
  PlatformMapper,
  normalize
};
