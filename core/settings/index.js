const fs = require('fs');
const path = require('path');
const { ContactStore, normalizePhoneNumber } = require('../automation/communications/contact-store');

const CHAT_THEMES = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    colors: {
      panel: 'rgba(20, 20, 40, 0.92)',
      surface: 'rgba(22, 33, 62, 0.7)',
      surfaceStrong: 'rgba(15, 52, 96, 0.7)',
      border: 'rgba(255, 255, 255, 0.08)',
      text: '#e0e0e0',
      muted: 'rgba(255, 255, 255, 0.55)',
      accent: 'rgba(68, 136, 255, 0.9)'
    }
  },
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    colors: {
      panel: 'rgba(48, 28, 32, 0.94)',
      surface: 'rgba(108, 58, 52, 0.72)',
      surfaceStrong: 'rgba(181, 92, 68, 0.72)',
      border: 'rgba(255, 226, 201, 0.16)',
      text: '#fff4ea',
      muted: 'rgba(255, 244, 234, 0.62)',
      accent: 'rgba(255, 148, 92, 0.95)'
    }
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    colors: {
      panel: 'rgba(18, 42, 36, 0.94)',
      surface: 'rgba(28, 69, 58, 0.74)',
      surfaceStrong: 'rgba(40, 110, 88, 0.78)',
      border: 'rgba(214, 255, 234, 0.12)',
      text: '#ecfff6',
      muted: 'rgba(236, 255, 246, 0.6)',
      accent: 'rgba(92, 214, 165, 0.95)'
    }
  },
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    colors: {
      panel: 'rgba(34, 36, 44, 0.95)',
      surface: 'rgba(57, 62, 74, 0.72)',
      surfaceStrong: 'rgba(86, 93, 112, 0.78)',
      border: 'rgba(255, 255, 255, 0.12)',
      text: '#f1f3f7',
      muted: 'rgba(241, 243, 247, 0.58)',
      accent: 'rgba(120, 179, 255, 0.95)'
    }
  }
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  const base = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) {
    return base;
  }

  Object.entries(source).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      base[key] = deepMerge(base[key], value);
      return;
    }

    base[key] = Array.isArray(value) ? [...value] : value;
  });

  return base;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeActivationShortcut(value, fallback = 'Alt+Space') {
  const normalizedFallback = String(fallback || 'Alt+Space').trim() || 'Alt+Space';
  const raw = String(value || '').trim();
  if (!raw) {
    return normalizedFallback;
  }

  const modifierMap = {
    alt: 'Alt',
    option: 'Alt',
    ctrl: 'Control',
    control: 'Control',
    cmd: 'Command',
    command: 'Command',
    cmdorctrl: 'CommandOrControl',
    commandorcontrol: 'CommandOrControl',
    shift: 'Shift',
    super: 'Super',
    meta: 'Super',
    win: 'Super',
    windows: 'Super'
  };
  const validKeys = new Set([
    'Space',
    'Tab',
    'Enter',
    'Escape',
    'Esc',
    'Backspace',
    'Delete',
    'Insert',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Up',
    'Down',
    'Left',
    'Right',
    'Plus',
    'Minus'
  ]);
  const parts = raw
    .split(/\s*\+\s*/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return normalizedFallback;
  }

  const modifiers = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierMap[part.toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) {
      return normalizedFallback;
    }
    modifiers.push(modifier);
  }

  const rawKey = parts[parts.length - 1];
  let key = '';
  if (/^[a-z]$/i.test(rawKey)) {
    key = rawKey.toUpperCase();
  } else if (/^[0-9]$/.test(rawKey)) {
    key = rawKey;
  } else if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(rawKey)) {
    key = rawKey.toUpperCase();
  } else if (rawKey.toLowerCase() === 'spacebar') {
    key = 'Space';
  } else {
    key = rawKey
      .split(/[\s_-]+/)
      .map(token => token ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : '')
      .join('');
  }

  if (!key || modifierMap[key.toLowerCase()] || !validKeys.has(key) && !/^[A-Z0-9]$/.test(key) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return normalizedFallback;
  }

  return `${modifiers.join('+')}+${key}`;
}

