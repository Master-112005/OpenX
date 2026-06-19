const Logger = require('../shared/index').Logger;
const signals = require('./signals');

const ACTIVE_WINDOW_POLL_MS = 500;

function normalizeWindow(windowInfo) {
  if (!windowInfo) return null;

  const owner = windowInfo.owner || {};
  return {
    app: owner.name || windowInfo.app || null,
    title: windowInfo.title || '',
    path: owner.path || windowInfo.path || null,
    pid: owner.processId || windowInfo.pid || null,
    fullscreen: Boolean(windowInfo.fullscreen || windowInfo.isFullscreen),
    timestamp: Date.now()
  };
}

function windowsAreEqual(left, right) {
  if (!left || !right) return false;
  return (
    left.app === right.app &&
    left.title === right.title &&
    left.path === right.path &&
    left.pid === right.pid &&
    left.fullscreen === right.fullscreen
  );
}

class ActiveWindowMonitor {
  constructor(options = {}) {
    this.intervalMs = ACTIVE_WINDOW_POLL_MS;
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.signals = options.signals || signals;
    this.activeWin = options.activeWin || null;
    this.timer = null;
    this.currentWindow = null;
    this.subscribers = new Set();
    this.isPolling = false;
  }

  async _loadActiveWin() {
    if (this.activeWin) return this.activeWin;
    const imported = await import('active-win');
    this.activeWin = imported.default || imported;
    return this.activeWin;
  }

  async _readActiveWindow() {
    const activeWin = await this._loadActiveWin();
    const reader = typeof activeWin === 'function' ? activeWin : activeWin.activeWindow;
    if (typeof reader !== 'function') {
      throw new Error('active-win did not expose a foreground window reader');
    }

    return normalizeWindow(await reader());
  }

  async pollOnce() {
    if (this.isPolling) return this.currentWindow;
    this.isPolling = true;

    try {
      const nextWindow = await this._readActiveWindow();
      if (nextWindow && !windowsAreEqual(this.currentWindow, nextWindow)) {
        this.currentWindow = nextWindow;
        this.logger.info(`[Context] Active window changed -> ${nextWindow.app || 'unknown'}`);
        this.signals.emit(signals.SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED, nextWindow);
        this.subscribers.forEach(callback => callback(nextWindow));
      }
    } catch (err) {
      this.logger.warn('[Context] Active window detection failed', err.message);
    } finally {
      this.isPolling = false;
    }

    return this.currentWindow;
  }

  start() {
    if (this.timer) return;

    this.pollOnce();
    this.timer = setInterval(() => {
      this.pollOnce();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isPolling = false;
  }

  getCurrentWindow() {
    return this.currentWindow;
  }

  subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

const defaultMonitor = new ActiveWindowMonitor();

module.exports = {
  ACTIVE_WINDOW_POLL_MS,
  ActiveWindowMonitor,
  createMonitor: options => new ActiveWindowMonitor(options),
  start: defaultMonitor.start.bind(defaultMonitor),
  stop: defaultMonitor.stop.bind(defaultMonitor),
  getCurrentWindow: defaultMonitor.getCurrentWindow.bind(defaultMonitor),
  subscribe: defaultMonitor.subscribe.bind(defaultMonitor)
};
