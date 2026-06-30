const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_CONFIG = require('../../../config');
const Assistant = require('../../../core/assistant/index');
const TextToSpeech = require('../voice/tts');
const { VoiceSessionManager, VoiceAssistantBridge, DiagnosticsManager } = require('../voice');
const { SettingsService } = require('../settings');
const { AssistantEventBus, EVENTS, Logger } = require('../../../core/assistant/Data');
const { ensureDataRoot, migrateLegacyData } = require('../../../core/assistant/Data');
const CrashRecoveryPolicy = require('./crash-recovery');
const {
  DeviceRegistry,
  FileTransferManager,
  IdentityVerificationService,
  PairingService,
  PhoneCommandRouter,
  PhoneServer,
  QRPairingService,
  TransferHistory
} = require('../../../core/phone');
const WindowsIdentityVerifier = require('../phone-verification');
const {
  IPC_VALIDATORS,
  assertTrustedIpcSender,
  createSecureWebPreferences,
  getIpcSenderUrl,
  isTrustedRendererUrl
} = require('./security');

const RENDERER_ROOT = path.resolve(__dirname, '..', 'renderer');
const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const MAX_RENDERER_RESTARTS = 3;
const RENDERER_RESTART_WINDOW_MS = 60 * 1000;
const RENDERER_RESTART_DELAY_MS = 1000;
const MAX_RENDERER_RECOVERY_DELAY_MS = 5000;
const UNRESPONSIVE_RELOAD_DELAY_MS = 15 * 1000;
const FATAL_CLEANUP_TIMEOUT_MS = 3000;
const STABLE_RUNTIME_MS = 2 * 60 * 1000;
const ERR_ABORTED = -3;
const RENDERER_RECOVERABLE_REASONS = new Set([
  'abnormal-exit',
  'crashed',
  'killed',
  'oom',
  'launch-failed',
  'integrity-failure'
]);

if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'OpenX-Development'));
}

try {
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-client-side-phishing-detection');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('no-default-browser-check');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('metrics-recording-only');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch(
    'disable-features',
    [
      'WinRetrieveSuggestionsOnlyOnDemand',
      'AutofillServerCommunication',
      'CertificateTransparencyComponentUpdater',
      'DnsOverHttps',
      'InterestFeedContentSuggestions',
      'MediaRouter',
      'NetworkTimeServiceQuerying',
      'OptimizationHints',
      'UseDnsHttpsSvcb'
    ].join(',')
  );
} catch (_) {}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('OpenX is already running. Focusing the existing instance.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.show();
    chatWindow.focus();
  } else {
    createChatWindow();
  }
});

class ChildProcessRegistry {
  constructor() {
    this.children = new Set();
  }

  register(child) {
    if (!child || !child.pid) return;
    this.children.add(child);
  }

  unregister(child) {
    this.children.delete(child);
  }

  killAll() {
    if (process.platform !== 'win32') return;
    for (const child of this.children) {
      try {
        if (child && child.pid) {
          const { spawnSync } = require('child_process');
          spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
        }
      } catch (_) {}
    }
    this.children.clear();
  }
}

const childProcessRegistry = new ChildProcessRegistry();

const mainLogger = new Logger(BASE_CONFIG.logging);
const crashRecoveryPolicy = new CrashRecoveryPolicy({
  statePath: path.join(BASE_CONFIG.app.dataPaths.runtimeDir, 'crash-recovery.json'),
  maxRestarts: 3,
  windowMs: 5 * 60 * 1000
});

let chatWindow = null;
let alertWindow = null;
let timerWidgetWindow = null;
let timerWidgetMode = null;
let plannerWindow = null;
let tray = null;
let assistant = null;
let voiceSessionManager = null;
let voiceAssistantBridge = null;
let diagnosticsManager = null;
let textToSpeech = null;
let settingsService = null;
let runtimeConfig = null;
let eventBus = null;
let registeredChatShortcuts = [];
let statusIntervalHandle = null;
let ipcRegistered = false;
let cleanupFinished = false;
let cleanupPromise = null;
let fatalErrorHandling = false;
let signalHandling = false;
let stableRuntimeHandle = null;
let chatLoweredForPlanner = false;
let phoneServer = null;
let qrPairingService = null;
let phoneDeviceRegistry = null;
const rendererCrashHistory = new Map();
const recoveryTimeouts = new Set();
const unresponsiveTimeouts = new Map();
const IPC_CHANNELS = [
  'command:process',
  'command:confirm',
  'assistant:status',
  'tts:speak',
  'tts:stop',
  'window:openChat',
  'window:openSettings',
  'window:openPlanner',
  'window:closePlanner',
  'config:get',
  'settings:get',
  'phone:pairingQR:create',
  'phone:server:status',
  'phone:devices:list',
  'phone:device:permissions:update',
  'phone:device:remove',
  'phone:device:disconnect',
  'settings:save',
  'settings:reset',
  'schedule:alertAction',
  'timerWidget:getState',
  'timerWidget:close',
  'timerWidget:stopStopwatch',
  'timerWidget:resumeStopwatch',
  'timerWidget:resetStopwatch',
  'planner:getEntries',
  'planner:addEntry',
  'planner:deleteEntry',
  'app:quit'
];

function ensureDataDir() {
  const paths = ensureDataRoot(BASE_CONFIG);
  if (BASE_CONFIG.app?.migrateLegacyData) {
    migrateLegacyData(BASE_CONFIG);
  }
  if (!fs.existsSync(paths.logsDir)) {
    fs.mkdirSync(paths.logsDir, { recursive: true });
  }
}

