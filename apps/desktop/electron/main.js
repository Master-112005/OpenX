const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE_CONFIG = require('../../../config/index');
const Assistant = require('../../../core/assistant/index');
const VoiceManager = require('../../../core/voice/index');
const UIStateManager = require('../../../core/ui/state/index');
const { SettingsService } = require('../../../core/settings/index');
const { AssistantEventBus, EVENTS } = require('../../../core/shared/index');

let mainWindow = null;
let chatWindow = null;
let settingsWindow = null;
let tray = null;
let assistant = null;
let voiceManager = null;
let settingsService = null;
let runtimeConfig = null;
let eventBus = null;
let uiState = null;
let registeredActivationShortcuts = [];

function ensureDataDir() {
  const dirs = [
    BASE_CONFIG.app.dataDir,
    BASE_CONFIG.logging.directory
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function createOrbWindow() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  const orbConfig = runtimeConfig?.orb || BASE_CONFIG.orb;

  mainWindow = new BrowserWindow({
    width: orbConfig.defaultSize,
    height: orbConfig.defaultSize,
    x: orbConfig.position?.x !== -1 ? orbConfig.position.x : width - 120,
    y: orbConfig.position?.y !== -1 ? orbConfig.position.y : 100,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: orbConfig.alwaysOnTop !== false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'orb', 'index.html'));
  mainWindow.setIgnoreMouseEvents(false, { forward: true });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createChatWindow() {
  if (chatWindow) {
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
    { label: 'Open Assistant', click: () => { if (mainWindow) mainWindow.show(); } },
    {
      label: 'Start Listening',
      click: () => {
        console.log('Tray voice activation requested');
        if (voiceManager) {
          voiceManager.manualActivate({ trigger: 'tray' });
        }
      }
    },
    { label: 'Chat', click: () => createChatWindow() },
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

  ipcMain.handle('voice:speak', async (event, { text }) => {
    if (voiceManager) voiceManager.speak(text);
    return { success: true };
  });

  ipcMain.handle('voice:activate', async () => {
    if (voiceManager && voiceManager.manualActivate({ trigger: 'ui' })) {
      return { success: true };
    }

    return {
      success: false,
      error: 'Voice activation is unavailable right now.'
    };
  });

  ipcMain.handle('orb:move', async (event, { x, y }) => {
    if (mainWindow) {
      const [wx, wy] = mainWindow.getPosition();
      mainWindow.setPosition(Math.round(wx + x), Math.round(wy + y));
    }
  });

  ipcMain.handle('orb:setState', async (event, { state }) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('orb:stateChange', state);
    }
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

  ipcMain.handle('orb:getPosition', async () => {
    if (mainWindow) return mainWindow.getPosition();
    return [0, 0];
  });

  ipcMain.handle('orb:setPosition', async (event, { x, y }) => {
    if (mainWindow) mainWindow.setPosition(x, y);
  });
}

function broadcastOrbState(state) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('orb:stateChange', state);
  }
}

function bindUiState() {
  if (!uiState) {
    return;
  }

  uiState.removeAllListeners('orb:state');
  uiState.on('orb:state', (state) => {
    broadcastOrbState(state);
  });
}

function bindEventPipeline() {
  if (!eventBus || !uiState) {
    return;
  }

  const stateToOrb = {
    IDLE: 'idle',
    ACTIVATING: 'listening',
    LISTENING: 'listening',
    HEARING_SPEECH: 'listening',
    TRANSCRIBING: 'processing',
    THINKING: 'processing',
    RESPONDING: 'processing',
    ERROR: 'error'
  };

  eventBus.subscribe(EVENTS.VOICE_STATE_CHANGED, ({ payload }) => {
    const orbState = stateToOrb[payload.currentState];
    if (orbState) {
      uiState.setOrbState(orbState);
    }

    const currentState = payload.currentState;
    uiState.update('voice', {
      active: currentState !== 'IDLE',
      listening: currentState === 'LISTENING' || currentState === 'HEARING_SPEECH',
      speaking: currentState === 'RESPONDING'
    });
  });

  eventBus.subscribe(EVENTS.COMMAND_EXECUTED, ({ payload }) => {
    if (payload.source === 'voice') {
      uiState.setOrbState(payload.success ? 'success' : 'error');
    }
  });

  eventBus.subscribe(EVENTS.RESPONSE_STARTED, () => {
    uiState.setSpeaking(true);
  });

  eventBus.subscribe(EVENTS.RESPONSE_COMPLETED, () => {
    uiState.setSpeaking(false);
    setTimeout(() => {
      if (!voiceManager?.getStatus?.().listening) {
        uiState.setOrbState('idle');
      }
    }, 900);
  });

  eventBus.subscribe(EVENTS.VOICE_ERROR, () => {
    uiState.setOrbState('error');
  });
}

function unregisterActivationShortcut() {
  if (registeredActivationShortcuts.length === 0) {
    return;
  }

  for (const shortcut of registeredActivationShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
    } catch (error) {
      console.error(`Failed to unregister activation shortcut ${shortcut}:`, error.message);
    }
  }
  registeredActivationShortcuts = [];
}

