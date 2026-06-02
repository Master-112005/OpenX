const Logger = require('../shared/index').Logger;
const signals = require('./signals');

const ACTIVITY_HISTORY_LIMIT = 200;

function processNameFromPayload(payload = {}) {
  return payload.name || payload.app || payload.processName || null;
}

function audioNameFromPayload(payload = {}) {
  return payload.name || payload.audioDevice || null;
}

class ContextEngine {
  constructor(options = {}) {
    this.logger = options.logger || new Logger({ level: options.logging?.level || 'info' });
    this.signals = options.signals || signals;
    this.now = options.now || (() => Date.now());
    this.unsubscribers = [];
    this.subscribers = new Set();
    this.activityHistory = [];
    this.modeHistory = [];
    this.state = {
      activeApp: null,
      activeTitle: '',
      activePath: null,
      activePid: null,
      runningApps: [],
      audioDevice: null,
      microphoneActive: false,
      fullscreen: false,
      currentMode: null,
      timestamp: this.now(),
      uninterruptedActivityMs: 0,
      manualFocusRequested: false
    };
  }

  start() {
    if (this.unsubscribers.length > 0) return;

    const events = this.signals.SIGNAL_EVENTS;
    this.unsubscribers = [
      this.signals.subscribe(events.ACTIVE_WINDOW_CHANGED, envelope => this._handleActiveWindow(envelope.payload)),
      this.signals.subscribe(events.PROCESS_STARTED, envelope => this._handleProcessStarted(envelope.payload)),
      this.signals.subscribe(events.PROCESS_STOPPED, envelope => this._handleProcessStopped(envelope.payload)),
      this.signals.subscribe(events.AUDIO_DEVICE_CHANGED, envelope => this._handleAudioDeviceChanged(envelope.payload)),
      this.signals.subscribe(events.HEADPHONES_CONNECTED, envelope => this._handleAudioDeviceChanged(envelope.payload)),
      this.signals.subscribe(events.HEADPHONES_DISCONNECTED, () => this._handleAudioDeviceChanged(null)),
      this.signals.subscribe(events.MICROPHONE_ACTIVITY_CHANGED, envelope => this._handleMicrophoneActivityChanged(envelope.payload)),
      this.signals.subscribe(events.MODE_CHANGED, envelope => this.updateMode(envelope.payload?.to ?? envelope.payload?.currentMode))
    ];
  }

  stop() {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];
  }

  subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  update(partial = {}, eventType = 'context-updated') {
    const previousActiveApp = this.state.activeApp;
    const nextTimestamp = partial.timestamp || this.now();
    const activeAppChanged = Object.prototype.hasOwnProperty.call(partial, 'activeApp') && partial.activeApp !== previousActiveApp;

    this.state = {
      ...this.state,
      ...partial,
      timestamp: nextTimestamp
    };

    if (activeAppChanged) {
      this.state.uninterruptedActivityMs = 0;
    } else if (this.state.activeApp) {
      this.state.uninterruptedActivityMs += Math.max(0, nextTimestamp - (this._lastTimestamp || nextTimestamp));
    }

    this._lastTimestamp = nextTimestamp;
    this._recordActivity(eventType, partial);
    this._publish(eventType);
  }

  updateMode(modeStateOrMode) {
    const mode = typeof modeStateOrMode === 'string' || modeStateOrMode === null
      ? modeStateOrMode
      : modeStateOrMode?.currentMode;

    if (mode === this.state.currentMode) {
      return;
    }

    const entry = {
      mode,
      timestamp: this.now()
    };

    this.modeHistory.push(entry);
    if (this.modeHistory.length > ACTIVITY_HISTORY_LIMIT) {
      this.modeHistory.splice(0, this.modeHistory.length - ACTIVITY_HISTORY_LIMIT);
    }

    this.update({ currentMode: mode }, 'mode-updated');
  }

  getSnapshot() {
    return {
      activeApp: this.state.activeApp,
      activeTitle: this.state.activeTitle,
      runningApps: [...this.state.runningApps],
      audioDevice: this.state.audioDevice,
      microphoneActive: this.state.microphoneActive,
      fullscreen: this.state.fullscreen,
      timestamp: this.state.timestamp,
      currentMode: this.state.currentMode,
      uninterruptedActivityMs: this.state.uninterruptedActivityMs,
      manualFocusRequested: this.state.manualFocusRequested,
      modeHistory: [...this.modeHistory],
      activityHistory: [...this.activityHistory]
    };
  }

  _handleActiveWindow(payload = {}) {
    this.logger.info(`[Context] Active app -> ${payload.app || 'unknown'}`);
    this.update({
      activeApp: payload.app || null,
      activeTitle: payload.title || '',
      activePath: payload.path || null,
      activePid: payload.pid || null,
      fullscreen: Boolean(payload.fullscreen),
      timestamp: payload.timestamp || this.now()
    }, 'active-window');
  }

  _handleProcessStarted(payload = {}) {
    const processName = processNameFromPayload(payload);
    if (!processName) return;

    const runningApps = new Set(this.state.runningApps);
    runningApps.add(processName);
    this.update({ runningApps: Array.from(runningApps) }, 'process-started');
  }

  _handleProcessStopped(payload = {}) {
    const processName = processNameFromPayload(payload);
    if (!processName) return;

    this.update({
      runningApps: this.state.runningApps.filter(app => app.toLowerCase() !== processName.toLowerCase())
    }, 'process-stopped');
  }

  _handleAudioDeviceChanged(payload = {}) {
    const audioDevice = payload ? audioNameFromPayload(payload) : null;
    this.update({ audioDevice }, 'audio-device');
  }

  _handleMicrophoneActivityChanged(payload = {}) {
    this.update({
      microphoneActive: Boolean(payload?.active ?? payload?.microphoneActive)
    }, 'microphone-activity');
  }

  _recordActivity(eventType, payload) {
    this.activityHistory.push({
      eventType,
      payload,
      activeApp: this.state.activeApp,
      timestamp: this.state.timestamp
    });

    if (this.activityHistory.length > ACTIVITY_HISTORY_LIMIT) {
      this.activityHistory.splice(0, this.activityHistory.length - ACTIVITY_HISTORY_LIMIT);
    }
  }

  _publish(eventType) {
    const snapshot = this.getSnapshot();
    this.subscribers.forEach(callback => callback(snapshot, eventType));
  }
}

const defaultEngine = new ContextEngine();

module.exports = {
  ACTIVITY_HISTORY_LIMIT,
  ContextEngine,
  createEngine: options => new ContextEngine(options),
  start: defaultEngine.start.bind(defaultEngine),
  stop: defaultEngine.stop.bind(defaultEngine),
  update: defaultEngine.update.bind(defaultEngine),
  updateMode: defaultEngine.updateMode.bind(defaultEngine),
  getSnapshot: defaultEngine.getSnapshot.bind(defaultEngine),
  subscribe: defaultEngine.subscribe.bind(defaultEngine)
};
