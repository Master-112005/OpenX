const assert = require('assert');

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {}
  };
}

function createSignalRecorder() {
  const events = [];
  return {
    SIGNAL_EVENTS: require('../../core/context-awareness/signals').SIGNAL_EVENTS,
    events,
    emit(event, payload) {
      events.push({ event, payload });
      return { event, payload, timestamp: Date.now() };
    }
  };
}

describe('Device Detection', function() {
  it('should normalize and classify audio devices', function() {
    const audioDevices = require('../../core/device-detection/audio-devices');

    const device = audioDevices.normalizeAudioDevice({
      id: 'device-id',
      name: 'WH-1000XM4 Bluetooth'
    }, { active: true });

    assert.equal(device.name, 'WH-1000XM4 Bluetooth');
    assert.equal(device.type, 'bluetooth-headphones');
    assert.equal(device.active, true);
    assert.equal(audioDevices.classifyAudioDevice('Realtek Speakers'), 'speaker');
  });

  it('should detect headphone and bluetooth devices', function() {
    const headphones = require('../../core/device-detection/headphones');

    assert.equal(headphones.isBluetoothDevice({ name: 'Bluetooth Headset', type: 'bluetooth-headphones' }), true);
    assert.equal(headphones.isHeadphoneDevice({ name: 'WH-1000XM4', type: 'wired-headphones' }), true);
    assert.equal(headphones.isHeadphoneDevice({ name: 'Realtek Speakers', type: 'speaker' }), false);
  });

  it('should report whether headphones are connected', async function() {
    const headphones = require('../../core/device-detection/headphones');
    const detector = headphones.createDetector({
      audioManager: {
        async getCurrentAudioDevice() {
          return { name: 'WH-1000XM4', type: 'bluetooth-headphones', active: true, id: '1', timestamp: Date.now() };
        },
        async getAudioDevices() {
          return [{ name: 'WH-1000XM4', type: 'bluetooth-headphones', active: true, id: '1', timestamp: Date.now() }];
        }
      }
    });

    assert.equal(await detector.isHeadphonesConnected(), true);
    assert.equal((await detector.getCurrentAudioDevice()).name, 'WH-1000XM4');
  });

  it('should emit debounced audio device change events', async function() {
    const deviceEvents = require('../../core/device-detection/device-events');
    const signalRecorder = createSignalRecorder();
    const states = [
      {
        current: { name: 'Speakers', type: 'speaker', active: true, id: 'speaker', timestamp: Date.now() },
        devices: [{ name: 'Speakers', type: 'speaker', active: true, id: 'speaker', timestamp: Date.now() }]
      },
      {
        current: { name: 'WH-1000XM4', type: 'bluetooth-headphones', active: true, id: 'headphones', timestamp: Date.now() },
        devices: [{ name: 'WH-1000XM4', type: 'bluetooth-headphones', active: true, id: 'headphones', timestamp: Date.now() }]
      }
    ];

    const monitor = deviceEvents.createMonitor({
      logger: silentLogger(),
      signals: signalRecorder,
      debounceMs: 100,
      audioManager: {
        async getCurrentAudioDevice() {
          return states[0].current;
        },
        async getAudioDevices() {
          const state = states.shift() || states[0];
          return state.devices;
        }
      }
    });

    await monitor.pollOnce();
    await new Promise(resolve => setTimeout(resolve, 120));
    await monitor.pollOnce();
    await new Promise(resolve => setTimeout(resolve, 120));

    assert.ok(signalRecorder.events.some(item => item.event === signalRecorder.SIGNAL_EVENTS.AUDIO_DEVICE_CHANGED));
    assert.ok(signalRecorder.events.some(item => item.event === signalRecorder.SIGNAL_EVENTS.HEADPHONES_CONNECTED));
    monitor.stop();
  });
});
