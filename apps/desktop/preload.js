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
  }
});
