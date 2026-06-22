const { contextBridge, ipcRenderer } = require('electron');

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

  getConfig: () =>
    ipcRenderer.invoke('config:get'),

  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (settings) =>
    ipcRenderer.invoke('settings:save', settings),

  resetSettings: () =>
    ipcRenderer.invoke('settings:reset'),

  listContacts: () =>
    ipcRenderer.invoke('contacts:list'),

  saveContact: (contact) =>
    ipcRenderer.invoke('contacts:save', contact),

  deleteContact: (name) =>
    ipcRenderer.invoke('contacts:delete', { name }),

  handleScheduleAlert: (id, action, minutes = 5) =>
    ipcRenderer.invoke('schedule:alertAction', { id, action, minutes }),

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
  }
});
