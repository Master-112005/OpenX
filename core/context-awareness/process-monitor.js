const { execFile } = require('child_process');
const Logger = require('../shared/index').Logger;
const signals = require('./signals');
const appRegistry = require('./app-registry');

const PROCESS_POLL_MS = 2000;
const PROCESS_QUERY_TIMEOUT_MS = 5000;

function runPowerShell(script, timeout = PROCESS_QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function normalizeProcess(raw) {
  if (!raw) return null;

  const name = raw.Name || raw.ImageName || raw.ProcessName || '';
  const pid = Number(raw.ProcessId || raw.PID || raw.Id || 0);
  if (!name || !pid) return null;

  return {
    name,
    pid,
    path: raw.ExecutablePath || raw.Path || null,
    categories: appRegistry.getCategoriesForApp(name),
    timestamp: Date.now()
  };
}

function parseJsonArray(output) {
  if (!output || !output.trim()) return [];
  const parsed = JSON.parse(output.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

class ProcessMonitor {
  constructor(options = {}) {
    this.intervalMs = Math.max(PROCESS_POLL_MS, Number(options.intervalMs) || PROCESS_POLL_MS);
    this.logger = options.logger || new Logger({ level: options.logging?.level || 'info' });
    this.signals = options.signals || signals;
    this.runner = options.runner || runPowerShell;
    this.timer = null;
    this.processes = new Map();
    this.subscribers = new Set();
    this.isPolling = false;
  }

  async _readProcesses() {
    const script = [
      'Get-CimInstance Win32_Process',
      '| Select-Object ProcessId,Name,ExecutablePath',
      '| ConvertTo-Json -Compress'
    ].join(' ');

    const output = await this.runner(script);
    return parseJsonArray(output)
      .map(normalizeProcess)
      .filter(Boolean);
  }

  _key(processInfo) {
    return `${String(processInfo.name).toLowerCase()}:${processInfo.pid}`;
  }

  _publish(event, processInfo) {
    this.signals.emit(event, processInfo);
    this.subscribers.forEach(callback => callback({ event, process: processInfo }));
  }

  async pollOnce() {
    if (this.isPolling) return this.getProcesses();
    this.isPolling = true;

    try {
      const nextProcesses = new Map();
      const processes = await this._readProcesses();

      processes.forEach(processInfo => {
        nextProcesses.set(this._key(processInfo), processInfo);
      });

      nextProcesses.forEach((processInfo, key) => {
        if (!this.processes.has(key)) {
          this.logger.info(`[Process] Started -> ${processInfo.name}`);
          this._publish(signals.SIGNAL_EVENTS.PROCESS_STARTED, processInfo);
        }
      });

      this.processes.forEach((processInfo, key) => {
        if (!nextProcesses.has(key)) {
          this.logger.info(`[Process] Stopped -> ${processInfo.name}`);
          this._publish(signals.SIGNAL_EVENTS.PROCESS_STOPPED, processInfo);
        }
      });

      this.processes = nextProcesses;
    } catch (err) {
      this.logger.warn('[Process] Process scan failed', err.message);
    } finally {
      this.isPolling = false;
    }

    return this.getProcesses();
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

  getProcesses() {
    return Array.from(this.processes.values());
  }

  isRunning(processName) {
    const target = String(processName || '').toLowerCase();
    if (!target) return false;
    return this.getProcesses().some(processInfo => String(processInfo.name).toLowerCase() === target);
  }

  subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}

const defaultMonitor = new ProcessMonitor();

module.exports = {
  PROCESS_POLL_MS,
  ProcessMonitor,
  createMonitor: options => new ProcessMonitor(options),
  start: defaultMonitor.start.bind(defaultMonitor),
  stop: defaultMonitor.stop.bind(defaultMonitor),
  getProcesses: defaultMonitor.getProcesses.bind(defaultMonitor),
  isRunning: defaultMonitor.isRunning.bind(defaultMonitor),
  subscribe: defaultMonitor.subscribe.bind(defaultMonitor)
};
