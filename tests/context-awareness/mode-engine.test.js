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
  const { SIGNAL_EVENTS } = require('../../core/context-awareness/signals');
  const subscriptions = new Map();
  const events = [];

  return {
    SIGNAL_EVENTS,
    events,
    emit(event, payload) {
      events.push({ event, payload });
      const envelope = { event, payload, timestamp: Date.now() };
      (subscriptions.get(event) || []).forEach(callback => callback(envelope));
      (subscriptions.get('*') || []).forEach(callback => callback(envelope));
      return envelope;
    },
    subscribe(event, callback) {
      if (!subscriptions.has(event)) subscriptions.set(event, []);
      subscriptions.get(event).push(callback);
      return () => {
        const callbacks = subscriptions.get(event) || [];
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      };
    }
  };
}

describe('Mode Engine and Context Intelligence', function() {
  it('should aggregate Phase 1 signals into a context snapshot', function() {
    const { ContextEngine } = require('../../core/context-awareness/context-engine');
    const signalRecorder = createSignalRecorder();
    const engine = new ContextEngine({
      logger: silentLogger(),
      signals: signalRecorder,
      now: () => 1000
    });

    engine.start();
    signalRecorder.emit(signalRecorder.SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED, {
      app: 'Code.exe',
      title: 'OpenX - Visual Studio Code',
      path: 'C:\\Code.exe',
      pid: 42,
      timestamp: 1000
    });
    signalRecorder.emit(signalRecorder.SIGNAL_EVENTS.PROCESS_STARTED, { name: 'Docker Desktop.exe' });
    signalRecorder.emit(signalRecorder.SIGNAL_EVENTS.AUDIO_DEVICE_CHANGED, { name: 'WH-1000XM4' });

    const snapshot = engine.getSnapshot();
    assert.equal(snapshot.activeApp, 'Code.exe');
    assert.equal(snapshot.activeTitle, 'OpenX - Visual Studio Code');
    assert.ok(snapshot.runningApps.includes('Docker Desktop.exe'));
    assert.equal(snapshot.audioDevice, 'WH-1000XM4');
    assert.equal(snapshot.currentMode, null);
    assert.ok(snapshot.activityHistory.length >= 3);
    engine.stop();
  });

  it('should compute weighted mode scores and select a dominant mode', function() {
    const { ModeEngine, MODES } = require('../../core/context-awareness/mode-engine');
    const engine = new ModeEngine({
      logger: silentLogger(),
      smoothingFactor: 1,
      threshold: 60
    });

    const scores = engine.computeRawScores({
      activeApp: 'Code.exe',
      activeTitle: 'OpenX - Visual Studio Code',
      runningApps: ['Code.exe', 'Docker Desktop.exe'],
      audioDevice: 'Speakers',
      fullscreen: false
    });

    assert.ok(scores.DEV_MODE > 60);
    assert.equal(engine.getDominantMode(scores), MODES.DEV_MODE);
  });

  it('should require persistent dominance before entering a mode', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    const signalRecorder = createSignalRecorder();
    let now = 0;
    const contextEngine = {
      updateMode() {},
      getSnapshot() { return {}; },
      subscribe() { return () => {}; },
      start() {},
      stop() {}
    };
    const engine = new ModeEngine({
      logger: silentLogger(),
      signals: signalRecorder,
      contextEngine,
      now: () => now,
      smoothingFactor: 1,
      threshold: 60,
      minDominantMs: 10000,
      minModeDurationMs: 0,
      cooldownMs: 0
    });
    const snapshot = {
      activeApp: 'Code.exe',
      activeTitle: 'OpenX',
      runningApps: ['Code.exe', 'Docker Desktop.exe'],
      fullscreen: false
    };

    engine.evaluate(snapshot);
    now = 5000;
    engine.evaluate(snapshot);
    assert.equal(engine.getState().currentMode, null);

    now = 10000;
    engine.evaluate(snapshot);
    assert.equal(engine.getState().currentMode, 'DEV_MODE');
    assert.ok(signalRecorder.events.some(item => item.event === signalRecorder.SIGNAL_EVENTS.MODE_ENTERED));
  });

  it('should prevent rapid mode switching during minimum duration and cooldown windows', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    const signalRecorder = createSignalRecorder();
    let now = 0;
    const contextEngine = {
      updateMode() {},
      getSnapshot() { return {}; },
      subscribe() { return () => {}; },
      start() {},
      stop() {}
    };
    const engine = new ModeEngine({
      logger: silentLogger(),
      signals: signalRecorder,
      contextEngine,
      now: () => now,
      smoothingFactor: 1,
      threshold: 60,
      minDominantMs: 0,
      minModeDurationMs: 15000,
      cooldownMs: 5000,
      hysteresis: 10
    });

    const devSnapshot = {
      activeApp: 'Code.exe',
      activeTitle: 'OpenX',
      runningApps: ['Code.exe', 'Docker Desktop.exe'],
      fullscreen: false
    };
    const streamSnapshot = {
      activeApp: 'obs64.exe',
      activeTitle: 'OBS Stream',
      runningApps: ['obs64.exe'],
      microphoneActive: true,
      fullscreen: true
    };

    engine.evaluate(devSnapshot);
    engine.evaluate(devSnapshot);
    assert.equal(engine.getState().currentMode, 'DEV_MODE');

    now = 5000;
    engine.evaluate(streamSnapshot);
    engine.evaluate(streamSnapshot);
    assert.equal(engine.getState().currentMode, 'DEV_MODE');

    now = 16000;
    engine.evaluate(streamSnapshot);
    assert.equal(engine.getState().currentMode, 'STREAM_MODE');

    now = 17000;
    engine.evaluate(devSnapshot);
    engine.evaluate(devSnapshot);
    assert.equal(engine.getState().currentMode, 'STREAM_MODE');
  });

  it('should decay scores when a mode no longer has supporting context', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    const engine = new ModeEngine({
      logger: silentLogger(),
      smoothingFactor: 1,
      scoreDecay: 0.5,
      threshold: 60
    });

    engine.evaluate({
      activeApp: 'Code.exe',
      activeTitle: 'OpenX',
      runningApps: ['Code.exe', 'Docker Desktop.exe']
    });
    engine.evaluate({
      activeApp: 'notepad.exe',
      activeTitle: 'Notes',
      runningApps: []
    });

    assert.equal(engine.getState().scores.DEV_MODE, 0);
  });

  it('should expose mode behavior after a transition', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    const signalRecorder = createSignalRecorder();
    const contextEngine = {
      updateMode() {},
      getSnapshot() { return {}; },
      subscribe() { return () => {}; },
      start() {},
      stop() {}
    };
    const engine = new ModeEngine({
      logger: silentLogger(),
      signals: signalRecorder,
      contextEngine,
      smoothingFactor: 1,
      threshold: 60,
      minDominantMs: 0,
      minModeDurationMs: 0,
      cooldownMs: 0
    });

    const snapshot = {
      activeApp: 'Spotify.exe',
      activeTitle: 'Spotify',
      runningApps: ['Spotify.exe'],
      audioDevice: 'WH-1000XM4'
    };

    engine.evaluate(snapshot);
    engine.evaluate(snapshot);

    const state = engine.getState();
    assert.equal(state.currentMode, 'MEDIA_MODE');
    assert.equal(state.behavior.prioritizeMediaCommands, true);
  });

  it('should exit the current mode once supporting context disappears', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    const signalRecorder = createSignalRecorder();
    const modeUpdates = [];
    let now = 0;
    const contextEngine = {
      updateMode(state) { modeUpdates.push(state.currentMode); },
      getSnapshot() { return {}; },
      subscribe() { return () => {}; },
      start() {},
      stop() {}
    };
    const engine = new ModeEngine({
      logger: silentLogger(),
      signals: signalRecorder,
      contextEngine,
      now: () => now,
      smoothingFactor: 1,
      threshold: 60,
      minDominantMs: 0,
      minModeDurationMs: 10000,
      cooldownMs: 0
    });

    engine.evaluate({
      activeApp: 'obs64.exe',
      activeTitle: 'OBS Stream',
      runningApps: ['obs64.exe'],
      microphoneActive: true,
      fullscreen: true
    });
    engine.evaluate({
      activeApp: 'obs64.exe',
      activeTitle: 'OBS Stream',
      runningApps: ['obs64.exe'],
      microphoneActive: true,
      fullscreen: true
    });
    assert.equal(engine.getState().currentMode, 'STREAM_MODE');

    now = 5000;
    engine.evaluate({ activeApp: 'notepad.exe', activeTitle: 'Notes', runningApps: [] });
    assert.equal(engine.getState().currentMode, 'STREAM_MODE');

    now = 10000;
    engine.evaluate({ activeApp: 'notepad.exe', activeTitle: 'Notes', runningApps: [] });

    assert.equal(engine.getState().currentMode, null);
    assert.deepEqual(modeUpdates, ['STREAM_MODE', null]);
    assert.equal(signalRecorder.events.filter(item => item.event === signalRecorder.SIGNAL_EVENTS.MODE_EXITED).length, 1);
    assert.equal(signalRecorder.events.filter(item => item.event === signalRecorder.SIGNAL_EVENTS.MODE_CHANGED).length, 1);
  });

  it('should not duplicate subscriptions when started repeatedly', function() {
    const { ModeEngine } = require('../../core/context-awareness/mode-engine');
    let subscriptions = 0;
    let unsubscriptions = 0;
    const contextEngine = {
      updateMode() {},
      getSnapshot() { return {}; },
      subscribe() {
        subscriptions += 1;
        return () => { unsubscriptions += 1; };
      },
      start() {},
      stop() {}
    };
    const engine = new ModeEngine({
      logger: silentLogger(),
      contextEngine
    });

    engine.start();
    engine.start();
    engine.stop();
    engine.stop();

    assert.equal(subscriptions, 1);
    assert.equal(unsubscriptions, 1);
  });
});
