const fs = require('fs');
const path = require('path');
const { ContactStore, normalizePhoneNumber } = require('../automation/communications/contact-store');
const { ensureDataRoot, migrateLegacyData, readJsonFile, writeJsonAtomic } = require('../shared/data-root');

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

function splitInstructionList(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]+/);

  return Array.from(new Set(source
    .map(item => String(item || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)))
    .slice(0, 12);
}

function sanitizeModeAppEntries(entry) {
  const rawApps = Array.isArray(entry.apps)
    ? entry.apps
    : String(entry.apps || '').split(/[\n,]+/);
  const apps = [];
  const seenApps = new Set();

  rawApps.forEach(appEntry => {
    const isObjectEntry = isPlainObject(appEntry);
    const appName = String(isObjectEntry ? (appEntry.name || appEntry.appName || '') : appEntry || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!appName) {
      return;
    }

    const normalizedAppName = appName.toLowerCase();
    if (seenApps.has(normalizedAppName) || apps.length >= 5) {
      return;
    }

    seenApps.add(normalizedAppName);
    apps.push({
      name: appName,
      instructions: splitInstructionList(isObjectEntry ? (appEntry.instructions || appEntry.commands || '') : '')
    });
  });

  return apps;
}

function sanitizeModes(value) {
  const source = Array.isArray(value) ? value : [];
  const modes = [];
  const seenNames = new Set();

  source.forEach((entry, index) => {
    if (!isPlainObject(entry) || modes.length >= 5) {
      return;
    }

    const name = String(entry.name || '').trim().replace(/\s+/g, ' ');
    if (!name) {
      return;
    }

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      return;
    }

    const apps = sanitizeModeAppEntries(entry);
    const commands = splitInstructionList(entry.commands || entry.instructions || '');

    seenNames.add(normalizedName);
    modes.push({
      id: String(entry.id || `mode-${index + 1}`).trim() || `mode-${index + 1}`,
      name,
      apps,
      commands
    });
  });

  return modes;
}

function normalizeTtsRate(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === -1) {
    return fallback;
  }

  return clampNumber(number, -10, 10, fallback);
}

class SettingsService {
  constructor(baseConfig) {
    this.baseConfig = deepClone(baseConfig || {});
    this.dataPaths = ensureDataRoot(this.baseConfig);
    if (this.baseConfig?.app?.migrateLegacyData) {
      migrateLegacyData(this.baseConfig);
    }

    this.baseConfig.app = this.baseConfig.app || {};
    this.baseConfig.app.dataDir = this.dataPaths.root;
    this.baseConfig.app.dataPaths = deepClone(this.dataPaths);
    this.baseConfig.assistant = this.baseConfig.assistant || {};
    this.baseConfig.assistant.contactsPath = this.baseConfig.assistant.contactsPath || this.dataPaths.contactsPath;
    this.baseConfig.activeLearning = this.baseConfig.activeLearning || {};
    this.baseConfig.activeLearning.storePath = this.baseConfig.activeLearning.storePath || this.dataPaths.learningPath;
    this.baseConfig.logging = this.baseConfig.logging || {};
    this.baseConfig.logging.directory = this.baseConfig.logging.directory || this.dataPaths.logsDir;

    this.settingsPath = this.dataPaths.settingsPath;
    this.contactStore = new ContactStore(this.baseConfig);
    this.defaults = {
      assistant: {
        displayName: String(this.baseConfig?.assistant?.displayName || this.baseConfig?.app?.name || 'JARVIS').trim(),
        title: String(this.baseConfig?.assistant?.title || 'Desktop Assistant').trim(),
        honorific: String(this.baseConfig?.assistant?.honorific || 'sir').trim().toLowerCase()
      },
      userProfile: {
        fullName: String(this.baseConfig?.assistant?.userProfile?.fullName || '').trim(),
        email: String(this.baseConfig?.assistant?.userProfile?.email || '').trim(),
        phone: normalizePhoneNumber(this.baseConfig?.assistant?.userProfile?.phone || ''),
        addressLine1: String(this.baseConfig?.assistant?.userProfile?.addressLine1 || '').trim(),
        city: String(this.baseConfig?.assistant?.userProfile?.city || '').trim(),
        state: String(this.baseConfig?.assistant?.userProfile?.state || '').trim(),
        postalCode: String(this.baseConfig?.assistant?.userProfile?.postalCode || '').trim(),
        country: String(this.baseConfig?.assistant?.userProfile?.country || '').trim(),
        company: String(this.baseConfig?.assistant?.userProfile?.company || '').trim(),
        role: String(this.baseConfig?.assistant?.userProfile?.role || '').trim()
      },
      voice: {
        tts: {
          rate: clampNumber(this.baseConfig?.voice?.tts?.rate, -10, 10, 0),
          volume: clampNumber(this.baseConfig?.voice?.tts?.volume, 0, 100, 100),
          voiceName: String(this.baseConfig?.voice?.tts?.voiceName || '').trim(),
          naturalize: this.baseConfig?.voice?.tts?.naturalize !== false
        }
      },
      system: {
        volumeStep: clampNumber(this.baseConfig?.system?.volumeStep, 1, 20, 5),
        permissionLevel: 'medium'
      },
      activeLearning: {
        enabled: this.baseConfig?.activeLearning?.enabled !== false,
        askForFeedback: this.baseConfig?.activeLearning?.askForFeedback !== false
      },
      chat: {
        activationShortcut: normalizeActivationShortcut(this.baseConfig?.chat?.activationShortcut, 'Alt+Space'),
        themeId: String(this.baseConfig?.chat?.activeTheme || 'midnight').trim(),
        maxHistory: clampNumber(this.baseConfig?.chat?.maxHistory, 50, 2000, 500)
      },
      modes: []
    };
  }