function disableSpellChecker() {
  try {
    session.defaultSession?.setSpellCheckerEnabled?.(false);
  } catch (error) {
    mainLogger.warn('Failed to disable spell checker', { error: error.message });
  }
}

function configureSessionSecurity() {
  try {
    const defaultSession = session.defaultSession;
    defaultSession?.setPermissionRequestHandler?.((webContents, permission, callback, details) => {
      mainLogger.warn('Blocked renderer permission request', {
        permission,
        requestingUrl: details?.requestingUrl || webContents?.getURL?.() || ''
      });
      callback(false);
    });
    defaultSession?.setPermissionCheckHandler?.((_webContents, permission, requestingOrigin) => {
      mainLogger.warn('Blocked renderer permission check', { permission, requestingOrigin });
      return false;
    });
    defaultSession?.webRequest?.onBeforeRequest?.({
      urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']
    }, (details, callback) => {
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        mainLogger.warn('Blocked renderer network navigation', {
          url: details.url,
          resourceType: details.resourceType
        });
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  } catch (error) {
    mainLogger.warn('Failed to configure session security', { error: error.message });
  }
}

function clearUnresponsiveTimeout(browserWindow) {
  const timeout = unresponsiveTimeouts.get(browserWindow);
  if (!timeout) return;
  clearTimeout(timeout);
  unresponsiveTimeouts.delete(browserWindow);
}

function isRendererExitRecoverable(reason) {
  return RENDERER_RECOVERABLE_REASONS.has(String(reason || ''));
}

function isLoadFailureRecoverable(errorCode, validatedUrl, expectedPath) {
  if (Number(errorCode) === ERR_ABORTED) return false;
  if (!validatedUrl) return false;
  try {
    const { fileURLToPath } = require('url');
    return path.resolve(fileURLToPath(validatedUrl)) === expectedPath;
  } catch (_) {
    return false;
  }
}

function consumeRendererRestartBudget(windowType) {
  const now = Date.now();
  const recent = (rendererCrashHistory.get(windowType) || [])
    .filter(timestamp => now - timestamp < RENDERER_RESTART_WINDOW_MS);
  if (recent.length >= MAX_RENDERER_RESTARTS) {
    rendererCrashHistory.set(windowType, recent);
    return { allowed: false, crashCount: recent.length };
  }
  recent.push(now);
  rendererCrashHistory.set(windowType, recent);
  return { allowed: true, crashCount: recent.length };
}

function scheduleRendererRecovery(windowType, createWindow) {
  if (cleanupFinished || cleanupPromise) {
    mainLogger.info('Skipped renderer recovery during shutdown', { windowType });
    return;
  }

  const budget = consumeRendererRestartBudget(windowType);
  if (!budget.allowed) {
    mainLogger.error('Renderer recovery budget exhausted', { windowType });
    return;
  }

  const delayMs = Math.min(
    MAX_RENDERER_RECOVERY_DELAY_MS,
    RENDERER_RESTART_DELAY_MS * Math.max(1, budget.crashCount)
  );
  const timeout = setTimeout(() => {
    recoveryTimeouts.delete(timeout);
    if (!cleanupFinished && !cleanupPromise) createWindow();
  }, delayMs);
  recoveryTimeouts.add(timeout);
}

function secureWindow(browserWindow, options) {
  const { windowType, expectedFile, createWindow } = options;
  const expectedPath = path.resolve(expectedFile);

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainLogger.warn('Blocked renderer popup', { windowType, url });
    return { action: 'deny' };
  });

  browserWindow.webContents.once('did-finish-load', () => {
    mainLogger.info('Renderer loaded', { windowType });
  });

  browserWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    mainLogger.error('Renderer failed to load', {
      windowType,
      errorCode,
      errorDescription,
      validatedUrl
    });
    if (createWindow && isLoadFailureRecoverable(errorCode, validatedUrl, expectedPath)) {
      if (!browserWindow.isDestroyed()) browserWindow.destroy();
      scheduleRendererRecovery(`${windowType}:load`, createWindow);
    }
  });

  browserWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    mainLogger.error('Renderer preload failed', {
      windowType,
      preloadPath,
      error: error.message
    });
    if (createWindow) {
      if (!browserWindow.isDestroyed()) browserWindow.destroy();
      scheduleRendererRecovery(`${windowType}:preload`, createWindow);
    }
  });

  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, RENDERER_ROOT)) {
      event.preventDefault();
      mainLogger.warn('Blocked renderer navigation', { windowType, url });
      return;
    }

    try {
      const { fileURLToPath } = require('url');
      if (path.resolve(fileURLToPath(url)) !== expectedPath) {
        event.preventDefault();
        mainLogger.warn('Blocked cross-view renderer navigation', { windowType, url });
      }
    } catch (error) {
      event.preventDefault();
      mainLogger.warn('Blocked malformed renderer navigation', { windowType, error: error.message });
    }
  });

  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    if (cleanupFinished || cleanupPromise || !isRendererExitRecoverable(details.reason)) {
      mainLogger.info('Renderer process exited without recovery', { windowType, details });
      return;
    }

    const error = new Error(`${windowType} renderer exited: ${details.reason}`);
    Logger.writeCrashSync(error, { type: 'renderer', windowType, details }, BASE_CONFIG.logging);
    mainLogger.error('Renderer process exited unexpectedly', { windowType, details });
    if (!browserWindow.isDestroyed()) browserWindow.destroy();
    scheduleRendererRecovery(windowType, createWindow);
  });

  browserWindow.on('unresponsive', () => {
    mainLogger.warn('Renderer became unresponsive', { windowType });
    if (unresponsiveTimeouts.has(browserWindow)) return;
    const timeout = setTimeout(() => {
      unresponsiveTimeouts.delete(browserWindow);
      if (
        !browserWindow.isDestroyed()
        && !browserWindow.webContents.isDestroyed()
        && browserWindow.webContents.isLoading() === false
      ) {
        const error = new Error(`${windowType} renderer remained unresponsive`);
        Logger.writeCrashSync(error, { type: 'renderer-unresponsive', windowType }, BASE_CONFIG.logging);
        mainLogger.warn('Reloading unresponsive renderer', { windowType });
        browserWindow.webContents.reloadIgnoringCache();
      }
    }, UNRESPONSIVE_RELOAD_DELAY_MS);
    unresponsiveTimeouts.set(browserWindow, timeout);
  });

  browserWindow.on('responsive', () => {
    clearUnresponsiveTimeout(browserWindow);
  });

  browserWindow.on('closed', () => {
    clearUnresponsiveTimeout(browserWindow);
  });
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.setAlwaysOnTop(true);
    chatLoweredForPlanner = false;
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 400,
    height: 560,
    minWidth: 340,
    minHeight: 460,
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: createSecureWebPreferences(PRELOAD_PATH)
  });

  const chatFile = path.join(RENDERER_ROOT, 'chat', 'index.html');
  secureWindow(chatWindow, {
    windowType: 'chat',
    expectedFile: chatFile,
    createWindow: createChatWindow
  });
  chatWindow.loadFile(chatFile).catch(error => {
    mainLogger.error('Failed to load chat renderer', { error: error.message });
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  if (process.argv.includes('--dev')) {
    chatWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createSettingsWindow() {
  const chatWasOpen = Boolean(chatWindow && !chatWindow.isDestroyed());
  createChatWindow();
  const openSettings = () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      chatWindow.webContents.send('settings:open');
    }
  };
  if (chatWasOpen) {
    openSettings();
  } else {
    chatWindow.webContents.once('did-finish-load', openSettings);
  }
}

function sendPlannerEntries(view = 'calendar') {
  if (!plannerWindow || plannerWindow.isDestroyed()) return;
  try {
    const entries = getPlannerEntriesForRenderer();
    plannerWindow.webContents.send('planner:entriesChanged', { entries, view });
  } catch (error) {
    mainLogger.warn('Failed to send planner entries', { error: error.message });
  }
}

function localPlannerDateKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function scheduleToPlannerEntry(item) {
  if (!item?.id || !item.dueAt) return null;
  const due = new Date(item.dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const kind = String(item.kind || '').trim() || 'Schedule';
  const isReminderOrAlarm = /^(?:reminder|alarm)$/i.test(kind);
  if (!isReminderOrAlarm || !['scheduled', 'paused', 'due'].includes(item.status)) return null;
  const title = item.message || item.title || kind;
  return {
    id: `schedule-${item.id}`,
    type: 'timetable',
    title,
    notes: item.recurrence ? `${kind} - repeats ${String(item.recurrence).replace(/-/g, ' ')}` : kind,
    date: localPlannerDateKey(due),
    startTime: `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
    endTime: '',
    sourceText: item.title || title,
    sourceKind: kind.toLowerCase(),
    scheduleId: item.id,
    category: item.category || '',
    symbol: item.symbol || '',
    recurrence: item.recurrence || '',
    readonly: true,
    createdAt: item.createdAt || item.dueAt,
    updatedAt: item.dueAt
  };
}

function getPlannerEntriesForRenderer() {
  try {
    const plannerEntries = assistant?.automation?.planner?.listEntries?.()?.data?.entries || [];
    const schedules = assistant?.automation?.scheduler?.listSchedules?.(null, 'all')?.data?.entries || [];
    const scheduleEntries = schedules.map(scheduleToPlannerEntry).filter(Boolean);
    return [...plannerEntries, ...scheduleEntries];
  } catch (error) {
    mainLogger.warn('Failed to collect planner entries', { error: error.message });
    return [];
  }
}

function lowerChatWindowForPlanner() {
  if (!chatWindow || chatWindow.isDestroyed() || !chatWindow.isVisible()) return;
  chatWindow.setAlwaysOnTop(false);
  chatWindow.blur();
  chatLoweredForPlanner = true;
}

function restoreChatWindowPriority() {
  if (!chatLoweredForPlanner) return;
  chatLoweredForPlanner = false;
  if (!chatWindow || chatWindow.isDestroyed()) return;
  chatWindow.setAlwaysOnTop(true);
}

function createPlannerWindow(initialView = 'calendar', options = {}) {
  const view = initialView === 'timetable' ? 'timetable' : 'calendar';
  if (plannerWindow && !plannerWindow.isDestroyed()) {
    plannerWindow.show();
    plannerWindow.focus();
    plannerWindow.webContents.send('planner:view', view);
    sendPlannerEntries(view);
    if (options.lowerChat) lowerChatWindowForPlanner();
    return;
  }

  plannerWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    transparent: true,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    hasShadow: true,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#00000000',
    webPreferences: createSecureWebPreferences(PRELOAD_PATH)
  });

  const plannerFile = path.join(RENDERER_ROOT, 'planner', 'index.html');
  secureWindow(plannerWindow, {
    windowType: 'planner',
    expectedFile: plannerFile,
    createWindow: () => createPlannerWindow(view, options)
  });
  let didRevealPlanner = false;
  const revealPlanner = () => {
    if (didRevealPlanner || !plannerWindow || plannerWindow.isDestroyed()) return;
    didRevealPlanner = true;
    plannerWindow.center();
    plannerWindow.show();
    plannerWindow.focus();
    if (options.lowerChat) lowerChatWindowForPlanner();
  };
  plannerWindow.once('ready-to-show', revealPlanner);
  plannerWindow.loadFile(plannerFile).then(() => {
    if (plannerWindow && !plannerWindow.isDestroyed()) {
      plannerWindow.webContents.send('planner:view', view);
      sendPlannerEntries(view);
      revealPlanner();
    }
  }).catch(error => {
    mainLogger.error('Failed to load planner renderer', { error: error.message });
  });
  plannerWindow.on('closed', () => {
    plannerWindow = null;
    restoreChatWindowPriority();
  });
}

function presentScheduleAlert(schedule) {
  if (alertWindow && !alertWindow.isDestroyed()) {
    alertWindow.show();
    alertWindow.focus();
    alertWindow.webContents.send('schedule:due', schedule);
    return;
  }

  alertWindow = new BrowserWindow({
    width: 420,
    height: 440,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: createSecureWebPreferences(PRELOAD_PATH)
  });
  const alertFile = path.join(RENDERER_ROOT, 'alert', 'index.html');
  secureWindow(alertWindow, {
    windowType: 'schedule-alert',
    expectedFile: alertFile,
    createWindow: () => presentScheduleAlert(schedule)
  });
  alertWindow.loadFile(alertFile).then(() => {
    if (alertWindow && !alertWindow.isDestroyed()) {
      alertWindow.center();
      alertWindow.webContents.send('schedule:due', schedule);
      alertWindow.show();
      alertWindow.focus();
    }
  }).catch(error => {
    mainLogger.error('Failed to load schedule alert renderer', { error: error.message });
  });
  alertWindow.on('closed', () => {
    alertWindow = null;
  });
}

function getTimerWidgetState(preferredId = null, options = {}) {
  const includeStopwatch = options.includeStopwatch === true || timerWidgetMode === 'stopwatch';
  const state = assistant?.automation?.scheduler?.getTimerWidgetState?.(preferredId, { includeStopwatch });
  if (!includeStopwatch && state?.mode === 'stopwatch') return { visible: false };
  return state || { visible: false };
}

function positionTimerWidget() {
  if (!timerWidgetWindow || timerWidgetWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display?.workArea || screen.getPrimaryDisplay().workArea;
  const [width, height] = timerWidgetWindow.getSize();
  timerWidgetWindow.setBounds({
    x: Math.round(area.x + area.width - width - 22),
    y: Math.round(area.y + area.height - height - 24),
    width,
    height
  });
}

function sendTimerWidgetState(state = null) {
  if (!timerWidgetWindow || timerWidgetWindow.isDestroyed()) return;
  const nextState = state || getTimerWidgetState(null, { includeStopwatch: timerWidgetMode === 'stopwatch' });
  timerWidgetMode = nextState?.visible ? nextState.mode : null;
  timerWidgetWindow.webContents.send('timerWidget:state', nextState);
}

function hideTimerWidget() {
  if (timerWidgetWindow && !timerWidgetWindow.isDestroyed()) {
    timerWidgetWindow.close();
  }
  timerWidgetMode = null;
}

function showTimerWidget(preferredId = null, options = {}) {
  const state = getTimerWidgetState(preferredId, options);
  if (!state.visible) {
    hideTimerWidget();
    return;
  }
  timerWidgetMode = state.mode;

  if (timerWidgetWindow && !timerWidgetWindow.isDestroyed()) {
    positionTimerWidget();
    timerWidgetWindow.showInactive();
    sendTimerWidgetState(state);
    return;
  }

  timerWidgetWindow = new BrowserWindow({
    width: 154,
    height: 154,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: createSecureWebPreferences(PRELOAD_PATH)
  });
  timerWidgetWindow.setAlwaysOnTop(true, 'screen-saver');
  const widgetFile = path.join(RENDERER_ROOT, 'timer-widget', 'index.html');
  secureWindow(timerWidgetWindow, {
    windowType: 'timer-widget',
    expectedFile: widgetFile,
    createWindow: () => showTimerWidget(preferredId, options)
  });
  timerWidgetWindow.loadFile(widgetFile).then(() => {
    if (timerWidgetWindow && !timerWidgetWindow.isDestroyed()) {
      positionTimerWidget();
      timerWidgetWindow.showInactive();
      sendTimerWidgetState(state);
    }
  }).catch(error => {
    mainLogger.error('Failed to load timer widget renderer', { error: error.message });
  });
  timerWidgetWindow.on('closed', () => {
    timerWidgetWindow = null;
    timerWidgetMode = null;
  });
}

function handleTimerWidgetCommand(payload) {
  if (!payload?.success || !payload.intent) return;
  const intent = String(payload.intent);
  if (!/^(?:timer|stopwatch)\./.test(intent)) return;
  if (intent === 'timer.cancel' || intent === 'timer.clear' || intent === 'stopwatch.cancel') {
    hideTimerWidget();
    return;
  }
  const preferredId = payload.data?.id || payload.data?.taskName || null;
  if (intent === 'timer.set' || intent === 'timer.reset' || intent === 'stopwatch.start' || intent === 'stopwatch.reset') {
    showTimerWidget(preferredId, { includeStopwatch: intent.startsWith('stopwatch.') });
    return;
  }
  if (timerWidgetWindow && !timerWidgetWindow.isDestroyed()) {
    sendTimerWidgetState(getTimerWidgetState(preferredId, { includeStopwatch: timerWidgetMode === 'stopwatch' }));
  }
}

function handlePlannerCommand(payload) {
  if (!payload?.success || !payload.intent) return;
  const intent = String(payload.intent);
  if (/^(?:reminder|alarm)\.(?:set|cancel|clear|snooze|list)$/.test(intent)) {
    sendPlannerEntries('calendar');
    return;
  }
  if (!/^(?:calendar|timetable)\./.test(intent)) return;
  createPlannerWindow('calendar');
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  tray.setToolTip(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant`);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Chat', click: () => createChatWindow() },
    { label: 'Calendar / Timetable', click: () => createPlannerWindow('calendar') },
    { label: 'Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setIgnoreDoubleClickEvents(false);
  tray.on('double-click', () => createChatWindow());
}

function registerIpcHandler(channel, handler) {
  const validator = IPC_VALIDATORS[channel];
  if (!validator) throw new Error(`No IPC validator registered for ${channel}`);

  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertTrustedIpcSender(event, RENDERER_ROOT);
      const validatedPayload = validator(payload);
      return await handler(event, validatedPayload);
    } catch (error) {
      mainLogger.warn('IPC request rejected', {
        channel,
        sender: getIpcSenderUrl(event),
        error: error.message
      });
      throw new Error('Invalid or unauthorized IPC request');
    }
  });
}

