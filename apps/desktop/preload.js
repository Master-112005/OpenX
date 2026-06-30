const { contextBridge, ipcRenderer } = require('electron');

function updateVoiceOverlayDom(message) {
  const operation = message?.operation;
  const view = message?.payload?.view || message?.payload || {};
  const root = document.getElementById('voice-overlay');
  if (!root) return;
  const title = document.getElementById('title');
  const status = document.getElementById('status');
  const transcript = document.getElementById('transcript');
  const icon = document.getElementById('icon');
  const state = String(view.state || '').toLowerCase();
  root.className = state;
  root.setAttribute('aria-label', view.accessibility?.label || view.ariaLabel || view.statusText || 'Voice status');
  root.setAttribute('aria-live', view.accessibility?.live || 'polite');
  if (title) title.textContent = view.title || 'Voice';
  if (status) status.textContent = view.statusText || '';
  if (transcript) {
    const transcriptText = message?.payload?.transcript || view.transcript || view.partialTranscript || view.finalTranscript || '';
    transcript.textContent = transcriptText;
  }
  if (icon) icon.textContent = String(view.icon || 'JA').slice(0, 2).toUpperCase();
  if (operation === 'hideOverlay') {
    root.style.opacity = '0';
  } else {
    root.style.opacity = '1';
  }
  for (const [name, value] of Object.entries(view.cssVariables || {})) {
    document.documentElement.style.setProperty(name, value);
  }
}

ipcRenderer.on('voiceOverlay:event', (_event, message) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateVoiceOverlayDom(message), { once: true });
    return;
  }
  updateVoiceOverlayDom(message);
});

contextBridge.exposeInMainWorld('jarvis', {
  processCommand: (input, source) =>
    ipcRenderer.invoke('command:process', { input, source }),

  confirmAction: (commandId, intentId, entities) =>
    ipcRenderer.invoke('command:confirm', { commandId, intentId, entities }),

  getStatus: () =>
    ipcRenderer.invoke('assistant:status'),

  speak: (text) =>
    ipcRenderer.invoke('tts:speak', { text }),

  stopSpeaking: () =>
    ipcRenderer.invoke('tts:stop'),

  openChat: () =>
    ipcRenderer.invoke('window:openChat'),

  openSettings: () =>
    ipcRenderer.invoke('window:openSettings'),

  openPlanner: (view = 'calendar') =>
    ipcRenderer.invoke('window:openPlanner', { view }),

  closePlanner: () =>
    ipcRenderer.invoke('window:closePlanner'),

  getConfig: () =>
    ipcRenderer.invoke('config:get'),

  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  generatePairingQR: () =>
    ipcRenderer.invoke('phone:pairingQR:create'),

  getPhoneServerStatus: () =>
    ipcRenderer.invoke('phone:server:status'),

  getPhoneDevices: () =>
    ipcRenderer.invoke('phone:devices:list'),

  updatePhonePermissions: (deviceId, permissions) =>
    ipcRenderer.invoke('phone:device:permissions:update', { deviceId, permissions }),

  removePhoneDevice: (deviceId) =>
    ipcRenderer.invoke('phone:device:remove', { deviceId }),

  disconnectPhoneDevice: (deviceId) =>
    ipcRenderer.invoke('phone:device:disconnect', { deviceId }),

  saveSettings: (settings) =>
    ipcRenderer.invoke('settings:save', settings),

  resetSettings: () =>
    ipcRenderer.invoke('settings:reset'),

  handleScheduleAlert: (id, action, minutes = 5) =>
    ipcRenderer.invoke('schedule:alertAction', { id, action, minutes }),

  getTimerWidgetState: () =>
    ipcRenderer.invoke('timerWidget:getState'),

  closeTimerWidget: () =>
    ipcRenderer.invoke('timerWidget:close'),

  stopStopwatchFromWidget: () =>
    ipcRenderer.invoke('timerWidget:stopStopwatch'),

  resumeStopwatchFromWidget: () =>
    ipcRenderer.invoke('timerWidget:resumeStopwatch'),

  resetStopwatchFromWidget: () =>
    ipcRenderer.invoke('timerWidget:resetStopwatch'),

  getPlannerEntries: () =>
    ipcRenderer.invoke('planner:getEntries'),

  addPlannerEntry: (entry) =>
    ipcRenderer.invoke('planner:addEntry', entry),

  deletePlannerEntry: (id) =>
    ipcRenderer.invoke('planner:deleteEntry', { id }),

  quit: () =>
    ipcRenderer.invoke('app:quit'),

  onSettingsChanged: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Settings listener must be a function');
    }
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  onOpenSettings: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Settings open listener must be a function');
    }
    const handler = () => callback();
    ipcRenderer.on('settings:open', handler);
    return () => ipcRenderer.removeListener('settings:open', handler);
  },

  onScheduleDue: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Schedule listener must be a function');
    }
    const handler = (_event, schedule) => callback(schedule);
    ipcRenderer.on('schedule:due', handler);
    return () => ipcRenderer.removeListener('schedule:due', handler);
  },

  onTimerWidgetState: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Timer widget listener must be a function');
    }
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('timerWidget:state', handler);
    return () => ipcRenderer.removeListener('timerWidget:state', handler);
  },

  onPlannerView: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Planner view listener must be a function');
    }
    const handler = (_event, view) => callback(view);
    ipcRenderer.on('planner:view', handler);
    return () => ipcRenderer.removeListener('planner:view', handler);
  },

  onPlannerEntriesChanged: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Planner entries listener must be a function');
    }
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('planner:entriesChanged', handler);
    return () => ipcRenderer.removeListener('planner:entriesChanged', handler);
  }
});
