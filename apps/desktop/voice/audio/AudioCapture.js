'use strict';

const EventEmitter = require('events');
const AudioConfiguration = require('./AudioConfiguration');
const AudioDeviceManager = require('./AudioDeviceManager');
const AudioPermissions = require('./AudioPermissions');
const AudioBuffer = require('./AudioBuffer');
const AudioFrame = require('./AudioFrame');
const AUDIO_EVENTS = require('./AudioEvents');
const {
  CaptureFailedError,
  DeviceDisconnectedError,
  InitializationFailedError,
  MicrophoneNotFoundError,
  AudioError
} = require('./AudioErrors');

const CAPTURE_STATES = Object.freeze({
  IDLE: 'IDLE',
  INITIALIZED: 'INITIALIZED',
  CAPTURING: 'CAPTURING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
  CLOSED: 'CLOSED'
});

/**
 * Purpose: Owns raw PCM microphone capture for the OpenX Audio Layer.
 * Responsibility: Initialize capture, start/stop/pause/resume recording, expose AudioFrame objects, and release capture resources.
 * Dependencies: AudioConfiguration, AudioDeviceManager, AudioPermissions, AudioBuffer, AudioFrame, AudioEvents, and injectable capture backend.
 * Thread ownership: This class owns the active capture session and prevents duplicate starts; backend callbacks must feed frames through receiveFrame.
 * Future integration notes: Native microphone access belongs behind the injected backend only; this class must never perform STT, VAD, silence detection, or preprocessing.
 */
class AudioCapture {
  /**
   * Create an audio capture controller.
   * @param {{configuration?: AudioConfiguration|object, deviceManager?: AudioDeviceManager, permissions?: AudioPermissions, buffer?: AudioBuffer, backend?: object, logger?: object, metrics?: object, clock?: () => Date}} dependencies Capture dependencies.
   */
  constructor(dependencies = {}) {
    this.configuration = dependencies.configuration instanceof AudioConfiguration
      ? dependencies.configuration
      : new AudioConfiguration(dependencies.configuration || {});
    this.deviceManager = dependencies.deviceManager || new AudioDeviceManager();
    this.permissions = dependencies.permissions || new AudioPermissions();
    this.buffer = dependencies.buffer || new AudioBuffer({ configuration: this.configuration });
    this.backend = dependencies.backend || {};
    this.logger = dependencies.logger || null;
    this.metricsRecorder = dependencies.metrics || null;
    this.clock = dependencies.clock || (() => new Date());
    this.events = new EventEmitter();
    this.state = CAPTURE_STATES.IDLE;
    this.activeDevice = null;
    this.frameIndex = 0;
    this.startedAt = null;
    this.pausedAt = null;
    this.metrics = {
      framesCaptured: 0,
      droppedFrames: 0,
      captureDurationMs: 0,
      reconnectCount: 0,
      deviceSwitchCount: 0,
      permissionFailures: 0
    };
  }

  /**
   * Return supported capture states.
   * @returns {Readonly<Record<string, string>>}
   */
  static get STATES() {
    return CAPTURE_STATES;
  }

  /**
   * Subscribe to capture events.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioCapture}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a capture event listener.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioCapture}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Replace capture configuration before the device is opened.
   * @param {object|AudioConfiguration} settings Audio settings.
   * @returns {{ready: boolean, settings: object}}
   */
  configure(settings = {}) {
    if (this.state === CAPTURE_STATES.CAPTURING || this.state === CAPTURE_STATES.PAUSED) {
      throw new CaptureFailedError('Cannot reconfigure audio capture while recording.');
    }
    this.configuration = settings instanceof AudioConfiguration ? settings : this.configuration.merge(settings);
    this.buffer = new AudioBuffer({ configuration: this.configuration });
    return { ready: this.state === CAPTURE_STATES.INITIALIZED, settings: this.configuration.toJSON() };
  }

  /**
   * Initialize permission, device, and backend ownership without starting transcription.
   * @param {{deviceId?: string}} options Initialization options.
   * @returns {{initialized: boolean, device: object, configuration: object}}
   */
  initialize(options = {}) {
    try {
      this.permissions.verifyMicrophonePermission();
      const device = this._resolveDevice(options.deviceId || this.configuration.preferredDeviceId);
      this.activeDevice = device;
      if (typeof this.backend.open === 'function') {
        this.backend.open({
          device,
          configuration: this.configuration,
          onFrame: frame => this.receiveFrame(frame),
          onDeviceLost: event => this.handleDeviceLost(event),
          onError: error => this._handleBackendError(error)
        });
      }
      this.state = CAPTURE_STATES.INITIALIZED;
      this._publish(AUDIO_EVENTS.AUDIO_INITIALIZED, {
        device,
        configuration: this.configuration.toJSON()
      });
      this._log('Initialized', { device, sampleRate: this.configuration.sampleRate, channels: this.configuration.channels });
      return { initialized: true, device, configuration: this.configuration.toJSON() };
    } catch (error) {
      this._publish(AUDIO_EVENTS.AUDIO_ERROR, { error: this._normalizeError(error) });
      if (error instanceof AudioError) throw error;
      throw new InitializationFailedError('Audio initialization failed.', {
        details: this._normalizeError(error)
      });
    }
  }