function setupIPC() {
  if (ipcRegistered) {
    return;
  }

  registerIpcHandler('command:process', async (_event, { input, source }) => {
    if (!assistant) return { success: false, response: 'Assistant not initialized' };
    const result = await assistant.processCommand(input, source);
    if (
      result?.needsClarification &&
      result.data?.clarificationType === 'browser.open.blankTabAlreadyOpen' &&
      chatWindow &&
      !chatWindow.isDestroyed()
    ) {
      chatWindow.show();
      chatWindow.focus();
    }
    return result;
  });

  registerIpcHandler('command:confirm', async (_event, { commandId, intentId, entities }) => {
    if (!assistant) return { success: false, response: 'Assistant not initialized' };
    return assistant.confirmAction(commandId, intentId, entities);
  });

  registerIpcHandler('assistant:status', async () => {
    if (!assistant) return { ready: false };
    return { ready: true, ...assistant.getStatus() };
  });

  registerIpcHandler('tts:speak', async (_event, { text }) => {
    if (textToSpeech) {
      textToSpeech.speak(text);
    }
    return { success: true };
  });

  registerIpcHandler('tts:stop', async () => {
    if (textToSpeech) {
      textToSpeech.stop();
    }
    return { success: true };
  });

  registerIpcHandler('window:openChat', async () => {
    createChatWindow();
  });

  registerIpcHandler('window:openSettings', async () => {
    createSettingsWindow();
  });

  registerIpcHandler('window:openPlanner', async (_event, { view }) => {
    createPlannerWindow(view, { lowerChat: true });
    return { success: true, view };
  });

  registerIpcHandler('window:closePlanner', async () => {
    if (plannerWindow && !plannerWindow.isDestroyed()) plannerWindow.close();
    return { success: true };
  });

  registerIpcHandler('config:get', async () => {
    return runtimeConfig;
  });

  registerIpcHandler('settings:get', async () => {
    return settingsService.getSnapshot();
  });

  registerIpcHandler('phone:pairingQR:create', async () => {
    if (!qrPairingService) {
      return { success: false, message: 'Phone service unavailable.' };
    }
    return qrPairingService.generatePairingQR();
  });

  registerIpcHandler('phone:server:status', async () => {
    return phoneServer?.getStatus?.() || {
      serverStatus: 'stopped',
      running: false,
      currentIp: null,
      currentPort: runtimeConfig?.phone?.port || null,
      currentVersion: QRPairingService.PROTOCOL_VERSION,
      protocolVersion: QRPairingService.PROTOCOL_VERSION,
      host: runtimeConfig?.phone?.host || null,
      connectedDevices: []
    };
  });

  registerIpcHandler('phone:devices:list', async () => {
    return phoneDeviceRegistry?.listDevices() || [];
  });

  registerIpcHandler('phone:device:permissions:update', async (_event, { deviceId, permissions }) => {
    const updated = phoneDeviceRegistry?.updatePermissions(deviceId, permissions);
    if (!updated) throw new Error('Device not found');
    return phoneDeviceRegistry.getDevice(deviceId);
  });

  registerIpcHandler('phone:device:disconnect', async (_event, { deviceId }) => {
    return { success: true, disconnected: phoneServer?.disconnectDevice(deviceId) || 0 };
  });

  registerIpcHandler('phone:device:remove', async (_event, { deviceId }) => {
    phoneServer?.disconnectDevice(deviceId);
    phoneServer?.revokeDeviceSession(deviceId);
    return { success: phoneDeviceRegistry?.removeDevice(deviceId) === true };
  });

  registerIpcHandler('settings:save', async (_event, payload) => {
    settingsService.saveSettings(payload);
    await reloadRuntimeServices();
    return settingsService.getSnapshot();
  });

  registerIpcHandler('settings:reset', async () => {
    settingsService.resetSettings();
    await reloadRuntimeServices();
    return settingsService.getSnapshot();
  });

  registerIpcHandler('schedule:alertAction', async (_event, { id, action, minutes }) => {
    const scheduler = assistant?.automation?.scheduler;
    const result = action === 'snooze'
      ? scheduler?.snooze(id, minutes)
      : scheduler?.complete(id);
    if (result?.success && String(result.data?.kind || '').toLowerCase() === 'timer') {
      if (action === 'snooze') showTimerWidget(result.data.id || result.data.taskName || id);
      if (action === 'stop') hideTimerWidget();
    }
    if (alertWindow && !alertWindow.isDestroyed()) alertWindow.close();
    return result || { success: false, error: 'Scheduler unavailable' };
  });

  registerIpcHandler('timerWidget:getState', async () => {
    return getTimerWidgetState(null, { includeStopwatch: timerWidgetMode === 'stopwatch' });
  });

  registerIpcHandler('timerWidget:close', async () => {
    hideTimerWidget();
    return { success: true };
  });

  registerIpcHandler('timerWidget:stopStopwatch', async () => {
    const result = assistant?.automation?.scheduler?.pauseStopwatch?.();
    if (result?.success) sendTimerWidgetState(getTimerWidgetState(result.data?.id || result.data?.taskName, { includeStopwatch: true }));
    return result || { success: false, error: 'Scheduler unavailable' };
  });

  registerIpcHandler('timerWidget:resumeStopwatch', async () => {
    const result = assistant?.automation?.scheduler?.resumeStopwatch?.();
    if (result?.success) {
      showTimerWidget(result.data?.id || result.data?.taskName, { includeStopwatch: true });
    }
    return result || { success: false, error: 'Scheduler unavailable' };
  });

  registerIpcHandler('timerWidget:resetStopwatch', async () => {
    const result = assistant?.automation?.scheduler?.resetStopwatch?.();
    if (result?.success) {
      showTimerWidget(result.data?.id || result.data?.taskName, { includeStopwatch: true });
    }
    return result || { success: false, error: 'Scheduler unavailable' };
  });

  registerIpcHandler('planner:getEntries', async () => {
    if (!assistant?.automation?.planner) return { success: false, error: 'Planner unavailable' };
    const entries = getPlannerEntriesForRenderer();
    return { success: true, data: { entries, count: entries.length } };
  });

  registerIpcHandler('planner:addEntry', async (_event, payload) => {
    const result = assistant?.automation?.planner?.addEntry?.(payload) || { success: false, error: 'Planner unavailable' };
    if (result?.success) sendPlannerEntries(payload.type);
    return result;
  });

  registerIpcHandler('planner:deleteEntry', async (_event, { id }) => {
    const result = assistant?.automation?.planner?.deleteEntry?.(id) || { success: false, error: 'Planner unavailable' };
    if (result?.success) sendPlannerEntries();
    return result;
  });

  registerIpcHandler('app:quit', async () => {
    app.quit();
  });

  ipcRegistered = true;
}

