const Logger = require('../shared/index').Logger;
const signals = require('../context-awareness/signals');
const audioDevices = require('./audio-devices');
const headphones = require('./headphones');

const DEVICE_POLL_MS = 2000;
const DEVICE_DEBOUNCE_MS = 750;

function audioDevicesEqual(left, right) {
  if (!left || !right) return false;
  return left.id === right.id && left.name === right.name && left.type === right.type;
}

class DeviceEventsMonitor {
  constructor(options = {}) {
    this.intervalMs = Math.max(DEVICE_POLL_MS, Number(options.intervalMs) || DEVICE_POLL_MS);
    this.debounceMs = Math.max(100, Number(options.debounceMs) || DEVICE_DEBOUNCE_MS);
    this.logger = options.logger || new Logger({ level: options.logging?.level || 'info' });
    this.signals = options.signals || signals;
    this.audioManager = options.audioManager || audioDevices.createManager(options);
    this.timer = null;
    this.debounceTimer = null;
    this.currentDevice = null;
    this.headphonesConnected = false;
    this.isPolling = false;
  }

  async _readState() {
    const currentDevice = await this.audioManager.getCurrentAudioDevice();
    const devices = await this.audioManager.getAudioDevices();
    const headphonesConnected = devices.some(device => headphones.isHeadphoneDevice(device));
    return { currentDevice, devices, headphonesConnected };
  }

  _debouncedEmit(event, payload, logMessage) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (logMessage) this.logger.info(logMessage);
      this.signals.emit(event, payload);
    }, this.debounceMs);
  }

  async pollOnce() {
    if (this.isPolling) {
      return {
        currentDevice: this.currentDevice,
        headphonesConnected: this.headphonesConnected
      };
    }

    this.isPolling = true;
    try {
      const nextState = await this._readState();

      if (nextState.currentDevice && !audioDevicesEqual(this.currentDevice, nextState.currentDevice)) {
        this.currentDevice = nextState.currentDevice;
        this._debouncedEmit(
          signals.SIGNAL_EVENTS.AUDIO_DEVICE_CHANGED,
          nextState.currentDevice,
          `[Audio] Device changed -> ${nextState.currentDevice.name}`
        );
      }

      if (nextState.headphonesConnected !== this.headphonesConnected) {
        this.headphonesConnected = nextState.headphonesConnected;
        const event = this.headphonesConnected
          ? signals.SIGNAL_EVENTS.HEADPHONES_CONNECTED
          : signals.SIGNAL_EVENTS.HEADPHONES_DISCONNECTED;
        const device = nextState.devices.find(headphones.isHeadphoneDevice) || nextState.currentDevice;
        this._debouncedEmit(
          event,
          device || { timestamp: Date.now() },
          this.headphonesConnected
            ? `[Audio] Headphones connected -> ${device?.name || 'unknown'}`
            : '[Audio] Headphones disconnected'
        );
      }
    } catch (err) {
      this.logger.warn('[Audio] Device event scan failed', err.message);
    } finally {
      this.isPolling = false;
    }

    return {
      currentDevice: this.currentDevice,
      headphonesConnected: this.headphonesConnected
    };
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

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.isPolling = false;
  }
}

const defaultMonitor = new DeviceEventsMonitor();

module.exports = {
  DEVICE_POLL_MS,
  DEVICE_DEBOUNCE_MS,
  DeviceEventsMonitor,
  createMonitor: options => new DeviceEventsMonitor(options),
  start: defaultMonitor.start.bind(defaultMonitor),
  stop: defaultMonitor.stop.bind(defaultMonitor)
};
