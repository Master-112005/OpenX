const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Voice Subsystem Architecture', function() {
  const voiceRoot = path.join(__dirname, '..', '..', 'apps', 'desktop', 'voice');

  it('should expose the complete public architecture surface from index.js', function() {
    const voice = require('../../apps/desktop/voice');
    const expectedExports = [
      'VoiceSessionManager',
      'VoiceSession',
      'VoiceStateMachine',
      'SESSION_EVENTS',
      'VOICE_ERROR_TYPES',
      'AudioCapture',
      'AudioDeviceManager',
      'AudioBuffer',
      'AudioPermissions',
      'AudioPipeline',
      'VoiceActivityDetector',
      'RNNoiseProcessor',
      'STTEngine',
      'ParakeetEngine',
      'SherpaRuntime',
      'TranscriptAssembler',
      'TranscriptNormalizer',
      'VoiceOverlay',
      'TranscriptPublisher',
      'VoiceSettings',
      'VoiceLogger',
      'VoiceMetrics'
    ];

    for (const key of expectedExports) {
      assert.ok(Object.prototype.hasOwnProperty.call(voice, key), `${key} export is missing`);
    }
  });

  it('should keep the requested folder and file structure in place', function() {
    const expectedFiles = [
      'index.js',
      'session/VoiceSessionManager.js',
      'session/VoiceSession.js',
      'session/VoiceStateMachine.js',
      'session/SessionEvents.js',
      'audio/AudioCapture.js',
      'audio/AudioDeviceManager.js',
      'audio/AudioBuffer.js',
      'audio/AudioPermissions.js',
      'preprocessing/AudioPipeline.js',
      'preprocessing/VoiceActivityDetector.js',
      'preprocessing/RNNoiseProcessor.js',
      'stt/STTEngine.js',
      'stt/ParakeetEngine.js',
      'stt/SherpaRuntime.js',
      'stt/TranscriptAssembler.js',
      'normalization/TranscriptNormalizer.js',
      'ui/VoiceOverlay.js',
      'ui/TranscriptPublisher.js',
      'config/VoiceSettings.js',
      'diagnostics/VoiceLogger.js',
      'diagnostics/VoiceMetrics.js'
    ];

    for (const relativePath of expectedFiles) {
      assert.equal(fs.existsSync(path.join(voiceRoot, relativePath)), true, `${relativePath} missing`);
    }
  });

  it('should validate deterministic state transitions', function() {
    const { VoiceStateMachine } = require('../../apps/desktop/voice');
    const stateMachine = new VoiceStateMachine();
    const states = VoiceStateMachine.STATES;

    assert.equal(stateMachine.canTransition(states.IDLE, states.INITIALIZING).allowed, true);
    assert.equal(stateMachine.canTransition(states.INITIALIZING, states.READY).allowed, true);
    assert.equal(stateMachine.canTransition(states.READY, states.LISTENING).allowed, true);
    assert.equal(stateMachine.canTransition(states.LISTENING, states.PROCESSING).allowed, true);
    assert.equal(stateMachine.canTransition(states.PROCESSING, states.EXECUTING).allowed, true);
    assert.equal(stateMachine.canTransition(states.EXECUTING, states.FINISHED).allowed, true);
    assert.equal(stateMachine.canTransition(states.FINISHED, states.CLOSING).allowed, true);
    assert.equal(stateMachine.canTransition(states.CLOSING, states.IDLE).allowed, true);
    assert.equal(stateMachine.canTransition(states.IDLE, states.LISTENING).allowed, false);
    assert.throws(() => stateMachine.assertTransition(states.IDLE, states.LISTENING), /Invalid Voice state transition/);
  });

  it('should run a complete metadata-only session lifecycle and clean up automatically', function() {
    const { VoiceSessionManager, VoiceStateMachine, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const events = [];
    const logs = [];
    const manager = new VoiceSessionManager({
      logger: { info: (message, metadata) => logs.push({ message, metadata }) },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.on(SESSION_EVENTS.VOICE_STATE_CHANGED, event => events.push(event));

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.IDLE);
    const started = manager.startSession({ id: 'voice-test' });

    assert.equal(started.success, true);
    assert.equal(started.state, VoiceStateMachine.STATES.LISTENING);
    assert.equal(started.session.sessionId, 'voice-test');
    assert.equal(manager.isActive(), true);
    assert.equal(manager.isBusy(), true);

    manager.beginProcessing();
    manager.beginExecution();
    const finished = manager.finishSession();

    assert.equal(finished.success, true);
    assert.equal(finished.state, VoiceStateMachine.STATES.IDLE);
    assert.equal(finished.session.currentState, VoiceStateMachine.STATES.FINISHED);
    assert.equal(manager.getSession(), null);
    assert.equal(manager.isActive(), false);
    assert.equal(manager.isBusy(), false);
    assert.ok(events.some(event => event.transition.toState === VoiceStateMachine.STATES.LISTENING));
    assert.ok(logs.some(entry => entry.message === '[Voice] State Changed'));
  });

  it('should reject a second simultaneous session', function() {
    const { VoiceSessionManager } = require('../../apps/desktop/voice');
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'first' });

    assert.throws(() => manager.startSession({ id: 'second' }), /SessionBusy|already exists/);
    assert.equal(manager.getSession().sessionId, 'first');
  });

  it('should cancel sessions and restore IDLE without stale state', function() {
    const { VoiceSessionManager, VoiceStateMachine, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const cancelledEvents = [];
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.on(SESSION_EVENTS.VOICE_SESSION_CANCELLED, event => cancelledEvents.push(event));
    manager.startSession({ id: 'cancel-me' });
    const cancelled = manager.cancelSession('user requested close');

    assert.equal(cancelled.state, VoiceStateMachine.STATES.IDLE);
    assert.equal(cancelled.session.currentState, VoiceStateMachine.STATES.CANCELLED);
    assert.equal(cancelled.session.cancellationReason, 'user requested close');
    assert.equal(manager.getSession(), null);
    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.IDLE);
    assert.equal(cancelledEvents.length, 1);
  });

  it('should recover from lifecycle errors and restore IDLE', function() {
    const { VoiceSessionManager, VoiceStateMachine, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const errors = [];
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.on(SESSION_EVENTS.VOICE_ERROR, event => errors.push(event));
    manager.startSession({ id: 'fail-me' });
    const failed = manager.failSession(new Error('synthetic lifecycle failure'));

    assert.equal(failed.success, false);
    assert.equal(failed.state, VoiceStateMachine.STATES.IDLE);
    assert.equal(failed.session.currentState, VoiceStateMachine.STATES.ERROR);
    assert.equal(failed.error.message, 'synthetic lifecycle failure');
    assert.equal(manager.getSession(), null);
    assert.equal(errors.length, 1);
  });

  it('should reset state and clear active session metadata', function() {
    const { VoiceSessionManager, VoiceStateMachine } = require('../../apps/desktop/voice');
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'reset-me' });

    assert.deepEqual(manager.reset(), { success: true, state: VoiceStateMachine.STATES.IDLE });
    assert.equal(manager.getSession(), null);
    assert.equal(manager.isActive(), false);
    assert.equal(manager.isBusy(), false);
  });

  it('should schedule and clear lifecycle timeout placeholders only', function() {
    const { VoiceSessionManager } = require('../../apps/desktop/voice');
    const scheduled = [];
    const cleared = [];
    const manager = new VoiceSessionManager({
      setTimeout: (callback, ms) => {
        const token = { callback, ms, unref() {} };
        scheduled.push(token);
        return token;
      },
      clearTimeout: token => cleared.push(token)
    });

    manager.startSession({ id: 'timeout-check' });
    manager.cancelSession('done');

    assert.ok(scheduled.some(token => token.ms === 10000));
    assert.ok(scheduled.some(token => token.ms === 30000));
    assert.ok(scheduled.some(token => token.ms === 60000));
    assert.ok(cleared.length >= 3);
  });

  it('should keep voice processing implementations out of Phase 2', function() {
    const {
      AudioCapture,
      AudioDeviceManager,
      VoiceActivityDetector,
      RNNoiseProcessor,
      STTEngine,
      SherpaRuntime,
      TranscriptNormalizer,
      TranscriptPublisher
    } = require('../../apps/desktop/voice');

    assert.deepEqual(new AudioDeviceManager().listInputDevices(), []);
    assert.deepEqual(new VoiceActivityDetector().detect({}), { hasVoice: false, confidence: 0, audioBuffer: {} });
    assert.equal(new TranscriptNormalizer().normalize('Hello'), 'Hello');
    assert.deepEqual(new TranscriptPublisher().publish('Hello'), { published: false, transcript: 'Hello' });
    assert.throws(() => new AudioCapture().start(), /not implemented in Phase 1/i);
    assert.throws(() => new RNNoiseProcessor().load(), /not implemented in Phase 1/i);
    assert.throws(() => new STTEngine().initialize(), /not implemented in Phase 1/i);
    assert.throws(() => new SherpaRuntime().createRecognizer(), /not implemented in Phase 1/i);
  });
});