function teardownIPC() {
  for (const channel of IPC_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch (error) {
      mainLogger.error('Failed to remove IPC handler', { channel, error: error.message });
    }
  }
  ipcRegistered = false;
}

function startStatusPolling() {
  stopStatusPolling();

  const intervalMs = runtimeConfig.system?.pollingIntervalMs ||
    BASE_CONFIG.system?.pollingIntervalMs ||
    5000;
  statusIntervalHandle = setInterval(() => {
    if (assistant) {
      try {
        assistant.getContext();
      } catch (error) {
        mainLogger.error('Status polling failed', { error: error.message });
      }
    }
  }, intervalMs);
}

function stopStatusPolling() {
  if (statusIntervalHandle) {
    clearInterval(statusIntervalHandle);
    statusIntervalHandle = null;
  }
}

async function destroyAssistantInstance() {
  if (diagnosticsManager) {
    try {
      diagnosticsManager.stop();
    } catch (error) {
      mainLogger.warn('Failed to stop voice diagnostics', { error: error.message });
    }
    diagnosticsManager = null;
  }
  if (voiceAssistantBridge) {
    try {
      voiceAssistantBridge.detach();
    } catch (error) {
      mainLogger.warn('Failed to detach voice assistant bridge', { error: error.message });
    }
    voiceAssistantBridge = null;
  }
  voiceSessionManager = null;

  if (!assistant) {
    return;
  }

  const currentAssistant = assistant;
  assistant = null;
  try {
    await currentAssistant.destroy?.();
  } catch (error) {
    mainLogger.error('Assistant cleanup failed', { error: error.message });
  }
}

