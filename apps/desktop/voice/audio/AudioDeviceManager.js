'use strict';

const EventEmitter = require('events');
const AUDIO_EVENTS = require('./AudioEvents');
const { MicrophoneNotFoundError, DeviceDisconnectedError } = require('./AudioErrors');

/**
 * Purpose: Owns microphone discovery, selection, switching, and change detection.
 * Responsibility: Normalize device metadata, detect default/preferred/lost/reconnected devices, and hide hardware details from OpenX.
 * Dependencies: AudioEvents and AudioErrors; hardware access is injected through a provider for deterministic tests.
 * Thread ownership: The selected device state is owned by this manager and should not be mutated externally.
 * Future integration notes: Windows, Electron, or native APIs must be adapted behind the provider interface only.
 */
class AudioDeviceManager {
  /**
   * Create an audio device manager.
   * @param {{provider?: object, logger?: object, defaultDeviceId?: string}} dependencies Device dependencies.
   */
  constructor(dependencies = {}) {
    this.provider = dependencies.provider || {};
    this.logger = dependencies.logger || null;
    this.events = new EventEmitter();
    this.devices = [];
    this.selectedDeviceId = dependencies.defaultDeviceId || '';
    this.metrics = {
      deviceSwitchCount: 0,
      reconnectCount: 0,
      deviceChangeCount: 0
    };
  }

  /**
   * Subscribe to device events.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioDeviceManager}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a device event listener.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioDeviceManager}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Enumerate known microphone devices.
   * @returns {Array<object>}
   */
  listInputDevices() {
    const rawDevices = typeof this.provider.listInputDevices === 'function'
      ? this.provider.listInputDevices()
      : this.devices;
    this.devices = rawDevices.map(device => this._normalizeDevice(device));
    return this.devices.map(device => ({ ...device }));
  }

  /**
   * Return the active or provider-reported default microphone.
   * @returns {object|null}
   */
  getDefaultInputDevice() {
    const devices = this.listInputDevices();
    const providerDefaultId = typeof this.provider.getDefaultInputDeviceId === 'function'
      ? this.provider.getDefaultInputDeviceId()
      : '';
    return devices.find(device => device.id === providerDefaultId)
      || devices.find(device => device.isDefault)
      || devices.find(device => device.connected)
      || null;
  }

  /**
   * Select a microphone by id.
   * @param {string} deviceId Input device id.
   * @returns {{selected: boolean, device: object}}
   */
  selectInputDevice(deviceId) {
    const id = String(deviceId || '');
    const device = this.listInputDevices().find(candidate => candidate.id === id);
    if (!device) {
      throw new MicrophoneNotFoundError('Microphone was not found.', { details: { deviceId: id } });
    }
    if (!device.connected) {
      throw new DeviceDisconnectedError('Microphone is disconnected.', { details: { deviceId: id } });
    }
    this.selectedDeviceId = id;
    this.metrics.deviceSwitchCount += 1;
    this.events.emit(AUDIO_EVENTS.AUDIO_DEVICE_CHANGED, { device });
    this._log('Device Selected', { device });
    return { selected: true, device };
  }

  /**
   * Switch to a different microphone.
   * @param {string} deviceId Input device id.
   * @returns {{selected: boolean, device: object}}
   */
  switchInputDevice(deviceId) {
    return this.selectInputDevice(deviceId);
  }

  /**
   * Return the selected microphone metadata.
   * @returns {object|null}
   */
  getSelectedInputDevice() {
    const devices = this.listInputDevices();
    return devices.find(device => device.id === this.selectedDeviceId) || this.getDefaultInputDevice();
  }

  /**
   * Refresh devices and emit events for lost, reconnected, and default changes.
   * @returns {{devices: object[], events: object[]}}
   */
  refreshDevices() {
    const previous = new Map(this.devices.map(device => [device.id, device]));
    const previousDefault = this.devices.find(device => device.isDefault);
    const devices = this.listInputDevices();
    const emitted = [];

    for (const device of devices) {
      const old = previous.get(device.id);
      if (old && old.connected && !device.connected) {
        emitted.push(this._emitDeviceEvent(AUDIO_EVENTS.AUDIO_DEVICE_LOST, device));
      } else if (old && !old.connected && device.connected) {
        this.metrics.reconnectCount += 1;
        emitted.push(this._emitDeviceEvent(AUDIO_EVENTS.AUDIO_DEVICE_RECONNECTED, device));
      } else if (!old) {
        emitted.push(this._emitDeviceEvent(AUDIO_EVENTS.AUDIO_DEVICE_CHANGED, device));
      }
    }

    const nextDefault = devices.find(device => device.isDefault);
    if ((previousDefault && nextDefault && previousDefault.id !== nextDefault.id) || (!previousDefault && nextDefault)) {
      emitted.push(this._emitDeviceEvent(AUDIO_EVENTS.AUDIO_DEFAULT_DEVICE_CHANGED, nextDefault));
    }

    return { devices, events: emitted };
  }

  /**
   * Return device manager metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Normalize provider-specific microphone metadata.
   * @param {object} device Raw device.
   * @returns {object}
   * @private
   */
  _normalizeDevice(device = {}) {
    return {
      id: String(device.id || device.deviceId || ''),
      displayName: String(device.displayName || device.label || device.name || 'Microphone'),
      manufacturer: String(device.manufacturer || ''),
      sampleRates: Array.isArray(device.sampleRates) ? device.sampleRates.map(Number) : [],
      channels: Number(device.channels || device.channelCount) || 1,
      isDefault: Boolean(device.isDefault || device.default),
      connected: device.connected !== false,
      kind: String(device.kind || 'audioinput')
    };
  }

  /**
   * Emit a normalized device event.
   * @param {string} eventName Event name.
   * @param {object} device Device metadata.
   * @returns {{eventName: string, device: object}}
   * @private
   */
  _emitDeviceEvent(eventName, device) {
    const payload = { eventName, device: { ...device } };
    this.metrics.deviceChangeCount += 1;
    this.events.emit(eventName, payload);
    this._log('Device Event', payload);
    return payload;
  }

  /**
   * Write a structured audio log when a logger is provided.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Audio] ${message}`, metadata);
    }
  }
}

module.exports = AudioDeviceManager;
