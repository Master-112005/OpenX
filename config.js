const path = require('path');
const os = require('os');
const { buildDataPaths } = require('./core/assistant/Data');

const DATA_PATHS = buildDataPaths();
const LEGACY_DATA_DIR = path.join(os.homedir(), '.jarvis');

const CONFIG = {
  app: {
    name: 'JARVIS',
    version: '1.0.0',
    dataDir: DATA_PATHS.root,
    dataPaths: DATA_PATHS,
    legacyDataDir: LEGACY_DATA_DIR,
    migrateLegacyData: true
  },

  voice: {
    tts: {
      rate: 2,
      volume: 100,
      voiceName: '',
      naturalize: true
    }
  },

  assistant: {
    displayName: 'JARVIS',
    title: 'Desktop Assistant',
    honorific: 'sir',
    contactsPath: DATA_PATHS.contactsPath,
    userProfile: {
      fullName: '',
      email: '',
      phone: '',
      addressLine1: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      company: '',
      role: ''
    }
  },

  activeLearning: {
    enabled: true,
    askForFeedback: true,
    storePath: DATA_PATHS.learningPath
  },

  permissions: {
    levels: {
      low: { requiresConfirmation: false, requiresAuth: false },
      medium: { requiresConfirmation: true, requiresAuth: false },
      high: { requiresConfirmation: true, requiresAuth: true },
      critical: { requiresConfirmation: true, requiresAuth: true }
    },
    maxFailedAttempts: 3,
    authTimeoutMs: 30000
  },

  chat: {
    activationShortcut: 'Alt+Space',
    activationFallbackShortcuts: ['Control+Alt+Space', 'Control+Space'],
    maxHistory: 500,
    maxDisplayMessages: 100,
    fontSize: 14,
    fontFamily: 'Segoe UI, sans-serif',
    activeTheme: 'graphite',
    glassTint: 42,
    theme: {
      dark: {
        background: '#1a1a2e',
        text: '#e0e0e0',
        userBubble: '#0f3460',
        assistantBubble: '#16213e',
        inputBg: '#0f0f23',
        border: '#2a2a4a'
      },
      light: {
        background: '#ffffff',
        text: '#333333',
        userBubble: '#e3f2fd',
        assistantBubble: '#f5f5f5',
        inputBg: '#fafafa',
        border: '#e0e0e0'
      }
    }
  },

  system: {
    pollingIntervalMs: 5000,
    volumeStep: 5,
    brightnessStep: 10,
    maxRecentApps: 20,
    browserPaths: {
      chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      firefox: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
    }
  },

  logging: {
    level: 'info',
    maxFileSize: 10485760,
    maxFiles: 5,
    directory: DATA_PATHS.logsDir
  },

  plugins: {
    directory: path.join(__dirname, '..', 'plugins'),
    enabled: []
  }
};

module.exports = CONFIG;