  ensureStoreExists() {
    const directory = path.dirname(this.settingsPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(this.settingsPath)) {
      writeJsonAtomic(this.settingsPath, this.defaults, { backup: false });
    }
  }

  loadRaw() {
    this.ensureStoreExists();
    const parsed = readJsonFile(this.settingsPath, {}, { createIfMissing: true });
    return isPlainObject(parsed) ? parsed : {};
  }

  getSettings() {
    return this._sanitizeSettings(deepMerge(this.defaults, this.loadRaw()));
  }

  saveSettings(partialSettings) {
    const current = this.getSettings();
    const next = this._sanitizeSettings(deepMerge(current, partialSettings || {}));
    this.ensureStoreExists();
    writeJsonAtomic(this.settingsPath, next);
    return next;
  }

  resetSettings() {
    const next = this._sanitizeSettings(deepClone(this.defaults));
    this.ensureStoreExists();
    writeJsonAtomic(this.settingsPath, next);
    return next;
  }

  getSnapshot() {
    const settings = this.getSettings();
    return {
      settings,
      dataRoot: this.dataPaths.root,
      dataPaths: deepClone(this.dataPaths),
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

    runtimeConfig.app = runtimeConfig.app || {};
    runtimeConfig.app.dataDir = this.dataPaths.root;
    runtimeConfig.app.dataPaths = deepClone(this.dataPaths);

    runtimeConfig.assistant = runtimeConfig.assistant || {};
    runtimeConfig.assistant.displayName = settings.assistant.displayName;
    runtimeConfig.assistant.title = settings.assistant.title;
    runtimeConfig.assistant.honorific = settings.assistant.honorific;
    runtimeConfig.assistant.userProfile = deepClone(settings.userProfile);
    runtimeConfig.assistant.contactsPath = this.contactStore.contactsPath;

    runtimeConfig.voice = runtimeConfig.voice || {};
    runtimeConfig.voice.tts = runtimeConfig.voice.tts || {};
    runtimeConfig.voice.tts.rate = settings.voice.tts.rate;
    runtimeConfig.voice.tts.volume = settings.voice.tts.volume;
    runtimeConfig.voice.tts.voiceName = settings.voice.tts.voiceName;
    runtimeConfig.voice.tts.naturalize = settings.voice.tts.naturalize;

    runtimeConfig.system = runtimeConfig.system || {};
    runtimeConfig.system.volumeStep = settings.system.volumeStep;
    runtimeConfig.system.permissionLevel = settings.system.permissionLevel;

    runtimeConfig.activeLearning = runtimeConfig.activeLearning || {};
    runtimeConfig.activeLearning.enabled = settings.activeLearning.enabled;
    runtimeConfig.activeLearning.askForFeedback = settings.activeLearning.askForFeedback;
    runtimeConfig.activeLearning.storePath = this.dataPaths.learningPath;

    runtimeConfig.logging = runtimeConfig.logging || {};
    runtimeConfig.logging.directory = this.dataPaths.logsDir;

    runtimeConfig.chat = runtimeConfig.chat || {};
    runtimeConfig.chat.activationShortcut = settings.chat.activationShortcut;
    runtimeConfig.chat.activationFallbackShortcuts = this.baseConfig?.chat?.activationFallbackShortcuts || [];
    runtimeConfig.chat.maxHistory = settings.chat.maxHistory;
    runtimeConfig.chat.activeTheme = settings.chat.themeId;
    runtimeConfig.modes = deepClone(settings.modes);

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
        tts: {
          rate: normalizeTtsRate(source.voice?.tts?.rate, this.defaults.voice.tts.rate),
          volume: clampNumber(source.voice?.tts?.volume, 0, 100, this.defaults.voice.tts.volume),
          voiceName: String(source.voice?.tts?.voiceName || '').trim(),
          naturalize: source.voice?.tts?.naturalize !== false
        }
      },
      system: {
        volumeStep: clampNumber(source.system?.volumeStep, 1, 20, this.defaults.system.volumeStep),
        permissionLevel: ['low', 'medium', 'high', 'critical'].includes(String(source.system?.permissionLevel || '').trim().toLowerCase())
          ? String(source.system.permissionLevel).trim().toLowerCase()
          : this.defaults.system.permissionLevel
      },
      activeLearning: {
        enabled: source.activeLearning?.enabled !== false,
        askForFeedback: source.activeLearning?.askForFeedback !== false
      },
      chat: {
        activationShortcut: normalizeActivationShortcut(
          source.chat?.activationShortcut || source.voice?.activationShortcut,
          this.defaults.chat.activationShortcut
        ),
        themeId,
        maxHistory: clampNumber(source.chat?.maxHistory, 50, 2000, this.defaults.chat.maxHistory)
      },
      modes: sanitizeModes(source.modes)
    };
  }
}

module.exports = {
  SettingsService,
  CHAT_THEMES
};
