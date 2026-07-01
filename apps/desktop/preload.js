const { contextBridge, ipcRenderer } = require('electron');

let voiceAssistantResultClearTimer = null;

function voiceResultNameFromPath(pathValue, fallback) {
  return String(pathValue || '').split(/[\\/]/).filter(Boolean).pop() || fallback;
}

function appendVoiceCard(list, entry, options = {}) {
  const item = document.createElement('li');
  item.className = 'voice-card';
  const number = document.createElement('span');
  number.className = 'voice-card-number';
  number.textContent = String(Number(entry?.index) || list.children.length + 1);
  const body = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = String(entry?.name || entry?.title || voiceResultNameFromPath(entry?.path, 'Result'));
  body.appendChild(name);
  const metaText = [
    entry?.location,
    entry?.sizeMB > 0 ? `${entry.sizeMB} MB` : '',
    entry?.matchScore > 0 && entry?.type !== 'web' ? `${Math.round(entry.matchScore)}% match` : '',
    !entry?.location && entry?.path ? entry.path : ''
  ].filter(Boolean).join(' - ');
  if (entry?.snippet) {
    const snippet = document.createElement('small');
    snippet.textContent = String(entry.snippet);
    body.appendChild(snippet);
  }
  if (metaText) {
    const meta = document.createElement('small');
    meta.textContent = metaText;
    body.appendChild(meta);
  }
  if (options.showPath && entry?.path && metaText !== entry.path) {
    const pathEl = document.createElement('small');
    pathEl.textContent = String(entry.path);
    body.appendChild(pathEl);
  }
  item.append(number, body);
  list.appendChild(item);
}

function renderVoiceAssistantResult(payload = {}) {
  const responseEl = document.getElementById('assistant-response');
  if (!responseEl) return;
  if (voiceAssistantResultClearTimer) {
    clearTimeout(voiceAssistantResultClearTimer);
    voiceAssistantResultClearTimer = null;
  }
  const hasPayload = Boolean(String(payload.response || '').trim()) ||
    (Array.isArray(payload.resultEntries) && payload.resultEntries.length > 0) ||
    (Array.isArray(payload.choices) && payload.choices.length > 0);
  if (!hasPayload) {
    responseEl.classList.remove('visible');
    voiceAssistantResultClearTimer = setTimeout(() => {
      voiceAssistantResultClearTimer = null;
      responseEl.replaceChildren();
    }, 180);
    return;
  }
  responseEl.replaceChildren();
  const fragment = document.createDocumentFragment();
  const response = String(payload.response || '').trim();
  if (response) {
    const text = document.createElement('div');
    text.className = 'voice-response-text';
    text.textContent = response;
    fragment.appendChild(text);
  }
  const entries = Array.isArray(payload.resultEntries) ? payload.resultEntries : [];
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const cards = choices.length > 0 ? choices : entries;
  if (cards.length > 0) {
    const list = document.createElement('ol');
    list.className = 'voice-card-list';
    for (const card of cards.slice(0, 8)) {
      const normalized = choices.length > 0
        ? {
            index: card.index,
            name: voiceResultNameFromPath(card.path, card.title || `Option ${card.index || list.children.length + 1}`),
            path: card.path || card.title || ''
          }
        : card;
      appendVoiceCard(list, normalized, { showPath: choices.length > 0 });
    }
    fragment.appendChild(list);
  }
  responseEl.appendChild(fragment);
  requestAnimationFrame(() => responseEl.classList.add('visible'));
}

function updateVoiceOverlayDom(message) {
  const operation = message?.operation;
  const view = message?.payload?.view || message?.payload || {};
  const root = document.getElementById('voice-overlay');
  if (!root) return;
  if (operation === 'displayAssistantResult') {
    renderVoiceAssistantResult(message?.payload || {});
    return;
  }
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
    if (operation === 'updateTranscript' && transcriptText) {
      renderVoiceAssistantResult({});
    }
  }
  if (icon) icon.textContent = String(view.icon || 'JA').slice(0, 2).toUpperCase();
  if (operation === 'hideOverlay') {
    root.style.opacity = '0';
    renderVoiceAssistantResult({});
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

contextBridge.exposeInMainWorld('openxVoiceCapture', {
  ready: () =>
    ipcRenderer.invoke('voiceCapture:report', { event: 'ready', data: {} }),

  report: (event, data = {}) =>
    ipcRenderer.invoke('voiceCapture:report', { event, data }),

  sendFrame: (frame) =>
    ipcRenderer.send('voiceCapture:frame', frame),

  onStart: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Voice capture start listener must be a function');
    }
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('voiceCapture:start', handler);
    return () => ipcRenderer.removeListener('voiceCapture:start', handler);
  },

  onStop: (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('Voice capture stop listener must be a function');
    }
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('voiceCapture:stop', handler);
    return () => ipcRenderer.removeListener('voiceCapture:stop', handler);
  }
});

const openxApi = {
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

  startVoice: () =>
    ipcRenderer.invoke('voice:start'),

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
};

contextBridge.exposeInMainWorld('openx', openxApi);
contextBridge.exposeInMainWorld('jarvis', openxApi);
