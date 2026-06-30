'use strict';

/**
 * Purpose: Defines the future audio device discovery boundary.
 * Responsibility: Provide documented placeholders for device listing and selection.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Windows, Electron, or native device APIs must be hidden behind this module later.
 */
class AudioDeviceManager {
  /**
   * Return an empty device list because discovery is out of scope.
   * @returns {Array<object>}
   */
  listInputDevices() {
    return [];
  }

  /**
   * Store no selection and return a placeholder result.
   * @param {string} deviceId Future input device id.
   * @returns {{selected: boolean, deviceId: string}}
   */
  selectInputDevice(deviceId) {
    return { selected: false, deviceId: String(deviceId || '') };
  }

  /**
   * Return placeholder default device metadata.
   * @returns {null}
   */
  getDefaultInputDevice() {
    return null;
  }
}

module.exports = AudioDeviceManager;