  /**
   * Start raw PCM capture.
   * @param {{deviceId?: string}} options Start options.
   * @returns {{started: boolean, device: object, state: string}}
   */
  start(options = {}) {
    if (this.state === CAPTURE_STATES.CAPTURING) {
      throw new CaptureFailedError('Audio capture is already running.');
    }
    if (this.state === CAPTURE_STATES.IDLE || this.state === CAPTURE_STATES.STOPPED || this.state === CAPTURE_STATES.CLOSED) {
      this.initialize(options);
    }
    if (!this.activeDevice || !this.activeDevice.connected) {
      throw new DeviceDisconnectedError('Cannot start capture without a connected microphone.');
    }
    if (typeof this.backend.start === 'function') {
      try {
        this.backend.start({
          device: this.activeDevice,
          configuration: this.configuration,
          onFrame: frame => this.receiveFrame(frame)
        });
      } catch (error) {
        throw new CaptureFailedError('Audio capture failed to start.', {
          details: this._normalizeError(error)
        });
      }
    }
    this.startedAt = this.clock();
    this.state = CAPTURE_STATES.CAPTURING;
    this._recordMetric('audio.capture.start', 1);
    this._publish(AUDIO_EVENTS.AUDIO_STARTED, this.getStatus());
    this._log('Started', { device: this.activeDevice });
    return { started: true, device: { ...this.activeDevice }, state: this.state };
  }

  /**
   * Stop raw PCM capture while keeping the device reusable.
   * @returns {{stopped: boolean, state: string}}
   */
  stop() {
    if (this.state === CAPTURE_STATES.IDLE || this.state === CAPTURE_STATES.STOPPED || this.state === CAPTURE_STATES.CLOSED) {
      return { stopped: false, state: this.state };
    }
    if (typeof this.backend.stop === 'function') {
      this.backend.stop();
    }
    this._updateCaptureDuration();
    this.state = CAPTURE_STATES.STOPPED;
    this._publish(AUDIO_EVENTS.AUDIO_STOPPED, this.getStatus());
    this._log('Stopped', this.getStatus());
    return { stopped: true, state: this.state };
  }

  /**
   * Pause raw PCM capture.
   * @returns {{paused: boolean, state: string}}
   */
  pause() {
    if (this.state !== CAPTURE_STATES.CAPTURING) {
      throw new CaptureFailedError('Audio capture can only pause while capturing.');
    }
    if (typeof this.backend.pause === 'function') {
      this.backend.pause();
    }
    this.pausedAt = this.clock();
    this.state = CAPTURE_STATES.PAUSED;
    this._publish(AUDIO_EVENTS.AUDIO_PAUSED, this.getStatus());
    return { paused: true, state: this.state };
  }

  /**
   * Resume raw PCM capture after a pause.
   * @returns {{resumed: boolean, state: string}}
   */
  resume() {
    if (this.state !== CAPTURE_STATES.PAUSED) {
      throw new CaptureFailedError('Audio capture can only resume from PAUSED.');
    }
    if (typeof this.backend.resume === 'function') {
      this.backend.resume();
    }
    this.pausedAt = null;
    this.state = CAPTURE_STATES.CAPTURING;
    this._publish(AUDIO_EVENTS.AUDIO_RESUMED, this.getStatus());
    return { resumed: true, state: this.state };
  }

  /**
   * Close the capture device and release temporary resources.
   * @returns {{closed: boolean, state: string}}
   */
  close() {
    if (this.state === CAPTURE_STATES.CAPTURING || this.state === CAPTURE_STATES.PAUSED) {
      this.stop();
    }
    if (typeof this.backend.close === 'function') {
      this.backend.close();
    }
    this.activeDevice = null;
    this.state = CAPTURE_STATES.CLOSED;
    this._publish(AUDIO_EVENTS.AUDIO_CLOSED, this.getStatus());
    this._log('Closed', this.getStatus());
    return { closed: true, state: this.state };
  }

  /**
   * Receive one raw PCM frame from the backend.
   * @param {AudioFrame|object} frame Frame or frame options.
   * @returns {AudioFrame}
   */
  receiveFrame(frame) {
    if (this.state !== CAPTURE_STATES.CAPTURING) {
      throw new CaptureFailedError('Audio frames can only be received while capturing.');
    }
    const audioFrame = frame instanceof AudioFrame
      ? frame
      : new AudioFrame({
        frameIndex: this.frameIndex,
        sampleRate: this.configuration.sampleRate,
        channels: this.configuration.channels,
        bitDepth: this.configuration.bitDepth,
        deviceId: this.activeDevice ? this.activeDevice.id : '',
        ...frame
      });
    this.frameIndex = audioFrame.frameIndex + 1;
    this.buffer.pushFrame(audioFrame);
    this.metrics.framesCaptured += 1;
    this._recordMetric('audio.frames.captured', 1);
    this._publish(AUDIO_EVENTS.AUDIO_FRAME, { frame: audioFrame, metadata: audioFrame.toMetadata() });
    return audioFrame;
  }

