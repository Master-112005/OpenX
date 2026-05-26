const path = require('path');
const os = require('os');

const CONFIG = {
  app: {
    name: 'JARVIS',
    version: '1.0.0',
    dataDir: path.join(os.homedir(), '.jarvis')
  },

  orb: {
    defaultSize: 64,
    minSize: 32,
    maxSize: 128,
    defaultOpacity: 0.85,
    minOpacity: 0.2,
    maxOpacity: 1.0,
    position: { x: -1, y: -1 },
    animation: {
      idle: { duration: 3000 },
      listening: { duration: 1500 },
      processing: { duration: 800 },
      success: { duration: 1000 },
      error: { duration: 1500 }
    },
    colors: {
      idle: { r: 100, g: 100, b: 100 },
      listening: { r: 0, g: 120, b: 255 },
      processing: { r: 255, g: 165, b: 0 },
      success: { r: 0, g: 200, b: 80 },
      error: { r: 255, g: 50, b: 50 }
    }
  },

  voice: {
    activationMode: 'hotkey',
    activationShortcut: 'Alt+Space',
    allowManualActivation: true,
    conversationSilenceTimeoutMs: 20000,
    confirmationListenTimeoutMs: 10000,
    speakerLock: {
      enabled: true,
      similarityThreshold: 0.68
    },
    activationAcknowledgement: '',
    speakActivationAcknowledgement: false,
    silenceTimeout: 700,
    frameDurationMs: 20,
    preRollDurationMs: 400,
    maxUtteranceMs: 12000,
    vadThreshold: 0.015,
    recognition: {
      provider: 'whisper-local',
      pythonCommand: 'python',
      modelName: 'tiny.en',
      language: 'en',
      device: 'cpu',
      computeType: 'int8',
      sampleRate: 16000,
      frameDurationMs: 20,
      chunkDurationMs: 1200,
      cooldownMs: 2500,
      energyThreshold: 0.003,
      speechStartFrames: 3,
      vadAggressiveness: 3,
      modelCacheDir: path.join(os.homedir(), '.jarvis', 'models', 'whisper')
    },
    stt: {
      provider: 'whisper-local',
      pythonCommand: 'python',
      modelName: 'tiny.en',
      language: 'en',
      device: 'cpu',
      computeType: 'int8',
      sampleRate: 16000,
      frameDurationMs: 20,
      maxDurationMs: 12000,
      startSpeechTimeoutMs: 3500,
      energyThreshold: 0.003,
      minUtteranceMs: 250,
      speechStartFrames: 3,
      vadAggressiveness: 3,
      modelCacheDir: path.join(os.homedir(), '.jarvis', 'models', 'whisper')
    },
    tts: {
      rate: 0,
      volume: 100
    }
  },

  assistant: {
    displayName: 'JARVIS',
    title: 'Desktop Assistant',
    honorific: 'sir',
    contactsPath: path.join(os.homedir(), '.jarvis', 'contacts.json'),
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
    maxHistory: 500,
    maxDisplayMessages: 100,
    fontSize: 14,
    fontFamily: 'Segoe UI, sans-serif',
    activeTheme: 'midnight',
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
    maxFileSize: 5242880,
    maxFiles: 5,
    directory: path.join(os.homedir(), '.jarvis', 'logs')
  },

  plugins: {
    directory: path.join(__dirname, '..', 'plugins'),
    enabled: []
  }
};

module.exports = CONFIG;
