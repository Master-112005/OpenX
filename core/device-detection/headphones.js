const audioDevices = require('./audio-devices');

function isBluetoothDevice(device) {
  const name = String(device?.name || '').toLowerCase();
  const type = String(device?.type || '').toLowerCase();
  return type.includes('bluetooth') || name.includes('bluetooth');
}

function isHeadphoneDevice(device) {
  const type = String(device?.type || '').toLowerCase();
  const name = String(device?.name || '').toLowerCase();
  return (
    type.includes('headphone') ||
    type.includes('headset') ||
    /(headphone|headset|earbud|airpods|wh-|buds)/i.test(name)
  );
}

class HeadphonesDetector {
  constructor(options = {}) {
    this.audioManager = options.audioManager || audioDevices.createManager(options);
  }

  async getCurrentAudioDevice() {
    return this.audioManager.getCurrentAudioDevice();
  }

  async isHeadphonesConnected() {
    const devices = await this.audioManager.getAudioDevices();
    return devices.some(device => isHeadphoneDevice(device));
  }

  isBluetoothDevice(device) {
    return isBluetoothDevice(device);
  }
}

const defaultDetector = new HeadphonesDetector();

module.exports = {
  HeadphonesDetector,
  isBluetoothDevice,
  isHeadphoneDevice,
  createDetector: options => new HeadphonesDetector(options),
  isHeadphonesConnected: defaultDetector.isHeadphonesConnected.bind(defaultDetector),
  getCurrentAudioDevice: defaultDetector.getCurrentAudioDevice.bind(defaultDetector)
};
