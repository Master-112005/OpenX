'use strict';

/**
 * Purpose: Public entry point for OpenX Voice Audio Layer modules.
 * Responsibility: Export audio capture, device, permission, buffer, frame, configuration, event, and error classes.
 * Dependencies: Audio Layer modules only.
 * Thread ownership: Importers should depend on these public exports rather than deep implementation paths.
 * Future integration notes: VoiceSessionManager should be the only lifecycle owner for AudioCapture instances.
 */

const AudioCapture = require('./AudioCapture');
const AudioDeviceManager = require('./AudioDeviceManager');
const AudioBuffer = require('./AudioBuffer');
const AudioPermissions = require('./AudioPermissions');
const AudioConfiguration = require('./AudioConfiguration');
const AudioFrame = require('./AudioFrame');
const AUDIO_EVENTS = require('./AudioEvents');
const AudioErrors = require('./AudioErrors');

module.exports = {
  AudioCapture,
  AudioDeviceManager,
  AudioBuffer,
  AudioPermissions,
  AudioConfiguration,
  AudioFrame,
  AUDIO_EVENTS,
  ...AudioErrors
};
