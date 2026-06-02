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

describe('Context Awareness', function() {
  it('should expose required signal events and support subscriptions', function() {
    const { EnvironmentSignals, SIGNAL_EVENTS } = require('../../core/context-awareness/signals');
    const localSignals = new EnvironmentSignals();
    const received = [];

    const unsubscribe = localSignals.subscribe(SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED, envelope => {
      received.push(envelope);
    });

    localSignals.emit(SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED, { app: 'Code.exe' });
    unsubscribe();
    localSignals.emit(SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED, { app: 'Chrome.exe' });

    assert.equal(received.length, 1);
    assert.equal(received[0].payload.app, 'Code.exe');
  });

  it('should categorize known applications', function() {
    const registry = require('../../core/context-awareness/app-registry');

    assert.ok(registry.DEV_APPS.includes('Code.exe'));
    assert.ok(registry.getCategoriesForApp('code.exe').includes('DEV_APPS'));
    assert.ok(registry.getCategoriesForApp('OUTLOOK.EXE').includes('WORK_APPS'));
    assert.equal(registry.isKnownApp('unknown.exe'), false);
  });

  it('should detect active window changes with a 500ms polling contract', async function() {
    const activeWindow = require('../../core/context-awareness/active-window');
    const signalRecorder = createSignalRecorder();
    const monitor = activeWindow.createMonitor({
      logger: silentLogger(),
      signals: signalRecorder,
      activeWin: async () => ({
        title: 'OpenX - Visual Studio Code',
        owner: {
          name: 'Code.exe',
          path: 'C:\\Program Files\\Microsoft VS Code\\Code.exe',
          processId: 1234
        }
      })
    });

    const received = [];
    monitor.subscribe(windowInfo => received.push(windowInfo));
    await monitor.pollOnce();

    assert.equal(activeWindow.ACTIVE_WINDOW_POLL_MS, 500);
    assert.equal(monitor.getCurrentWindow().app, 'Code.exe');
    assert.equal(monitor.getCurrentWindow().pid, 1234);
    assert.equal(received.length, 1);
    assert.equal(signalRecorder.events[0].event, signalRecorder.SIGNAL_EVENTS.ACTIVE_WINDOW_CHANGED);
  });

  it('should propagate fullscreen changes from active window detection', async function() {
    const activeWindow = require('../../core/context-awareness/active-window');
    const signalRecorder = createSignalRecorder();
    const monitor = activeWindow.createMonitor({
      logger: silentLogger(),
      signals: signalRecorder,
      activeWin: async () => ({
        title: 'Fullscreen Game',
        fullscreen: true,
        owner: {
          name: 'game.exe',
          path: 'C:\\Games\\game.exe',
          processId: 9001
        }
      })
    });

    await monitor.pollOnce();

    assert.equal(monitor.getCurrentWindow().fullscreen, true);
    assert.equal(signalRecorder.events[0].payload.fullscreen, true);
  });

  it('should track process start and stop events', async function() {
    const processMonitor = require('../../core/context-awareness/process-monitor');
    const signalRecorder = createSignalRecorder();
    const snapshots = [
      JSON.stringify([{ ProcessId: 1, Name: 'Code.exe', ExecutablePath: 'C:\\Code.exe' }]),
      JSON.stringify([
        { ProcessId: 1, Name: 'Code.exe', ExecutablePath: 'C:\\Code.exe' },
        { ProcessId: 2, Name: 'Spotify.exe', ExecutablePath: 'C:\\Spotify.exe' }
      ]),
      JSON.stringify([{ ProcessId: 2, Name: 'Spotify.exe', ExecutablePath: 'C:\\Spotify.exe' }])
    ];

    const monitor = processMonitor.createMonitor({
      logger: silentLogger(),
      signals: signalRecorder,
      runner: async () => snapshots.shift()
    });

    await monitor.pollOnce();
    await monitor.pollOnce();
    await monitor.pollOnce();

    assert.equal(monitor.isRunning('Spotify.exe'), true);
    assert.equal(monitor.isRunning('Code.exe'), false);
    assert.ok(signalRecorder.events.some(item => item.event === signalRecorder.SIGNAL_EVENTS.PROCESS_STARTED && item.payload.name === 'Spotify.exe'));
    assert.ok(signalRecorder.events.some(item => item.event === signalRecorder.SIGNAL_EVENTS.PROCESS_STOPPED && item.payload.name === 'Code.exe'));
  });

  it('should update microphone activity in context snapshots', function() {
    const { ContextEngine } = require('../../core/context-awareness/context-engine');
    const signalRecorder = createSignalRecorder();
    const subscriptions = new Map();
    signalRecorder.subscribe = (event, callback) => {
      if (!subscriptions.has(event)) subscriptions.set(event, []);
      subscriptions.get(event).push(callback);
      return () => {
        const callbacks = subscriptions.get(event) || [];
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      };
    };
    signalRecorder.emit = (event, payload) => {
      signalRecorder.events.push({ event, payload });
      const envelope = { event, payload, timestamp: Date.now() };
      (subscriptions.get(event) || []).forEach(callback => callback(envelope));
      return envelope;
    };
    const engine = new ContextEngine({
      logger: silentLogger(),
      signals: signalRecorder
    });

    engine.start();
    signalRecorder.emit(signalRecorder.SIGNAL_EVENTS.MICROPHONE_ACTIVITY_CHANGED, { active: true });

    assert.equal(engine.getSnapshot().microphoneActive, true);
    engine.stop();
  });
});