function destroyTextToSpeech() {
  if (!textToSpeech) {
    return;
  }

  try {
    textToSpeech.destroy();
  } catch (error) {
    mainLogger.error('TTS cleanup failed', { error: error.message });
  } finally {
    textToSpeech = null;
  }
}

async function cleanupRuntime() {
  if (cleanupPromise) {
    return cleanupPromise;
  }

  cleanupPromise = (async () => {
    stopStatusPolling();
    if (stableRuntimeHandle) {
      clearTimeout(stableRuntimeHandle);
      stableRuntimeHandle = null;
    }
    for (const timeout of recoveryTimeouts) clearTimeout(timeout);
    recoveryTimeouts.clear();
    for (const timeout of unresponsiveTimeouts.values()) clearTimeout(timeout);
    unresponsiveTimeouts.clear();
    unregisterChatShortcut();
    globalShortcut.unregisterAll();
    childProcessRegistry.killAll();
    teardownIPC();
    if (qrPairingService) {
      qrPairingService.destroy();
      qrPairingService = null;
    }
    if (phoneServer) {
      try {
        await phoneServer.stop();
      } catch (error) {
        mainLogger.error('Phone server cleanup failed', { error: error.message });
      } finally {
        phoneServer = null;
      }
    }
    phoneDeviceRegistry = null;
    destroyTextToSpeech();
    await destroyAssistantInstance();
    eventBus?.removeAllListeners?.();
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.destroy();
    if (alertWindow && !alertWindow.isDestroyed()) alertWindow.destroy();
    if (timerWidgetWindow && !timerWidgetWindow.isDestroyed()) timerWidgetWindow.destroy();
    if (plannerWindow && !plannerWindow.isDestroyed()) plannerWindow.destroy();
    if (tray) {
      tray.destroy();
      tray = null;
    }
    cleanupFinished = true;
  })();

  return cleanupPromise;
}