  /**
   * Read the next captured frame.
   * @returns {AudioFrame|null}
   */
  readFrame() {
    return this.buffer.readFrame();
  }

  /**
   * Return the capture buffer manager.
   * @returns {AudioBuffer}
   */
  getBuffer() {
    return this.buffer;
  }

  /**
   * Handle an active device loss notification.
   * @param {object} event Device loss event.
   * @returns {{handled: boolean, state: string}}
   */
  handleDeviceLost(event = {}) {
    this._publish(AUDIO_EVENTS.AUDIO_DEVICE_LOST, {
      device: this.activeDevice,
      reason: String(event.reason || 'device-lost')
    });
    if (this.state === CAPTURE_STATES.CAPTURING || this.state === CAPTURE_STATES.PAUSED) {
      this.stop();
    }
    return { handled: true, state: this.state };
  }

  /**
   * Handle a reconnect notification from the device manager or backend.
   * @param {object} device Device metadata.
   * @returns {{handled: boolean, device: object|null}}
   */
  handleDeviceReconnected(device = {}) {
    this.metrics.reconnectCount += 1;
    const normalized = device.id ? { ...device, connected: device.connected !== false } : null;
    this._publish(AUDIO_EVENTS.AUDIO_DEVICE_RECONNECTED, { device: normalized });
    return { handled: true, device: normalized };
  }

  /**
   * Return capture status metadata.
   * @returns {{available: boolean, capturing: boolean, paused: boolean, state: string, device: object|null, configuration: object, buffer: object}}
   */
  getStatus() {
    return {
      available: Boolean(this.activeDevice),
      capturing: this.state === CAPTURE_STATES.CAPTURING,
      paused: this.state === CAPTURE_STATES.PAUSED,
      state: this.state,
      device: this.activeDevice ? { ...this.activeDevice } : null,
      configuration: this.configuration.toJSON(),
      buffer: this.buffer.getStatus()
    };
  }

  /**
   * Return capture metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      droppedFrames: this.buffer.getMetrics().droppedFrames
    };
  }

  /**
   * Resolve and select a microphone device.
   * @param {string} preferredDeviceId Preferred device id.
   * @returns {object}
   * @private
   */
  _resolveDevice(preferredDeviceId = '') {
    const preferredId = String(preferredDeviceId || '');
    if (preferredId) {
      return this.deviceManager.selectInputDevice(preferredId).device;
    }
    const device = this.deviceManager.getSelectedInputDevice();
    if (!device) {
      throw new MicrophoneNotFoundError('No microphone devices are available.');
    }
    if (!device.connected) {
      throw new DeviceDisconnectedError('Selected microphone is disconnected.', { details: { deviceId: device.id } });
    }
    return this.deviceManager.selectInputDevice(device.id).device;
  }

  /**
   * Update accumulated capture duration.
   * @returns {void}
   * @private
   */
  _updateCaptureDuration() {
    if (!this.startedAt) return;
    this.metrics.captureDurationMs += Math.max(0, this.clock().getTime() - this.startedAt.getTime());
    this.startedAt = null;
  }

  /**
   * Publish a capture event.
   * @param {string} eventName Event name.
   * @param {object} payload Event payload.
   * @returns {void}
   * @private
   */
  _publish(eventName, payload = {}) {
    this.events.emit(eventName, Object.freeze({ ...payload, eventName }));
  }

  /**
   * Normalize and publish backend failures.
   * @param {Error|string|object} error Backend error.
   * @returns {void}
   * @private
   */
  _handleBackendError(error) {
    const normalized = this._normalizeError(error);
    this._publish(AUDIO_EVENTS.AUDIO_ERROR, { error: normalized });
    this._log('Error', normalized);
  }

  /**
   * Normalize error metadata for events.
   * @param {Error|string|object} error Error input.
   * @returns {object}
   * @private
   */
  _normalizeError(error) {
    if (error && typeof error.toJSON === 'function') return error.toJSON();
    if (error instanceof Error) {
      return { name: error.name, message: error.message };
    }
    if (error && typeof error === 'object') {
      return {
        name: String(error.name || 'AudioError'),
        message: String(error.message || 'Audio capture failed.')
      };
    }
    return { name: 'AudioError', message: String(error || 'Audio capture failed.') };
  }

  /**
   * Record a metric through an injected recorder.
   * @param {string} name Metric name.
   * @param {number} value Metric value.
   * @returns {void}
   * @private
   */
  _recordMetric(name, value) {
    if (this.metricsRecorder && typeof this.metricsRecorder.increment === 'function') {
      this.metricsRecorder.increment(name, value);
    }
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

module.exports = AudioCapture;