function getActivationShortcuts() {
  const primary = runtimeConfig?.voice?.activationShortcut || BASE_CONFIG.voice.activationShortcut || 'Alt+Space';
  const fallbacks = runtimeConfig?.voice?.activationFallbackShortcuts
    || BASE_CONFIG.voice.activationFallbackShortcuts
    || ['Control+Alt+Space', 'Control+Space'];

  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function registerActivationShortcut() {
  unregisterActivationShortcut();

  const shortcuts = getActivationShortcuts();
  if (shortcuts.length === 0) {
    return;
  }

  for (const shortcut of shortcuts) {
    try {
      const registered = globalShortcut.register(shortcut, () => {
        console.log(`Activation shortcut pressed: ${shortcut}`);
        if (voiceManager) {
          const activated = voiceManager.manualActivate({ trigger: shortcut });
          if (!activated) {
            console.log('Voice activation ignored', voiceManager.getStatus?.() || {});
          }
        }
      });

      if (!registered) {
        console.error(`Failed to register activation shortcut: ${shortcut}`);
        continue;
      }

      registeredActivationShortcuts.push(shortcut);
      console.log(`Registered activation shortcut: ${shortcut}`);
    } catch (error) {
      console.error(`Invalid activation shortcut ${shortcut}:`, error.message);
    }
  }

  if (registeredActivationShortcuts.length > 0) {
    console.log(`Voice activation ready. Press ${registeredActivationShortcuts.join(' or ')} to start listening, or use tray > Start Listening.`);
  } else {
    console.error('No voice activation shortcuts were registered. Use tray > Start Listening or the orb voice control.');
  }
}

async function initializeAssistant() {
  ensureDataDir();
  runtimeConfig = settingsService.buildRuntimeConfig();
  assistant = new Assistant(runtimeConfig, { eventBus });
  assistant.router.permissionValidator.setUserLevel(
    settingsService.getSettings().system.permissionLevel
  );
  voiceManager = new VoiceManager(runtimeConfig, { eventBus });

  try {
    await voiceManager.initialize();
  } catch (err) {
    console.error('Voice initialization failed (non-fatal):', err.message);
  }
  if (voiceManager?.workerReady) {
    registerActivationShortcut();
  } else {
    unregisterActivationShortcut();
  }

  voiceManager.on('activated', () => {
    uiState.update('voice', { active: true, listening: false });
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('voice:activated');
    }
  });

  voiceManager.on('listening', () => {
    uiState.update('voice', { active: true, listening: true });
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('voice:listening');
    }
  });

  voiceManager.on('listeningTimeout', (data) => {
    if (data?.mode !== 'confirmation' || !assistant?.getStatus().awaitingConfirmation) {
      return;
    }

    const result = assistant.expirePendingConfirmation('timeout', 'voice');
    if (!result?.response) {
      return;
    }

    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('voice:processed', {
        transcript: '',
        result
      });
    }

    voiceManager.speak(result.response);
  });

  voiceManager.on('speechResult', async (data) => {
    if (chatWindow && chatWindow.webContents) {
      chatWindow.webContents.send('voice:result', data);
    }
    if (assistant && data.text) {
      let result;
      try {
        result = await assistant.processVoiceInput(data.text);
      } catch (error) {
        const message = error?.message || String(error || 'Unknown voice processing error');
        console.error('Voice command processing failed:', message);
        result = {
          success: false,
          response: "I heard you, but I couldn't process that command.",
          error: message
        };
      }
      if (chatWindow && chatWindow.webContents) {
        chatWindow.webContents.send('voice:processed', {
          transcript: data.text,
          result
        });
      }
      if (result.requiresConfirmation) {
        const timeoutMs = runtimeConfig?.voice?.conversationSilenceTimeoutMs
          || runtimeConfig?.voice?.confirmationListenTimeoutMs
          || 20000;
        voiceManager.queueFollowUpListening({
          mode: 'confirmation',
          startSpeechTimeoutMs: timeoutMs,
          maxDurationMs: timeoutMs
        });
      } else if (voiceManager.shouldContinueConversation()) {
        voiceManager.queueFollowUpListening(voiceManager.getConversationListenOptions());
      }
      if (voiceManager && result.response) {
        voiceManager.speak(result.response);
      }
    }
  });

  console.log(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant initialized`);
}

async function reloadRuntimeServices() {
  runtimeConfig = settingsService.buildRuntimeConfig();

  if (voiceManager) {
    voiceManager.destroy();
    voiceManager = null;
  }

  assistant = null;
  await initializeAssistant();

  if (mainWindow) {
    const orbConfig = runtimeConfig.orb || {};
    mainWindow.setAlwaysOnTop(orbConfig.alwaysOnTop !== false);
    if (orbConfig.defaultSize) {
      mainWindow.setSize(orbConfig.defaultSize, orbConfig.defaultSize);
    }
  }

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
  uiState = new UIStateManager(eventBus);
  bindUiState();
  bindEventPipeline();
  setupIPC();
  createOrbWindow();
  createTray();
  await initializeAssistant();

  setInterval(() => {
    if (assistant) {
      assistant.getContext();
    }
  }, runtimeConfig.system?.pollingIntervalMs || BASE_CONFIG.system?.pollingIntervalMs || 5000);
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (!mainWindow) createOrbWindow();
});

app.on('before-quit', () => {
  unregisterActivationShortcut();
  globalShortcut.unregisterAll();
  if (voiceManager) voiceManager.destroy();
  if (tray) tray.destroy();
});
