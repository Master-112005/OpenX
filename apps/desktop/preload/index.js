const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  processCommand: (input, source) =>
    ipcRenderer.invoke('command:process', { input, source }),

  confirmAction: (commandId, intentId, entities) =>
    ipcRenderer.invoke('command:confirm', { commandId, intentId, entities }),

  getStatus: () =>
    ipcRenderer.invoke('assistant:status'),

  speak: (text) =>
    ipcRenderer.invoke('voice:speak', { text }),

  activateVoice: () =>
    ipcRenderer.invoke('voice:activate'),

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

  quit: () =>
    ipcRenderer.invoke('app:quit'),

  moveOrb: (x, y) =>
    ipcRenderer.invoke('orb:move', { x, y }),

  setOrbState: (state) =>
    ipcRenderer.invoke('orb:setState', { state }),

  getOrbPosition: () =>
    ipcRenderer.invoke('orb:getPosition'),

  setOrbPosition: (x, y) =>
    ipcRenderer.invoke('orb:setPosition', { x, y }),

  onOrbStateChange: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('orb:stateChange', handler);
    return () => ipcRenderer.removeListener('orb:stateChange', handler);
  },

  onVoiceActivated: (callback) => {
    ipcRenderer.on('voice:activated', () => callback());
    return () => ipcRenderer.removeAllListeners('voice:activated');
  },

  onVoiceListening: (callback) => {
    ipcRenderer.on('voice:listening', () => callback());
    return () => ipcRenderer.removeAllListeners('voice:listening');
  },

  onVoiceResult: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('voice:result', handler);
    return () => ipcRenderer.removeListener('voice:result', handler);
  },

  onSettingsChanged: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  }
});