function unregisterChatShortcut() {
  if (registeredChatShortcuts.length === 0) {
    return;
  }

  for (const shortcut of registeredChatShortcuts) {
    try {
      globalShortcut.unregister(shortcut);
    } catch (error) {
      mainLogger.error('Failed to unregister chat shortcut', { shortcut, error: error.message });
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

function startVoiceListeningFromShortcut(shortcut = '') {
  if (!voiceSessionManager) {
    mainLogger.warn('Voice shortcut ignored because voice session manager is unavailable', { shortcut });
    return { success: false, error: 'Voice unavailable' };
  }

  try {
    if (voiceSessionManager.isActive()) {
      const cancelled = voiceSessionManager.cancelSession('Voice shortcut pressed while listening.');
      mainLogger.info('Voice shortcut cancelled active listening session', { shortcut });
      return { success: true, cancelled: true, state: cancelled.state };
    }

    const started = voiceSessionManager.startSession({ id: `voice-shortcut-${Date.now()}` });
    try {
      voiceSessionManager.startAudioCapture();
      voiceSessionManager.startSpeechToText();
    } catch (captureError) {
      mainLogger.warn('Voice shortcut started session but capture could not start', {
        shortcut,
        error: captureError.message
      });
      voiceSessionManager.failSession(captureError);
      return { success: false, state: voiceSessionManager.getCurrentState(), error: captureError.message };
    }
    mainLogger.info('Voice shortcut started listening', { shortcut });
    return { success: true, state: started.state };
  } catch (error) {
    mainLogger.error('Voice shortcut failed', { shortcut, error: error.message });
    return { success: false, error: error.message };
  }
}

function registerChatShortcut() {
  unregisterChatShortcut();

  for (const shortcut of getChatShortcuts()) {
    try {
      const registered = globalShortcut.register(shortcut, () => {
        mainLogger.info('Voice shortcut pressed', { shortcut });
        startVoiceListeningFromShortcut(shortcut);
      });

      if (!registered) {
        mainLogger.error('Failed to register chat shortcut', { shortcut });
        continue;
      }

      registeredChatShortcuts.push(shortcut);
      mainLogger.info('Registered chat shortcut', { shortcut });
    } catch (error) {
      mainLogger.error('Invalid chat shortcut', { shortcut, error: error.message });
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
    mainLogger.warn('TTS initialization failed (non-fatal)', { error: err.message });
  }

  voiceSessionManager = new VoiceSessionManager({
    logger: mainLogger
  });
  voiceAssistantBridge = new VoiceAssistantBridge({
    manager: voiceSessionManager,
    assistant,
    logger: mainLogger
  });
  diagnosticsManager = new DiagnosticsManager({
    logger: mainLogger,
    configuration: {
      ...(runtimeConfig?.voice?.diagnostics || {}),
      storageRoot: path.join(runtimeConfig.app.dataPaths.root, 'voice', 'diagnostics')
    }
  });
  diagnosticsManager.start({
    sessionManager: voiceSessionManager,
    resources: { sessionManager: voiceSessionManager }
  });

  registerChatShortcut();
  mainLogger.info('Assistant initialized', {
    name: runtimeConfig?.assistant?.displayName || 'JARVIS'
  });
}

async function initializePhoneServer() {
  const commandRouter = new PhoneCommandRouter(() => assistant);
  const resolvePhoneServerIp = () => QRPairingService.resolveDesktopIpv4();
  const deviceRegistry = new DeviceRegistry({
    filePath: runtimeConfig.app.dataPaths.phoneDevicesPath,
    logger: mainLogger
  });
  phoneDeviceRegistry = deviceRegistry;
  const identityVerificationService = new IdentityVerificationService({
    verifier: new WindowsIdentityVerifier(),
    logger: mainLogger
  });
  const pairingService = new PairingService({
    deviceRegistry,
    identityVerificationService,
    pairingPath: runtimeConfig.app.dataPaths.phonePairingPath,
    permissionsPath: runtimeConfig.app.dataPaths.phonePermissionsPath,
    logger: mainLogger
  });
  const transferHistory = new TransferHistory({
    filePath: runtimeConfig.app.dataPaths.phoneTransferHistoryPath
  });
  const fileTransferManager = new FileTransferManager({
    deviceRegistry,
    history: transferHistory,
    receiveDirectory: path.join(app.getPath('downloads'), 'OpenX_Received'),
    logger: mainLogger,
    sendToDevice: (deviceId, payload) => phoneServer?.sendToDevice(deviceId, payload) === true
  });
  if (assistant?.automation) {
    assistant.automation.fileTransferManager = fileTransferManager;
  }
  const configuredPort = runtimeConfig?.phone?.port;
  const maxPortAttempts = 20;
  let phoneServerAddress = null;
  let phoneServerError = null;

  for (let attempt = 0; attempt < maxPortAttempts; attempt += 1) {
    const port = Number.isInteger(configuredPort) ? configuredPort + attempt : configuredPort;
    phoneServer = new PhoneServer({
      host: runtimeConfig?.phone?.host,
      port,
      protocolVersion: QRPairingService.PROTOCOL_VERSION,
      resolveServerIp: resolvePhoneServerIp,
      commandRouter,
      pairingService,
      fileTransferManager,
      logger: mainLogger
    });

    try {
      phoneServerAddress = await phoneServer.start();
      if (attempt > 0) {
        mainLogger.warn('[PHONE] Configured port unavailable; using fallback port', {
          configuredPort,
          port: phoneServerAddress.port
        });
      }
      break;
    } catch (error) {
      phoneServerError = error;
      phoneServer = null;
      if (error?.code !== 'EADDRINUSE' || !Number.isInteger(configuredPort)) break;
    }
  }

  if (!phoneServerAddress) throw phoneServerError || new Error('Unable to start phone server');

  qrPairingService = new QRPairingService({
    pairingService,
    serverPort: phoneServerAddress.port,
    resolveServerIp: resolvePhoneServerIp,
    logger: mainLogger
  });
}

async function reloadRuntimeServices() {
  runtimeConfig = settingsService.buildRuntimeConfig();

  destroyTextToSpeech();
  await destroyAssistantInstance();
  await initializeAssistant();
  startStatusPolling();

  if (tray) {
    tray.setToolTip(`${runtimeConfig?.assistant?.displayName || 'JARVIS'} Assistant`);
  }

  if (chatWindow?.webContents) {
    chatWindow.webContents.send('settings:changed', settingsService.getSnapshot());
  }

  showTimerWidget();
}

function normalizeError(reason) {
  if (reason instanceof Error) return reason;
  if (typeof reason === 'string') return new Error(reason);
  try {
    return new Error(JSON.stringify(reason));
  } catch (_) {
    return new Error(String(reason));
  }
}

function waitForTimeout(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function exitRuntime(code) {
  if (app?.exit) {
    app.exit(code);
    return;
  }
  process.exit(code);
}

function handleFatalError(reason, origin) {
  const error = normalizeError(reason);
  Logger.writeCrashSync(error, {
    type: 'main-process',
    origin,
    platform: process.platform,
    release: os.release(),
    electron: process.versions.electron,
    node: process.versions.node
  }, BASE_CONFIG.logging);

  if (fatalErrorHandling) return;
  fatalErrorHandling = true;
  mainLogger.error('Fatal main-process error', { origin, error: error.message });

  if (app?.isReady?.() && !cleanupFinished) {
    try {
      if (crashRecoveryPolicy.requestRestart()) {
        app.relaunch();
      } else {
        mainLogger.error('Automatic relaunch blocked by crash-loop policy');
      }
    } catch (relaunchError) {
      mainLogger.error('Failed to schedule application relaunch', { error: relaunchError.message });
    }
  }

  Promise.race([
    cleanupRuntime(),
    waitForTimeout(FATAL_CLEANUP_TIMEOUT_MS)
  ]).catch(error => {
    mainLogger.error('Fatal cleanup failed', { error: error.message });
  }).finally(() => exitRuntime(1));
}

function handleSignal(signal) {
  if (signalHandling || fatalErrorHandling) return;
  signalHandling = true;
  mainLogger.info('Termination signal received', { signal });
  Promise.race([
    cleanupRuntime(),
    waitForTimeout(FATAL_CLEANUP_TIMEOUT_MS)
  ]).catch(error => {
    mainLogger.error('Signal cleanup failed', { error: error.message });
  }).finally(() => exitRuntime(0));
}

process.on('uncaughtException', error => handleFatalError(error, 'uncaughtException'));
process.on('unhandledRejection', reason => handleFatalError(reason, 'unhandledRejection'));
process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

app.on('child-process-gone', (_event, details) => {
  if (details.reason === 'clean-exit' || cleanupFinished || cleanupPromise) return;
  const error = new Error(`${details.type || 'Electron child'} process exited: ${details.reason}`);
  Logger.writeCrashSync(error, { type: 'child-process', details }, BASE_CONFIG.logging);
  mainLogger.error('Electron child process exited unexpectedly', { details });
});

app.whenReady().then(async () => {
  disableSpellChecker();
  configureSessionSecurity();
  settingsService = new SettingsService(BASE_CONFIG);
  runtimeConfig = settingsService.buildRuntimeConfig();
  eventBus = new AssistantEventBus();
  eventBus.subscribe(EVENTS.SCHEDULE_DUE, envelope => {
    if (String(envelope.payload?.kind || '').toLowerCase() === 'timer') showTimerWidget();
    presentScheduleAlert(envelope.payload);
    sendPlannerEntries('calendar');
  });
  eventBus.subscribe(EVENTS.COMMAND_EXECUTED, envelope => handleTimerWidgetCommand(envelope.payload));
  eventBus.subscribe(EVENTS.COMMAND_EXECUTED, envelope => handlePlannerCommand(envelope.payload));
  setupIPC();
  createTray();
  await initializeAssistant();
  await initializePhoneServer();
  showTimerWidget();
  if (!app.isPackaged) {
    createChatWindow();
  }
  startStatusPolling();
  stableRuntimeHandle = setTimeout(() => {
    stableRuntimeHandle = null;
    try {
      crashRecoveryPolicy.markStable();
      mainLogger.info('Crash recovery budget reset after stable runtime');
    } catch (error) {
      mainLogger.warn('Failed to reset crash recovery budget', { error: error.message });
    }
  }, STABLE_RUNTIME_MS);
  mainLogger.info('Desktop runtime ready', {
    version: app.getVersion(),
    platform: process.platform,
    release: os.release()
  });
}).catch(error => handleFatalError(error, 'startup'));

app.on('window-all-closed', () => {
  // Keep running in tray so the tray menu can reopen chat.
});

app.on('activate', () => {
  createChatWindow();
});

app.on('before-quit', (event) => {
  if (cleanupFinished) {
    return;
  }

  event.preventDefault();
  if (!fatalErrorHandling) {
    try {
      crashRecoveryPolicy.markStable();
    } catch (error) {
      mainLogger.warn('Failed to clear crash recovery state during shutdown', { error: error.message });
    }
  }
  cleanupRuntime()
    .catch(error => {
      mainLogger.error('Runtime cleanup failed', { error: error.message });
    })
    .finally(() => {
      cleanupFinished = true;
      app.quit();
    });
});

app.on('will-quit', () => {
  if (!cleanupFinished) {
    globalShortcut.unregisterAll();
    childProcessRegistry.killAll();
  }
});
