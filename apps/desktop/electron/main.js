const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE_CONFIG = require('../../../config/index');
const Assistant = require('../../../core/assistant/index');
const TextToSpeech = require('../../../core/voice/tts/index');
const { SettingsService } = require('../../../core/settings/index');
const { AssistantEventBus } = require('../../../core/shared/index');
const { ensureDataRoot, migrateLegacyData } = require('../../../core/shared/data-root');

let chatWindow = null;
let settingsWindow = null;
let tray = null;
let assistant = null;
let textToSpeech = null;
let settingsService = null;
let runtimeConfig = null;
let eventBus = null;
let registeredChatShortcuts = [];

function ensureDataDir() {
  const paths = ensureDataRoot(BASE_CONFIG);
  if (BASE_CONFIG.app?.migrateLegacyData) {
    migrateLegacyData(BASE_CONFIG);
  }
  if (!fs.existsSync(paths.logsDir)) {
    fs.mkdirSync(paths.logsDir, { recursive: true });
  }
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 380,
    height: 520,
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  chatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'chat', 'index.html'));

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  if (process.argv.includes('--dev')) {
    chatWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: true,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));
  settingsWindow.setMenu(null);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  tray.setToolTip(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant`);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Chat', click: () => createChatWindow() },
    { label: 'Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setIgnoreDoubleClickEvents(true);
}

function setupIPC() {
  ipcMain.handle('command:process', async (event, { input, source }) => {
    if (!assistant) return { success: false, response: 'Assistant not initialized' };
    return assistant.processCommand(input, source || 'chat');
  });

  ipcMain.handle('command:confirm', async (event, { commandId, intentId, entities }) => {
    if (!assistant) return { success: false, response: 'Assistant not initialized' };
    return assistant.confirmAction(commandId, intentId, entities);
  });

  ipcMain.handle('assistant:status', async () => {
    if (!assistant) return { ready: false };
    return { ready: true, ...assistant.getStatus() };
  });

  ipcMain.handle('tts:speak', async (event, { text }) => {
    if (textToSpeech) {
      textToSpeech.speak(text);
    }
    return { success: true };
  });

  ipcMain.handle('window:openChat', async () => {
    createChatWindow();
  });

  ipcMain.handle('window:openSettings', async () => {
    createSettingsWindow();
  });

  ipcMain.handle('config:get', async () => {
    return runtimeConfig;
  });

  ipcMain.handle('settings:get', async () => {
    return settingsService.getSnapshot();
  });

  ipcMain.handle('settings:save', async (event, payload) => {
    settingsService.saveSettings(payload || {});
    await reloadRuntimeServices();
    return settingsService.getSnapshot();
  });

  ipcMain.handle('settings:reset', async () => {
    settingsService.resetSettings();
    await reloadRuntimeServices();
    return settingsService.getSnapshot();
  });

  ipcMain.handle('contacts:list', async () => {
    return settingsService.getSnapshot().contacts;
  });

  ipcMain.handle('contacts:save', async (event, contact) => {
    settingsService.saveContact(contact || {});
    return settingsService.getSnapshot().contacts;
  });

  ipcMain.handle('contacts:delete', async (event, { name }) => {
    settingsService.deleteContact(name);
    return settingsService.getSnapshot().contacts;
  });

  ipcMain.handle('app:quit', async () => {
    app.quit();
  });
}

function unregisterChatShortcut() {
  if (registeredChatShortcuts.length === 0) {
    return;
  }

  for (const shortcut of registeredChatShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
    } catch (error) {
      console.error(`Failed to unregister chat shortcut ${shortcut}:`, error.message);
    }
  }
  registeredChatShortcuts = [];
}

function getChatShortcuts() {
  const primary = runtimeConfig?.chat?.activationShortcut || BASE_CONFIG.chat.activationShortcut || 'Alt+Space';
  const fallbacks = runtimeConfig?.chat?.activationFallbackShortcuts
    || BASE_CONFIG.chat.activationFallbackShortcuts
    || ['Control+Alt+Space', 'Control+Space'];

  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function registerChatShortcut() {
  unregisterChatShortcut();

  for (const shortcut of getChatShortcuts()) {
    try {
      const registered = globalShortcut.register(shortcut, () => {
        console.log(`Chat shortcut pressed: ${shortcut}`);
        createChatWindow();
      });

      if (!registered) {
        console.error(`Failed to register chat shortcut: ${shortcut}`);
        continue;
      }

      registeredChatShortcuts.push(shortcut);
      console.log(`Registered chat shortcut: ${shortcut}`);
    } catch (error) {
      console.error(`Invalid chat shortcut ${shortcut}:`, error.message);
    }
  }
}

async function initializeAssistant() {
  ensureDataDir();
  runtimeConfig = settingsService.buildRuntimeConfig();
  assistant = new Assistant(runtimeConfig, { eventBus });
  assistant.router.permissionValidator.setUserLevel(
    settingsService.getSettings().system.permissionLevel
  );

  textToSpeech = new TextToSpeech(runtimeConfig);
  try {
    await textToSpeech.initialize();
  } catch (err) {
    console.error('TTS initialization failed (non-fatal):', err.message);
  }

  registerChatShortcut();
  console.log(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant initialized`);
}

async function reloadRuntimeServices() {
  runtimeConfig = settingsService.buildRuntimeConfig();

  if (textToSpeech) {
    textToSpeech.destroy();
    textToSpeech = null;
  }

  assistant = null;
  await initializeAssistant();

  if (tray) {
    tray.setToolTip(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant`);
  }

  if (chatWindow?.webContents) {
    chatWindow.webContents.send('settings:changed', settingsService.getSnapshot());
  }

  if (settingsWindow?.webContents) {
    settingsWindow.webContents.send('settings:changed', settingsService.getSnapshot());
  }
}

app.whenReady().then(async () => {
  settingsService = new SettingsService(BASE_CONFIG);
  runtimeConfig = settingsService.buildRuntimeConfig();
  eventBus = new AssistantEventBus();
  setupIPC();
  createTray();
  await initializeAssistant();

  setInterval(() => {
    if (assistant) {
      assistant.getContext();
    }
  }, runtimeConfig.system?.pollingIntervalMs || BASE_CONFIG.system?.pollingIntervalMs || 5000);
});

app.on('window-all-closed', () => {
  // Keep running in tray so Alt+Space can reopen chat.
});

app.on('activate', () => {
  createChatWindow();
});

app.on('before-quit', () => {
  unregisterChatShortcut();
  globalShortcut.unregisterAll();
  if (textToSpeech) textToSpeech.destroy();
  if (tray) tray.destroy();
});