class SettingsService {
  constructor(baseConfig) {
    this.baseConfig = deepClone(baseConfig || {});
    this.settingsPath = path.join(
      this.baseConfig?.app?.dataDir || process.cwd(),
      'settings.json'
    );
    this.contactStore = new ContactStore(baseConfig);
    this.defaults = {
      assistant: {
        displayName: String(baseConfig?.assistant?.displayName || baseConfig?.app?.name || 'JARVIS').trim(),
        title: String(baseConfig?.assistant?.title || 'Desktop Assistant').trim(),
        honorific: String(baseConfig?.assistant?.honorific || 'sir').trim().toLowerCase()
      },
      userProfile: {
        fullName: String(baseConfig?.assistant?.userProfile?.fullName || '').trim(),
        email: String(baseConfig?.assistant?.userProfile?.email || '').trim(),
        phone: normalizePhoneNumber(baseConfig?.assistant?.userProfile?.phone || ''),
        addressLine1: String(baseConfig?.assistant?.userProfile?.addressLine1 || '').trim(),
        city: String(baseConfig?.assistant?.userProfile?.city || '').trim(),
        state: String(baseConfig?.assistant?.userProfile?.state || '').trim(),
        postalCode: String(baseConfig?.assistant?.userProfile?.postalCode || '').trim(),
        country: String(baseConfig?.assistant?.userProfile?.country || '').trim(),
        company: String(baseConfig?.assistant?.userProfile?.company || '').trim(),
        role: String(baseConfig?.assistant?.userProfile?.role || '').trim()
      },
      voice: {
        activationShortcut: normalizeActivationShortcut(baseConfig?.voice?.activationShortcut, 'Alt+Space'),
        tts: {
          rate: clampNumber(baseConfig?.voice?.tts?.rate, -10, 10, 0),
          volume: clampNumber(baseConfig?.voice?.tts?.volume, 0, 100, 100),
          voiceName: String(baseConfig?.voice?.tts?.voiceName || '').trim(),
          naturalize: baseConfig?.voice?.tts?.naturalize !== false
        }
      },
      orb: {
        defaultSize: clampNumber(baseConfig?.orb?.defaultSize, 32, 128, 64),
        defaultOpacity: clampNumber(baseConfig?.orb?.defaultOpacity, 0.2, 1, 0.85),
        alwaysOnTop: true
      },
      system: {
        volumeStep: clampNumber(baseConfig?.system?.volumeStep, 1, 20, 5),
        permissionLevel: 'medium'
      },
      chat: {
        themeId: String(baseConfig?.chat?.activeTheme || 'midnight').trim(),
        maxHistory: clampNumber(baseConfig?.chat?.maxHistory, 50, 2000, 500)
      }
    };
  }

  ensureStoreExists() {
    const directory = path.dirname(this.settingsPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(this.settingsPath)) {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.defaults, null, 2), 'utf8');
    }
  }

  loadRaw() {
    this.ensureStoreExists();
    const source = fs.readFileSync(this.settingsPath, 'utf8').trim();
    if (!source) {
      return {};
    }

    try {
      const parsed = JSON.parse(source);
      return isPlainObject(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  getSettings() {
    return this._sanitizeSettings(deepMerge(this.defaults, this.loadRaw()));
  }

  saveSettings(partialSettings) {
    const current = this.getSettings();
    const next = this._sanitizeSettings(deepMerge(current, partialSettings || {}));
    this.ensureStoreExists();
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  resetSettings() {
    const next = this._sanitizeSettings(deepClone(this.defaults));
    this.ensureStoreExists();
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  getSnapshot() {
    const settings = this.getSettings();
    return {
      settings,
      contacts: this.contactStore.listContacts(),
      contactsPath: this.contactStore.contactsPath,
      availableThemes: Object.values(CHAT_THEMES)
    };
  }

  saveContact(contact) {
    return this.contactStore.saveContact(contact);
  }

  deleteContact(name) {
    return this.contactStore.deleteContact(name);
  }

  buildRuntimeConfig() {
    const settings = this.getSettings();
    const runtimeConfig = deepClone(this.baseConfig);

    runtimeConfig.assistant = runtimeConfig.assistant || {};
    runtimeConfig.assistant.displayName = settings.assistant.displayName;
    runtimeConfig.assistant.title = settings.assistant.title;
    runtimeConfig.assistant.honorific = settings.assistant.honorific;
    runtimeConfig.assistant.userProfile = deepClone(settings.userProfile);

    runtimeConfig.voice = runtimeConfig.voice || {};
    runtimeConfig.voice.activationMode = 'hotkey';
    runtimeConfig.voice.activationShortcut = settings.voice.activationShortcut;
    runtimeConfig.voice.allowManualActivation = true;
    runtimeConfig.voice.tts = runtimeConfig.voice.tts || {};
    runtimeConfig.voice.tts.rate = settings.voice.tts.rate;
    runtimeConfig.voice.tts.volume = settings.voice.tts.volume;
    runtimeConfig.voice.tts.voiceName = settings.voice.tts.voiceName;
    runtimeConfig.voice.tts.naturalize = settings.voice.tts.naturalize;

    runtimeConfig.orb = runtimeConfig.orb || {};
    runtimeConfig.orb.defaultSize = settings.orb.defaultSize;
    runtimeConfig.orb.defaultOpacity = settings.orb.defaultOpacity;
    runtimeConfig.orb.alwaysOnTop = settings.orb.alwaysOnTop;

    runtimeConfig.system = runtimeConfig.system || {};
    runtimeConfig.system.volumeStep = settings.system.volumeStep;
    runtimeConfig.system.permissionLevel = settings.system.permissionLevel;

    runtimeConfig.chat = runtimeConfig.chat || {};
    runtimeConfig.chat.maxHistory = settings.chat.maxHistory;
    runtimeConfig.chat.activeTheme = settings.chat.themeId;

    return runtimeConfig;
  }

  _sanitizeSettings(input) {
    const source = isPlainObject(input) ? input : {};
    const themeId = CHAT_THEMES[source.chat?.themeId] ? source.chat.themeId : this.defaults.chat.themeId;
    const honorific = ['sir', 'master', 'boss', 'commander'].includes(String(source.assistant?.honorific || '').trim().toLowerCase())
      ? String(source.assistant.honorific).trim().toLowerCase()
      : this.defaults.assistant.honorific;

    return {
      assistant: {
        displayName: String(source.assistant?.displayName || this.defaults.assistant.displayName).trim() || this.defaults.assistant.displayName,
        title: String(source.assistant?.title || this.defaults.assistant.title).trim() || this.defaults.assistant.title,
        honorific
      },
      userProfile: {
        fullName: String(source.userProfile?.fullName || '').trim(),
        email: String(source.userProfile?.email || '').trim(),
        phone: normalizePhoneNumber(source.userProfile?.phone || ''),
        addressLine1: String(source.userProfile?.addressLine1 || '').trim(),
        city: String(source.userProfile?.city || '').trim(),
        state: String(source.userProfile?.state || '').trim(),
        postalCode: String(source.userProfile?.postalCode || '').trim(),
        country: String(source.userProfile?.country || '').trim(),
        company: String(source.userProfile?.company || '').trim(),
        role: String(source.userProfile?.role || '').trim()
      },
      voice: {
        activationShortcut: normalizeActivationShortcut(
          source.voice?.activationShortcut,
          this.defaults.voice.activationShortcut
        ),
        tts: {
          rate: clampNumber(source.voice?.tts?.rate, -10, 10, this.defaults.voice.tts.rate),
          volume: clampNumber(source.voice?.tts?.volume, 0, 100, this.defaults.voice.tts.volume),
          voiceName: String(source.voice?.tts?.voiceName || '').trim(),
          naturalize: source.voice?.tts?.naturalize !== false
        }
      },
      orb: {
        defaultSize: clampNumber(source.orb?.defaultSize, 32, 128, this.defaults.orb.defaultSize),
        defaultOpacity: clampNumber(source.orb?.defaultOpacity, 0.2, 1, this.defaults.orb.defaultOpacity),
        alwaysOnTop: source.orb?.alwaysOnTop !== false
      },
      system: {
        volumeStep: clampNumber(source.system?.volumeStep, 1, 20, this.defaults.system.volumeStep),
        permissionLevel: ['low', 'medium', 'high', 'critical'].includes(String(source.system?.permissionLevel || '').trim().toLowerCase())
          ? String(source.system.permissionLevel).trim().toLowerCase()
          : this.defaults.system.permissionLevel
      },
      chat: {
        themeId,
        maxHistory: clampNumber(source.chat?.maxHistory, 50, 2000, this.defaults.chat.maxHistory)
      }
    };
  }
}

module.exports = {
  SettingsService,
  CHAT_THEMES
};
