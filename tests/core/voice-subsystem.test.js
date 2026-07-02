const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Voice Subsystem Architecture', function() {
  const voiceRoot = path.join(__dirname, '..', '..', 'apps', 'desktop', 'voice');

  it('should expose the complete public architecture surface from index.js', function() {
    this.timeout(10000);
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
      'AudioConfiguration',
      'AudioFrame',
      'AUDIO_EVENTS',
      'AudioError',
      'MicrophoneNotFoundError',
      'PermissionDeniedError',
      'UnsupportedSampleRateError',
      'CaptureFailedError',
      'DeviceDisconnectedError',
      'InitializationFailedError',
      'BufferOverflowError',
      'AudioProcessor',
      'AudioPipeline',
      'AudioFrameProcessor',
      'VoiceActivityDetector',
      'SpeechSourceClassifier',
      'RNNoiseProcessor',
      'ProcessedAudioFrame',
      'ProcessingConfiguration',
      'AUDIO_PROCESSING_EVENTS',
      'AudioProcessingError',
      'RNNoiseInitializationFailedError',
      'RNNoiseProcessingFailedError',
      'VADInitializationFailedError',
      'VADProcessingFailedError',
      'InvalidAudioFrameError',
      'UnsupportedProcessingSampleRateError',
      'PipelineFailureError',
      'STTEngine',
      'STTConfiguration',
      'TranscriptSegment',
      'TranscriptResult',
      'STT_EVENTS',
      'STTError',
      'ModelNotFoundError',
      'ModelLoadFailedError',
      'RuntimeInitializationFailedError',
      'DecoderFailureError',
      'STTInvalidAudioFrameError',
      'RecognitionFailedError',
      'ModelIncompatibleError',
      'StreamingFailureError',
      'InferenceTimeoutError',
      'TranscriptProcessor',
      'TranscriptNormalizer',
      'NormalizedTranscript',
      'NormalizationConfiguration',
      'NORMALIZATION_EVENTS',
      'NormalizationError',
      'InvalidTranscriptError',
      'EmptyTranscriptError',
      'NormalizationFailureError',
      'ValidationFailureError',
      'DictionaryLoadFailureError',
      'UnknownNormalizationRuleError',
      'ConfigurationError',
      'VoiceOverlay',
      'VoiceWindowController',
      'AssistantInputAdapter',
      'VoiceAssistantBridge',
      'DiagnosticsManager',
      'VoiceSettings',
      'VoiceLogger',
      'VoiceMetrics'
    ];

    for (const key of expectedExports) {
      assert.ok(Object.prototype.hasOwnProperty.call(voice, key), `${key} export is missing`);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(voice, 'SherpaRuntime'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(voice, 'ParakeetEngine'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(voice, 'TranscriptPublisher'), false);
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
      'audio/AudioConfiguration.js',
      'audio/AudioFrame.js',
      'audio/AudioEvents.js',
      'audio/AudioErrors.js',
      'audio/index.js',
      'preprocessing/AudioPipeline.js',
      'preprocessing/VoiceActivityDetector.js',
      'preprocessing/SpeechSourceClassifier.js',
      'preprocessing/RNNoiseProcessor.js',
      'preprocessing/AudioProcessor.js',
      'preprocessing/AudioFrameProcessor.js',
      'preprocessing/ProcessedAudioFrame.js',
      'preprocessing/AudioProcessingEvents.js',
      'preprocessing/AudioProcessingErrors.js',
      'preprocessing/ProcessingConfiguration.js',
      'preprocessing/index.js',
      'stt/STTEngine.js',
      'stt/ParakeetEngine.js',
      'stt/SherpaRuntime.js',
      'stt/TranscriptAssembler.js',
      'stt/TranscriptSegment.js',
      'stt/TranscriptResult.js',
      'stt/STTConfiguration.js',
      'stt/STTEvents.js',
      'stt/STTErrors.js',
      'stt/ModelManager.js',
      'stt/ModelLoader.js',
      'stt/DecoderState.js',
      'stt/index.js',
      'normalization/TranscriptProcessor.js',
      'normalization/TranscriptNormalizer.js',
      'normalization/CommandNormalizer.js',
      'normalization/DictionaryNormalizer.js',
      'normalization/AcronymNormalizer.js',
      'normalization/ApplicationNormalizer.js',
      'normalization/TechnologyNormalizer.js',
      'normalization/TextCleaner.js',
      'normalization/TextValidator.js',
      'normalization/NormalizedTranscript.js',
      'normalization/NormalizationConfiguration.js',
      'normalization/NormalizationEvents.js',
      'normalization/NormalizationErrors.js',
      'normalization/index.js',
      'ui/VoiceOverlay.js',
      'ui/VoiceWindowController.js',
      'ui/TranscriptPublisher.js',
      'ui/VoiceStateRenderer.js',
      'ui/VoiceAnimationController.js',
      'ui/VoiceStatusIndicator.js',
      'ui/VoiceTheme.js',
      'ui/VoiceConfiguration.js',
      'ui/VoiceUIEvents.js',
      'ui/VoiceUIErrors.js',
      'ui/VoiceOverlayIPC.js',
      'ui/VoiceAccessibility.js',
      'ui/index.js',
      'integration/AssistantInputAdapter.js',
      'integration/VoiceAssistantBridge.js',
      'integration/AssistantDispatcher.js',
      'integration/VoiceExecutionCoordinator.js',
      'integration/VoiceResponseHandler.js',
      'integration/VoiceIntegrationEvents.js',
      'integration/VoiceIntegrationErrors.js',
      'integration/VoiceIntegrationConfiguration.js',
      'integration/index.js',
      'diagnostics/DiagnosticsManager.js',
      'diagnostics/PerformanceMonitor.js',
      'diagnostics/LatencyMonitor.js',
      'diagnostics/ResourceMonitor.js',
      'diagnostics/SessionStatistics.js',
      'diagnostics/ErrorTracker.js',
      'diagnostics/HealthMonitor.js',
      'diagnostics/MetricsCollector.js',
      'diagnostics/EventTimeline.js',
      'diagnostics/DiagnosticsConfiguration.js',
      'diagnostics/DiagnosticsEvents.js',
      'diagnostics/DiagnosticsErrors.js',
      'diagnostics/DiagnosticsReport.js',
      'diagnostics/index.js',
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
    assert.equal(stateMachine.canTransition(states.PROCESSING, states.LISTENING).allowed, true);
    assert.equal(stateMachine.canTransition(states.EXECUTING, states.SPEAKING).allowed, true);
    assert.equal(stateMachine.canTransition(states.SPEAKING, states.LISTENING).allowed, true);
    assert.equal(stateMachine.canTransition(states.EXECUTING, states.LISTENING).allowed, true);
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

  it('should isolate failing voice event listeners from session lifecycle', function() {
    const { VoiceSessionManager, VoiceStateMachine, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const observed = [];
    const warnings = [];
    const manager = new VoiceSessionManager({
      logger: {
        info() {},
        warn: (message, metadata) => warnings.push({ message, metadata })
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.on(SESSION_EVENTS.VOICE_STATE_CHANGED, () => {
      throw new Error('ui listener failed');
    });
    manager.on(SESSION_EVENTS.VOICE_STATE_CHANGED, event => observed.push(event.transition.toState));

    const started = manager.startSession({ id: 'listener-isolation' });

    assert.equal(started.state, VoiceStateMachine.STATES.LISTENING);
    assert.ok(observed.includes(VoiceStateMachine.STATES.LISTENING));
    assert.ok(warnings.some(entry => entry.message.includes('Event listener failed')));
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

  it('should warm voice resources without opening a voice session', function() {
    const { VoiceSessionManager, VoiceStateMachine } = require('../../apps/desktop/voice');
    const calls = [];
    const manager = new VoiceSessionManager({
      resources: {
        audioProcessor: {
          on() {},
          initialize() { calls.push('audioProcessor'); return { initialized: true }; },
          reset() {},
          getStatus() { return { initialized: true }; }
        },
        sttEngine: {
          on() {},
          initialize() { calls.push('sttEngine'); return { initialized: true }; },
          getStatus() { return { initialized: false }; },
          cancel() {}
        },
        transcriptProcessor: {
          on() {},
          getStatus() { calls.push('transcriptProcessor'); return { initialized: true }; },
          reset() {}
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    const warmed = manager.warmUpResources('test-warm');

    assert.equal(warmed.success, true);
    assert.equal(manager.getSession(), null);
    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.READY);
    assert.deepEqual(calls, ['audioProcessor', 'sttEngine', 'transcriptProcessor']);
  });

  it('should keep background voice warm-up failures out of the user-visible error stream', function() {
    const { VoiceSessionManager, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const errors = [];
    const manager = new VoiceSessionManager({
      resources: {
        audioProcessor: {
          on() {},
          initialize() { return { initialized: true }; },
          reset() {},
          getStatus() { return { initialized: true }; }
        },
        sttEngine: {
          on() {},
          initialize() { throw new Error('STT model was not found.'); },
          getStatus() { return { initialized: false }; },
          cancel() {}
        },
        transcriptProcessor: {
          on() {},
          getStatus() { return { initialized: true }; },
          reset() {}
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    manager.on(SESSION_EVENTS.VOICE_ERROR, event => errors.push(event));

    const warmed = manager.warmUpResources('background-resume');

    assert.equal(warmed.success, false);
    assert.equal(warmed.failed.length, 1);
    assert.equal(warmed.failed[0].resource, 'sttEngine');
    assert.equal(errors.length, 0);
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
    assert.equal(scheduled.some(token => token.ms === 30000), false);
    assert.equal(scheduled.some(token => token.ms === 60000), false);
    assert.ok(cleared.length >= 1);
  });

  it('should keep a silent listening session alive until explicit cancellation', function() {
    const { VoiceSessionManager, VoiceStateMachine, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const scheduled = [];
    const errors = [];
    const cancelled = [];
    const manager = new VoiceSessionManager({
      setTimeout: (callback, ms) => {
        const token = { callback, ms, unref() {} };
        scheduled.push(token);
        return token;
      },
      clearTimeout: () => {}
    });

    manager.on(SESSION_EVENTS.VOICE_ERROR, event => errors.push(event));
    manager.on(SESSION_EVENTS.VOICE_SESSION_CANCELLED, event => cancelled.push(event));
    manager.startSession({ id: 'silent-listening-session' });

    const listeningTimer = scheduled.find(token => token.ms === 30000);

    assert.equal(listeningTimer, undefined);
    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.LISTENING);
    assert.equal(errors.length, 0);
    assert.equal(cancelled.length, 0);

    manager.cancelSession('explicit cancellation');

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.IDLE);
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].session.cancellationReason, 'explicit cancellation');
  });

  it('should load audio configuration and expose standard PCM metadata', function() {
    const { AudioConfiguration, UnsupportedSampleRateError } = require('../../apps/desktop/voice');
    const config = new AudioConfiguration({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 24,
      frameSize: 960,
      bufferSize: 8,
      preferredDeviceId: 'usb-mic'
    });

    assert.equal(config.sampleRate, 48000);
    assert.deepEqual(config.getPcmFormat(), {
      encoding: 'PCM',
      bitDepth: 24,
      channels: 2,
      sampleRate: 48000,
      endianness: 'LE'
    });
    assert.equal(config.merge({ sampleRate: 16000 }).sampleRate, 16000);
    assert.throws(() => new AudioConfiguration({ sampleRate: 0 }), UnsupportedSampleRateError);
  });

  it('should create audio frames with PCM metadata and copied buffers', function() {
    const { AudioFrame } = require('../../apps/desktop/voice');
    const pcm = Buffer.from([1, 0, 2, 0]);
    const frame = new AudioFrame({
      frameIndex: 7,
      timestamp: '2026-06-30T00:00:00.000Z',
      pcm,
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      deviceId: 'mic-1'
    });

    pcm[0] = 9;

    assert.equal(frame.frameIndex, 7);
    assert.equal(frame.sampleCount, 2);
    assert.equal(frame.toMetadata().byteLength, 4);
    assert.equal(frame.getPcmBuffer()[0], 1);
  });

  it('should preserve audio buffer ordering and support reset', function() {
    const { AudioBuffer, AudioFrame } = require('../../apps/desktop/voice');
    const buffer = new AudioBuffer({ configuration: { bufferSize: 3 } });

    buffer.pushFrame(new AudioFrame({ frameIndex: 1, pcm: [1, 0] }));
    buffer.pushFrame(new AudioFrame({ frameIndex: 2, pcm: [2, 0] }));

    assert.equal(buffer.peek().frameIndex, 1);
    assert.equal(buffer.readFrame().frameIndex, 1);
    assert.equal(buffer.readFrame().frameIndex, 2);
    assert.equal(buffer.readFrame(), null);
    assert.equal(buffer.isEmpty(), true);

    buffer.pushFrame(new AudioFrame({ frameIndex: 3, pcm: [3, 0] }));
    assert.deepEqual(buffer.reset(), { reset: true });
    assert.equal(buffer.isEmpty(), true);
    assert.equal(buffer.getMetrics().framesReceived, 0);
  });

  it('should enumerate, select, switch, and detect audio device changes with mocked hardware', function() {
    const { AudioDeviceManager, AUDIO_EVENTS } = require('../../apps/desktop/voice');
    let devices = [
      { id: 'internal', displayName: 'Laptop Microphone', sampleRates: [16000], channels: 1, isDefault: true },
      { id: 'usb', displayName: 'USB Microphone', manufacturer: 'OpenX Test', sampleRates: [16000, 48000], channels: 2 }
    ];
    const manager = new AudioDeviceManager({
      provider: {
        listInputDevices: () => devices,
        getDefaultInputDeviceId: () => 'internal'
      }
    });
    const events = [];

    manager.on(AUDIO_EVENTS.AUDIO_DEVICE_LOST, event => events.push(event));
    assert.equal(manager.listInputDevices().length, 2);
    assert.equal(manager.getDefaultInputDevice().id, 'internal');
    assert.equal(manager.selectInputDevice('usb').device.displayName, 'USB Microphone');

    devices = [
      { id: 'internal', displayName: 'Laptop Microphone', sampleRates: [16000], channels: 1, isDefault: true },
      { id: 'usb', displayName: 'USB Microphone', sampleRates: [16000, 48000], channels: 2, connected: false }
    ];
    manager.refreshDevices();

    assert.equal(events.length, 1);
    assert.equal(events[0].device.id, 'usb');
    assert.equal(manager.getMetrics().deviceChangeCount >= 1, true);
  });

  it('should centralize audio permission state and revoked access detection', function() {
    const { AudioPermissions, PermissionDeniedError } = require('../../apps/desktop/voice');
    let granted = true;
    const permissions = new AudioPermissions({
      provider: {
        getMicrophonePermissionStatus: () => ({
          granted,
          state: granted ? 'granted' : 'denied',
          reason: granted ? '' : 'blocked'
        })
      }
    });

    assert.equal(permissions.verifyMicrophonePermission().granted, true);
    granted = false;
    assert.equal(permissions.detectRevokedPermission(), true);
    assert.throws(() => permissions.verifyMicrophonePermission(), PermissionDeniedError);
    assert.equal(permissions.getMetrics().permissionFailures, 1);
  });

  it('should initialize, start, pause, resume, stop, and close audio capture with mocked hardware', function() {
    const { AudioCapture, AudioDeviceManager, AudioPermissions, AUDIO_EVENTS } = require('../../apps/desktop/voice');
    const backendCalls = [];
    const events = [];
    const capture = new AudioCapture({
      deviceManager: new AudioDeviceManager({
        provider: {
          listInputDevices: () => [{ id: 'mic-1', displayName: 'Mock Microphone', sampleRates: [16000], channels: 1, isDefault: true }]
        }
      }),
      permissions: new AudioPermissions({
        provider: {
          getMicrophonePermissionStatus: () => ({ granted: true, state: 'granted', reason: '' })
        }
      }),
      backend: {
        open: () => backendCalls.push('open'),
        start: () => backendCalls.push('start'),
        pause: () => backendCalls.push('pause'),
        resume: () => backendCalls.push('resume'),
        stop: () => backendCalls.push('stop'),
        close: () => backendCalls.push('close')
      }
    });

    capture.on(AUDIO_EVENTS.AUDIO_FRAME, event => events.push(event));
    assert.equal(capture.start().started, true);
    const frame = capture.receiveFrame({ pcm: [1, 0, 2, 0] });
    assert.equal(frame.frameIndex, 0);
    assert.equal(capture.readFrame().frameIndex, 0);
    assert.deepEqual(capture.pause(), { paused: true, state: 'PAUSED' });
    assert.deepEqual(capture.resume(), { resumed: true, state: 'CAPTURING' });
    assert.equal(capture.stop().stopped, true);
    assert.equal(capture.close().closed, true);
    assert.deepEqual(backendCalls, ['open', 'start', 'pause', 'resume', 'stop', 'close']);
    assert.equal(events.length, 1);
  });

  it('should isolate failing audio capture listeners from frame delivery', function() {
    const { AudioCapture, AudioDeviceManager, AudioPermissions, AUDIO_EVENTS } = require('../../apps/desktop/voice');
    const logs = [];
    const capture = new AudioCapture({
      deviceManager: new AudioDeviceManager({
        provider: {
          listInputDevices: () => [{ id: 'mic-1', displayName: 'Mock Microphone', sampleRates: [16000], channels: 1, isDefault: true }]
        }
      }),
      permissions: new AudioPermissions({
        provider: {
          getMicrophonePermissionStatus: () => ({ granted: true, state: 'granted', reason: '' })
        }
      }),
      logger: { info: (message, metadata) => logs.push({ message, metadata }) }
    });
    let delivered = false;

    capture.on(AUDIO_EVENTS.AUDIO_FRAME, () => {
      throw new Error('capture listener failed');
    });
    capture.on(AUDIO_EVENTS.AUDIO_FRAME, () => {
      delivered = true;
    });

    capture.start();
    const frame = capture.receiveFrame({ pcm: [1, 0, 2, 0] });

    assert.equal(frame.frameIndex, 0);
    assert.equal(delivered, true);
    assert.ok(logs.some(entry => entry.message === '[Audio] Event listener failed'));
  });

  it('should route audio capture through VoiceSessionManager and store only frame metadata on the session', function() {
    const {
      VoiceSessionManager,
      AudioCapture,
      AudioDeviceManager,
      AudioPermissions
    } = require('../../apps/desktop/voice');
    const audioCapture = new AudioCapture({
      deviceManager: new AudioDeviceManager({
        provider: {
          listInputDevices: () => [{ id: 'mic-1', displayName: 'Mock Microphone', sampleRates: [16000], channels: 1, isDefault: true }]
        }
      }),
      permissions: new AudioPermissions({
        provider: {
          getMicrophonePermissionStatus: () => ({ granted: true, state: 'granted', reason: '' })
        }
      })
    });
    const manager = new VoiceSessionManager({
      resources: {
        audioCapture,
        speechSourceClassifier: {
          classify: frame => ({
            accepted: true,
            reason: 'test-validated-speech',
            classification: 'human-speech',
            confidence: Number(frame.speechConfidence) || 0.8,
            metrics: {},
            segment: {},
            frameIndex: frame?.originalFrame?.frameIndex ?? null,
            speechActivityState: frame?.speechActivityState || 'UNKNOWN',
            endpointCandidate: Boolean(frame?.endpointCandidate),
            at: new Date().toISOString()
          }),
          reset: () => ({ reset: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'audio-session' });
    manager.startAudioCapture();
    audioCapture.receiveFrame({ pcm: [5, 0, 6, 0] });

    const session = manager.getSession();
    assert.equal(session.context.audio.framesReceived, 1);
    assert.equal(session.context.audio.latestFrame.byteLength, 4);
    assert.equal(typeof session.context.audio.latestFrame.speechActivityState, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(session.context.audio.latestFrame, 'pcm'), false);
  });

  it('should keep injected desktop audio resources reusable after a session closes', function() {
    const {
      VoiceSessionManager,
      AudioCapture,
      AudioDeviceManager,
      AudioPermissions
    } = require('../../apps/desktop/voice');
    const backendCalls = [];
    const audioCapture = new AudioCapture({
      deviceManager: new AudioDeviceManager({
        provider: {
          listInputDevices: () => [{ id: 'mic-1', displayName: 'Mock Microphone', sampleRates: [16000], channels: 1, isDefault: true }]
        }
      }),
      permissions: new AudioPermissions({
        provider: {
          getMicrophonePermissionStatus: () => ({ granted: true, state: 'granted', reason: '' })
        }
      }),
      backend: {
        open: () => backendCalls.push('open'),
        start: () => backendCalls.push('start'),
        stop: () => backendCalls.push('stop'),
        close: () => backendCalls.push('close')
      }
    });
    const manager = new VoiceSessionManager({
      resources: { audioCapture },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'first-audio-session' });
    manager.startAudioCapture();
    manager.cancelSession('done');
    manager.startSession({ id: 'second-audio-session' });
    const restarted = manager.startAudioCapture();

    assert.equal(restarted.started, true);
    assert.strictEqual(manager.resources.audioCapture, audioCapture);
    assert.deepEqual(backendCalls, ['open', 'start', 'stop', 'close', 'open', 'start']);
  });

  it('should load processing configuration and reject invalid sample rates', function() {
    const { ProcessingConfiguration, UnsupportedProcessingSampleRateError } = require('../../apps/desktop/voice');
    const config = new ProcessingConfiguration({
      rnnoiseEnabled: true,
      vadEnabled: true,
      speechThreshold: 0.12,
      endpointSilenceDurationMs: 300
    });

    assert.equal(config.rnnoiseEnabled, true);
    assert.equal(config.vadEnabled, true);
    assert.equal(config.speechThreshold, 0.12);
    assert.equal(config.merge({ rnnoiseEnabled: false }).rnnoiseEnabled, false);
    assert.throws(() => new ProcessingConfiguration({ sampleRate: 0 }), UnsupportedProcessingSampleRateError);
  });

  it('should initialize RNNoise, process PCM, and report initialization failures', function() {
    const { AudioFrame, RNNoiseProcessor, RNNoiseInitializationFailedError } = require('../../apps/desktop/voice');
    const frame = new AudioFrame({ pcm: [1, 0, 200, 0], sampleRate: 16000, channels: 1, bitDepth: 16 });
    const processor = new RNNoiseProcessor({
      configuration: { rnnoiseAggressiveness: 1 },
      backend: {
        load: () => {},
        process: pcm => Buffer.from(pcm.map(value => value))
      }
    });

    assert.deepEqual(processor.initialize(), { initialized: true, enabled: true });
    const processed = processor.process(frame);
    assert.equal(Buffer.isBuffer(processed.cleanedPcm), true);
    assert.equal(processor.getMetrics().framesProcessed, 1);

    const failing = new RNNoiseProcessor({
      backend: {
        load: () => {
          throw new Error('missing model');
        }
      }
    });
    assert.throws(() => failing.initialize(), RNNoiseInitializationFailedError);
  });

  it('should detect speech, silence, and endpoint candidates from cleaned audio', function() {
    const { VoiceActivityDetector } = require('../../apps/desktop/voice');
    const vad = new VoiceActivityDetector({
      configuration: {
        speechThreshold: 0.05,
        silenceThreshold: 0.01,
        minimumSpeechDurationMs: 40,
        maximumSilenceDurationMs: 40,
        endpointSilenceDurationMs: 60,
        frameSizeMs: 20
      }
    });
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(6000, index);
    }
    const silence = Buffer.alloc(640);

    assert.equal(vad.detect({ cleanedPcm: speech, durationMs: 20 }).state, 'POSSIBLE_SPEECH');
    assert.equal(vad.detect({ cleanedPcm: speech, durationMs: 20 }).state, 'SPEECH');
    assert.equal(vad.detect({ cleanedPcm: silence, durationMs: 20 }).state, 'SILENCE');
    assert.equal(vad.detect({ cleanedPcm: silence, durationMs: 20 }).state, 'POSSIBLE_END');
    assert.equal(vad.detect({ cleanedPcm: silence, durationMs: 20 }).endpointCandidate, true);
  });

  it('should create ProcessedAudioFrame objects without mutating original audio frames', function() {
    const { AudioFrame, ProcessedAudioFrame } = require('../../apps/desktop/voice');
    const originalFrame = new AudioFrame({ frameIndex: 4, pcm: [10, 0, 11, 0] });
    const processed = new ProcessedAudioFrame({
      originalFrame,
      cleanedPcm: [0, 0, 11, 0],
      speechActivityState: 'SPEECH',
      speechConfidence: 0.8,
      endpointCandidate: false,
      processingMetadata: { rnnoiseApplied: true, vadApplied: true, latencyMs: 2 }
    });

    assert.equal(processed.originalFrame.frameIndex, 4);
    assert.equal(processed.toMetadata().speechActivityState, 'SPEECH');
    assert.equal(processed.toMetadata().byteLength, 4);
    assert.equal(Object.prototype.hasOwnProperty.call(processed.toMetadata(), 'cleanedPcm'), false);
  });

  it('should initialize, process, emit events, and reset the audio pipeline', function() {
    const {
      AudioFrame,
      AudioPipeline,
      AUDIO_PROCESSING_EVENTS
    } = require('../../apps/desktop/voice');
    const events = [];
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(7000, index);
    }
    const pipeline = new AudioPipeline({
      configuration: {
        speechThreshold: 0.05,
        minimumSpeechDurationMs: 20,
        frameSizeMs: 20
      }
    });

    pipeline.on(AUDIO_PROCESSING_EVENTS.FRAME_PROCESSED, event => events.push(event));
    assert.equal(pipeline.initialize().initialized, true);
    const processed = pipeline.process(new AudioFrame({ pcm: speech, durationMs: 20 }));

    assert.equal(processed.speechActivityState, 'SPEECH');
    assert.equal(events.length, 1);
    assert.deepEqual(pipeline.reset(), { reset: true });
    assert.equal(pipeline.getMetrics().pipelineResets, 1);
  });

  it('should expose AudioProcessor as the public processing coordinator', function() {
    const {
      AudioFrame,
      AudioProcessor,
      AUDIO_PROCESSING_EVENTS
    } = require('../../apps/desktop/voice');
    const events = [];
    const processor = new AudioProcessor({
      configuration: {
        speechThreshold: 0.05,
        minimumSpeechDurationMs: 20,
        frameSizeMs: 20
      }
    });
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(7000, index);
    }

    processor.on(AUDIO_PROCESSING_EVENTS.FRAME_PROCESSED, event => events.push(event));
    const processed = processor.processFrame(new AudioFrame({ pcm: speech, durationMs: 20 }));

    assert.equal(processed.speechActivityState, 'SPEECH');
    assert.equal(processor.getMetrics().framesProcessed, 1);
    assert.equal(events.length, 1);
  });

  it('should route explicit processing through VoiceSessionManager only', function() {
    const {
      VoiceSessionManager,
      AudioFrame,
      AudioProcessor
    } = require('../../apps/desktop/voice');
    const manager = new VoiceSessionManager({
      resources: {
        audioProcessor: new AudioProcessor({
          configuration: {
            speechThreshold: 0.05,
            minimumSpeechDurationMs: 20,
            frameSizeMs: 20
          }
        })
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(7000, index);
    }

    manager.startSession({ id: 'processing-session' });
    const processed = manager.processAudioFrame(new AudioFrame({ pcm: speech, durationMs: 20 }));
    const session = manager.getSession();

    assert.equal(processed.speechActivityState, 'SPEECH');
    assert.equal(session.context.audio.framesReceived, 1);
    assert.equal(session.context.audio.latestFrame.speechActivityState, 'SPEECH');
    assert.equal(manager.getAudioProcessingStatus().initialized, true);
  });

  it('should classify human speech before it reaches STT', function() {
    const {
      SpeechSourceClassifier,
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const classifier = new SpeechSourceClassifier();
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(index % 4 === 0 ? 7000 : -5000, index);
    }
    const speechFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 1, pcm: speech, durationMs: 20 }),
      cleanedPcm: speech,
      speechActivityState: 'SPEECH',
      speechConfidence: 0.72
    });
    const silenceFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 2, pcm: Buffer.alloc(640), durationMs: 20 }),
      cleanedPcm: Buffer.alloc(640),
      speechActivityState: 'SILENCE',
      speechConfidence: 0
    });
    const endpointFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 3, pcm: Buffer.alloc(640), durationMs: 20 }),
      cleanedPcm: Buffer.alloc(640),
      speechActivityState: 'ENDPOINT',
      speechConfidence: 0,
      endpointCandidate: true
    });

    const speechDecision = classifier.classify(speechFrame);
    const endpointDecision = classifier.classify(endpointFrame);
    const silenceDecision = classifier.classify(silenceFrame);

    assert.equal(speechDecision.accepted, true);
    assert.equal(speechDecision.classification, 'human-speech');
    assert.equal(endpointDecision.accepted, true);
    assert.equal(endpointDecision.reason, 'validated-speech-endpoint');
    assert.equal(silenceDecision.accepted, false);
    assert.equal(silenceDecision.classification, 'non-speech');
    assert.equal(classifier.getMetrics().acceptedSpeech, 2);
    assert.equal(classifier.getMetrics().rejectedNonSpeech, 1);
  });

  it('should keep validated speech segments continuous through quiet tail frames', function() {
    const {
      SpeechSourceClassifier,
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const classifier = new SpeechSourceClassifier();
    const speech = Buffer.alloc(640);
    for (let index = 0; index + 1 < speech.length; index += 2) {
      speech.writeInt16LE(5000, index);
    }
    const accepted = classifier.classify(new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 1, pcm: speech, durationMs: 20 }),
      cleanedPcm: speech,
      speechActivityState: 'SPEECH',
      speechConfidence: 0.4
    }));
    const tail = classifier.classify(new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 2, pcm: Buffer.alloc(640), durationMs: 20 }),
      cleanedPcm: Buffer.alloc(640),
      speechActivityState: 'SILENCE',
      speechConfidence: 0.01,
      processingMetadata: { silenceDurationMs: 80 }
    }));

    assert.equal(accepted.accepted, true);
    assert.equal(tail.accepted, true);
    assert.equal(tail.reason, 'validated-speech-tail');
  });

  it('should release speech pre-roll frames after the segment is validated', function() {
    const {
      VoiceSessionManager,
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const delivered = [];
    const sttEngine = {
      on() {},
      start: () => ({ started: true, state: 'DECODING' }),
      isRunning: () => true,
      partial: frame => {
        delivered.push(frame.originalFrame.frameIndex);
        return { transcript: '', partial: true };
      },
      cancel: () => ({ cancelled: true }),
      getStatus: () => ({ running: true })
    };
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const candidate = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 1, pcm: [1, 0, 2, 0], durationMs: 20 }),
      cleanedPcm: [1, 0, 2, 0],
      speechActivityState: 'POSSIBLE_SPEECH',
      speechConfidence: 0.09
    });
    const accepted = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 2, pcm: [20, 0, 21, 0], durationMs: 20 }),
      cleanedPcm: [20, 0, 21, 0],
      speechActivityState: 'SPEECH',
      speechConfidence: 0.45
    });

    manager.startSession({ id: 'speech-preroll-session' });
    manager.startSpeechToText();
    manager._deliverAudioFrameToSession(candidate);
    manager._deliverAudioFrameToSession(accepted);

    assert.deepEqual(delivered, [1, 2]);
    assert.equal(manager.getMetrics().runtimePipeline.speechPrerollFramesBuffered, 1);
    assert.equal(manager.getMetrics().runtimePipeline.speechPrerollFramesFlushed, 1);
  });

  it('should prevent rejected audio from being delivered to STT', function() {
    const {
      VoiceSessionManager,
      AudioFrame,
      ProcessedAudioFrame,
      SESSION_EVENTS
    } = require('../../apps/desktop/voice');
    let partialCalls = 0;
    const speechDecisions = [];
    const sttEngine = {
      on() {},
      start: () => ({ started: true, state: 'DECODING' }),
      isRunning: () => true,
      partial: () => {
        partialCalls += 1;
        return { transcript: 'should not happen', partial: true };
      },
      cancel: () => ({ cancelled: true }),
      getStatus: () => ({ running: true })
    };
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const noiseFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 9, pcm: Buffer.alloc(640), durationMs: 20 }),
      cleanedPcm: Buffer.alloc(640),
      speechActivityState: 'SILENCE',
      speechConfidence: 0
    });

    manager.on(SESSION_EVENTS.VOICE_SPEECH_DECISION, event => speechDecisions.push(event.speechDecision));
    manager.startSession({ id: 'speech-filter-session' });
    manager.startSpeechToText();
    manager._deliverAudioFrameToSession(noiseFrame);

    assert.equal(partialCalls, 0);
    assert.equal(manager.getMetrics().runtimePipeline.sttFrames, 0);
    assert.equal(manager.getMetrics().runtimePipeline.rejectedSpeechCandidates, 1);
    assert.equal(manager.getMetrics().runtimePipeline.rejectedNonSpeech, 1);
    assert.equal(speechDecisions.length, 1);
    assert.equal(speechDecisions[0].accepted, false);
  });

  it('should load STT configuration and validate decoder state transitions', function() {
    const { STTConfiguration } = require('../../apps/desktop/voice');
    const DecoderState = require('../../apps/desktop/voice/stt/DecoderState');
    const VoiceSettings = require('../../apps/desktop/voice/config/VoiceSettings');
    const config = new STTConfiguration({
      modelPath: 'mock/parakeet',
      language: 'en-IN',
      beamWidth: 8
    });
    const defaults = STTConfiguration.defaults();
    const decoder = new DecoderState();

    assert.equal(config.activeEngine, 'parakeet');
    assert.equal(defaults.modelPath, path.join('models', 'parakeet'));
    assert.equal(VoiceSettings.recognition.modelPath, 'models/parakeet');
    assert.equal(config.language, 'en-IN');
    assert.equal(config.merge({ beamWidth: 2 }).beamWidth, 2);
    assert.equal(decoder.transitionTo(DecoderState.STATES.LOADING), DecoderState.STATES.LOADING);
    assert.equal(decoder.transitionTo(DecoderState.STATES.READY), DecoderState.STATES.READY);
    assert.throws(() => decoder.transitionTo(DecoderState.STATES.FINALIZING), /Invalid decoder state transition/);
  });

  it('should manage STT model loading and unloading with mocked model metadata', function() {
    const ModelManager = require('../../apps/desktop/voice/stt/ModelManager');
    const ModelLoader = require('../../apps/desktop/voice/stt/ModelLoader');
    const { ModelNotFoundError } = require('../../apps/desktop/voice');
    const configuration = { modelPath: 'mock/parakeet', modelName: 'nvidia-parakeet-tdt-v3' };
    const modelManager = new ModelManager({
      configuration,
      models: [{ name: 'nvidia-parakeet-tdt-v3', engine: 'parakeet', path: 'mock/parakeet', mockAvailable: true }]
    });
    const runtimeCalls = [];
    const loader = new ModelLoader({
      configuration,
      modelManager,
      runtime: { initialize: () => runtimeCalls.push('initialize'), release: () => runtimeCalls.push('release') }
    });

    assert.equal(modelManager.getAvailableEngines().includes('parakeet'), true);
    assert.equal(loader.load().name, 'nvidia-parakeet-tdt-v3');
    assert.equal(loader.getLoadedModel().path, 'mock/parakeet');
    assert.deepEqual(loader.unload(), { unloaded: true });
    assert.deepEqual(runtimeCalls, ['initialize', 'release']);
    assert.throws(() => new ModelManager({ configuration }).validateModel(), ModelNotFoundError);
  });

  it('should assemble streaming transcript partials and finals without NLP changes', function() {
    const TranscriptAssembler = require('../../apps/desktop/voice/stt/TranscriptAssembler');
    const { TranscriptResult, TranscriptSegment } = require('../../apps/desktop/voice');
    const assembler = new TranscriptAssembler();

    assembler.start(new Date());
    const partial = assembler.addPartial({ text: 'hello', confidence: 0.7, segmentId: 'p1' });
    assembler.addPartial({ text: 'hello', confidence: 0.7, segmentId: 'p1-dup' });
    const finalResult = assembler.addFinal({ text: 'hello world', confidence: 0.9, segmentId: 'f1' });

    assert.equal(partial instanceof TranscriptResult, true);
    assert.equal(finalResult.finalTranscript, 'hello world');
    assert.equal(finalResult.segments[0] instanceof TranscriptSegment, true);
    assert.equal(assembler.assemble(), 'hello world');
    assert.deepEqual(assembler.reset(), { cleared: true });
  });

  it('should run streaming STT lifecycle with mocked Parakeet/Sherpa internals', function() {
    const {
      STTEngine,
      STT_EVENTS,
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const ParakeetEngine = require('../../apps/desktop/voice/stt/ParakeetEngine');
    const SherpaRuntime = require('../../apps/desktop/voice/stt/SherpaRuntime');
    const ModelManager = require('../../apps/desktop/voice/stt/ModelManager');
    const configuration = { modelPath: 'mock/parakeet', modelName: 'nvidia-parakeet-tdt-v3' };
    const adapterOutputs = ['hello', 'hello openx'];
    const runtime = new SherpaRuntime({
      adapter: {
        initialize: () => {},
        createRecognizer: () => ({}),
        startStream: () => {},
        acceptFrame: () => {},
        decode: () => ({ text: adapterOutputs.shift() || 'hello openx', confidence: 0.85, segmentId: 'partial' }),
        finalize: () => ({ text: 'hello openx', confidence: 0.9, final: true, segmentId: 'final' }),
        release: () => {}
      }
    });
    const modelManager = new ModelManager({
      configuration,
      models: [{ name: 'nvidia-parakeet-tdt-v3', engine: 'parakeet', path: 'mock/parakeet', mockAvailable: true }]
    });
    const engine = new STTEngine({
      configuration,
      engine: new ParakeetEngine({ configuration, runtime, modelManager })
    });
    const events = [];
    const frame = new AudioFrame({ frameIndex: 0, pcm: [1, 0, 2, 0] });
    const processedFrame = new ProcessedAudioFrame({
      originalFrame: frame,
      cleanedPcm: [1, 0, 2, 0],
      speechActivityState: 'SPEECH',
      speechConfidence: 0.8
    });

    engine.on(STT_EVENTS.PARTIAL_RESULT, event => events.push(event));
    assert.equal(engine.initialize().initialized, true);
    assert.equal(engine.start().started, true);
    assert.equal(engine.isRunning(), true);
    assert.equal(engine.partial(processedFrame).transcript, 'hello');
    assert.equal(engine.partial(processedFrame).transcript, 'hello openx');
    const finalResult = engine.final();

    assert.equal(finalResult.finalTranscript, 'hello openx');
    assert.equal(engine.isRunning(), false);
    assert.equal(events.length, 2);
    assert.equal(engine.getStatus().engine, 'parakeet');
    assert.equal(Object.prototype.hasOwnProperty.call(engine.getStatus(), 'runtime'), false);
  });

  it('should use native Sherpa recognizer text instead of placeholder transcripts', function() {
    const {
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const SherpaRuntime = require('../../apps/desktop/voice/stt/SherpaRuntime');
    let acceptedSamples = 0;
    const fakeSherpa = {
      OfflineRecognizer: class {
        constructor(config) {
          this.config = config;
        }
        createStream() {
          return {
            acceptWaveform: ({ samples }) => {
              acceptedSamples += samples.length;
            }
          };
        }
        decode() {}
        getResult() {
          return {
            text: acceptedSamples ? 'open calendar' : '',
            ys_log_probs: [-0.1, -0.2]
          };
        }
      }
    };
    const runtime = new SherpaRuntime({ sherpa: fakeSherpa });
    const processedFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({
        frameIndex: 0,
        pcm: [0, 0, 32, 0, 64, 0, 96, 0],
        sampleRate: 16000,
        channels: 1
      }),
      speechActivityState: 'SPEECH',
      speechConfidence: 0.8
    });

    runtime.initialize({
      model: { path: 'models/parakeet' },
      configuration: { modelPath: 'models/parakeet', partialResultIntervalMs: 0 }
    });
    runtime.createRecognizer();
    runtime.startStream();
    runtime.acceptFrame(processedFrame);
    const partial = runtime.decode({ ...processedFrame, endpointCandidate: true });
    const final = runtime.finalize();

    assert.equal(partial.text, 'open calendar');
    assert.equal(final.text, 'open calendar');
    assert.doesNotMatch(partial.text, /^speech \d+$/);
    assert.doesNotMatch(final.text, /^recognized speech \d+$/);
    assert.equal(runtime.getStatus().mode, 'native-offline');
  });

  it('should support STT cancellation, reset, and runtime error wrapping', function() {
    const {
      STTEngine,
      AudioFrame,
      ProcessedAudioFrame,
      RecognitionFailedError
    } = require('../../apps/desktop/voice');
    const ParakeetEngine = require('../../apps/desktop/voice/stt/ParakeetEngine');
    const SherpaRuntime = require('../../apps/desktop/voice/stt/SherpaRuntime');
    const ModelManager = require('../../apps/desktop/voice/stt/ModelManager');
    const configuration = { modelPath: 'mock/parakeet', modelName: 'nvidia-parakeet-tdt-v3' };
    const modelManager = new ModelManager({
      configuration,
      models: [{ name: 'nvidia-parakeet-tdt-v3', engine: 'parakeet', path: 'mock/parakeet', mockAvailable: true }]
    });
    const runtime = new SherpaRuntime({
      adapter: {
        initialize: () => {},
        createRecognizer: () => ({}),
        startStream: () => {},
        acceptFrame: () => {},
        decode: () => {
          throw new Error('decoder failed');
        },
        finalize: () => ({ text: '', confidence: 0, final: true }),
        release: () => {}
      }
    });
    const engine = new STTEngine({
      configuration,
      engine: new ParakeetEngine({ configuration, runtime, modelManager })
    });
    const processedFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 0, pcm: [1, 0] }),
      cleanedPcm: [1, 0],
      speechActivityState: 'SPEECH'
    });

    engine.initialize();
    engine.start();
    assert.throws(() => engine.partial(processedFrame), RecognitionFailedError);
    assert.equal(engine.cancel().cancelled, true);
    assert.equal(engine.reset().reset, true);
  });

  it('should route streaming STT through VoiceSessionManager and store transcript metadata', function() {
    const {
      VoiceSessionManager,
      STTEngine,
      AudioFrame,
      ProcessedAudioFrame
    } = require('../../apps/desktop/voice');
    const ParakeetEngine = require('../../apps/desktop/voice/stt/ParakeetEngine');
    const SherpaRuntime = require('../../apps/desktop/voice/stt/SherpaRuntime');
    const ModelManager = require('../../apps/desktop/voice/stt/ModelManager');
    const configuration = { modelPath: 'mock/parakeet', modelName: 'nvidia-parakeet-tdt-v3' };
    const runtime = new SherpaRuntime({
      adapter: {
        initialize: () => {},
        createRecognizer: () => ({}),
        startStream: () => {},
        acceptFrame: () => {},
        decode: () => ({ text: 'call mummy', confidence: 0.88, segmentId: 'partial' }),
        finalize: () => ({ text: 'call mummy', confidence: 0.92, final: true, segmentId: 'final' }),
        release: () => {}
      }
    });
    const modelManager = new ModelManager({
      configuration,
      models: [{ name: 'nvidia-parakeet-tdt-v3', engine: 'parakeet', path: 'mock/parakeet', mockAvailable: true }]
    });
    const sttEngine = new STTEngine({
      configuration,
      engine: new ParakeetEngine({ configuration, runtime, modelManager })
    });
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const processedFrame = new ProcessedAudioFrame({
      originalFrame: new AudioFrame({ frameIndex: 0, pcm: [1, 0] }),
      cleanedPcm: [1, 0],
      speechActivityState: 'SPEECH',
      speechConfidence: 0.7
    });

    manager.startSession({ id: 'stt-session' });
    manager.startSpeechToText();
    const partial = manager.recognizeProcessedFrame(processedFrame);
    const finalResult = manager.finalizeSpeechToText();
    const session = manager.getSession();

    assert.equal(partial.transcript, 'call mummy');
    assert.equal(finalResult.finalTranscript, 'call mummy');
    assert.equal(session.context.recognition.partialTranscript, 'call mummy');
    assert.equal(session.context.recognition.finalTranscript, 'call mummy');
    assert.equal(session.context.recognition.normalizedTranscript, 'Call mummy');
    assert.equal(session.transcript, 'Call mummy');
  });

  it('should clean whitespace, repeated words, punctuation, and fillers deterministically', function() {
    const { TranscriptProcessor } = require('../../apps/desktop/voice');
    const processor = new TranscriptProcessor();
    const normalized = processor.process(' um   open   open   vs code!!! ');

    assert.equal(normalized.cleanedTranscript, 'um open vs code!');
    assert.equal(normalized.normalizedTranscript, 'Open VS Code!');
    assert.equal(normalized.validation.valid, true);
    assert.ok(normalized.transformations.length > 0);
  });

  it('should normalize applications, technologies, acronyms, and dictionary terms', function() {
    const {
      ApplicationNormalizer,
      TechnologyNormalizer,
      AcronymNormalizer,
      DictionaryNormalizer
    } = require('../../apps/desktop/voice/normalization');

    assert.equal(new ApplicationNormalizer().normalize('open visual studio code and chrome browser').text, 'open VS Code and Google Chrome');
    assert.equal(new TechnologyNormalizer().normalize('open git hub with node js and usb c').text, 'open GitHub with Node.js and USB-C');
    assert.equal(new AcronymNormalizer().normalize('show c p u gpu ram json url').text, 'show CPU GPU RAM JSON URL');
    assert.equal(new DictionaryNormalizer().normalize('openx github desktop').text, 'OpenX GitHub Desktop');
  });

  it('should validate normalized transcripts and raise structured errors', function() {
    const {
      TextValidator,
      EmptyTranscriptError,
      ValidationFailureError,
      NormalizationConfiguration,
      ConfigurationError
    } = require('../../apps/desktop/voice/normalization');
    const validator = new TextValidator({ maximumTranscriptLength: 5, confidenceThreshold: 0.5 });

    assert.deepEqual(validator.validate('hello', { confidence: 0.8 }), { valid: true, errors: [], warnings: [] });
    assert.throws(() => validator.assertValid('   '), EmptyTranscriptError);
    assert.throws(() => validator.assertValid('hello world'), ValidationFailureError);
    assert.throws(() => validator.assertValid('hello', { confidence: 0.1 }), ValidationFailureError);
    assert.throws(() => new NormalizationConfiguration({ maximumTranscriptLength: 0 }), ConfigurationError);
  });

  it('should produce immutable NormalizedTranscript objects for NLP handoff', function() {
    const { NormalizedTranscript } = require('../../apps/desktop/voice');
    const normalized = new NormalizedTranscript({
      originalTranscript: 'open vs code',
      cleanedTranscript: 'open vs code',
      normalizedTranscript: 'Open VS Code',
      validation: { valid: true, errors: [], warnings: [] },
      transformations: [{ stage: 'application', from: 'vs code', to: 'VS Code' }]
    });

    assert.equal(normalized.toString(), 'Open VS Code');
    assert.equal(normalized.toJSON().normalizedTranscript, 'Open VS Code');
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.transformations), true);
  });

  it('should emit transcript normalization events and track metrics', function() {
    const { TranscriptProcessor, NORMALIZATION_EVENTS, TranscriptResult } = require('../../apps/desktop/voice');
    const processor = new TranscriptProcessor();
    const events = [];

    processor.on(NORMALIZATION_EVENTS.NORMALIZED_TRANSCRIPT_READY, event => events.push(event));
    const normalized = processor.process(new TranscriptResult({
      transcript: 'open git hub desktop',
      confidence: 0.9,
      partial: false
    }));

    assert.equal(normalized.normalizedTranscript, 'Open GitHub Desktop');
    assert.equal(events.length, 1);
    assert.equal(processor.getMetrics().transcriptsProcessed, 1);
    assert.equal(processor.getStatus().enabled, true);
  });

  it('should route transcript normalization through VoiceSessionManager before future NLP', function() {
    const { VoiceSessionManager, TranscriptResult } = require('../../apps/desktop/voice');
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'normalize-session' });
    const normalized = manager.processTranscript(new TranscriptResult({
      finalTranscript: 'open visual studio code and git hub',
      confidence: 0.9,
      partial: false
    }));
    const session = manager.getSession();

    assert.equal(normalized.normalizedTranscript, 'Open VS Code and GitHub');
    assert.equal(session.context.recognition.normalizedTranscript, 'Open VS Code and GitHub');
    assert.equal(session.transcript, 'Open VS Code and GitHub');
    assert.equal(manager.getTranscriptProcessingStatus().metrics.transcriptsProcessed, 1);
  });

  it('should render every Voice UI lifecycle state without speech logic', function() {
    const { VoiceStateRenderer, VoiceAccessibility, VoiceAnimationController } = require('../../apps/desktop/voice/ui');
    const renderer = new VoiceStateRenderer();
    const accessibility = new VoiceAccessibility({ highContrast: true, largeText: true });
    const animation = new VoiceAnimationController({ reducedMotion: true });

    assert.equal(renderer.render('INITIALIZING').statusText, 'Initializing voice...');
    assert.equal(renderer.render('LISTENING', { partialTranscript: 'Open Visual' }).icon, 'microphone');
    assert.equal(renderer.render('PROCESSING', { finalTranscript: 'Open VS Code' }).title, 'Thinking');
    assert.equal(renderer.render('EXECUTING', { commandText: 'Open VS Code' }).statusText, 'Executing command...');
    assert.equal(renderer.render('SPEAKING').statusText, 'Speaking...');
    assert.equal(renderer.render('FINISHED').animation, 'completion');
    assert.equal(renderer.render('ERROR', { error: { message: 'Microphone unavailable.' } }).statusText, 'Microphone unavailable.');
    assert.equal(accessibility.apply(renderer.render('LISTENING')).live, 'polite');
    assert.equal(animation.trigger('listening-pulse').animation, 'none');
  });

  it('should publish partial and final transcripts to the Voice UI without normalization', function() {
    const { TranscriptPublisher } = require('../../apps/desktop/voice/ui');
    const updates = [];
    const publisher = new TranscriptPublisher({
      target: { updateTranscript: payload => updates.push(payload) }
    });

    const partial = publisher.publishPartial({ transcriptResult: { transcript: 'open visual', partial: true } });
    const final = publisher.publishFinal({ transcriptResult: { finalTranscript: 'open visual studio code', partial: false } });

    assert.equal(partial.transcript, 'open visual');
    assert.equal(final.transcript, 'open visual studio code');
    assert.equal(publisher.getState().partialTranscript, '');
    assert.equal(publisher.getState().finalTranscript, 'open visual studio code');
    assert.equal(updates.length, 2);
  });

  it('should suppress duplicate Voice UI state and transcript updates', function() {
    const { VoiceOverlay, TranscriptPublisher } = require('../../apps/desktop/voice/ui');
    const stateUpdates = [];
    const overlay = new VoiceOverlay({
      windowController: {
        updateState: view => stateUpdates.push(view)
      },
      clock: () => new Date('2026-07-01T00:00:00.000Z')
    });

    const firstState = overlay.updateState('LISTENING');
    const duplicateState = overlay.updateState('LISTENING');
    assert.equal(firstState.updated, true);
    assert.equal(duplicateState.updated, false);
    assert.equal(stateUpdates.length, 1);

    const transcriptUpdates = [];
    const publisher = new TranscriptPublisher({
      target: { updateTranscript: payload => transcriptUpdates.push(payload) }
    });
    const firstTranscript = publisher.publishPartial('open chrome');
    const duplicateTranscript = publisher.publishPartial('open chrome');

    assert.equal(firstTranscript.published, true);
    assert.equal(duplicateTranscript.published, false);
    assert.equal(transcriptUpdates.length, 1);
    assert.equal(publisher.getState().suppressedDuplicateCount, 1);
  });

  it('should resolve Voice UI colors from the active assistant theme', function() {
    const { VoiceTheme } = require('../../apps/desktop/voice/ui');
    const theme = new VoiceTheme({
      settings: {
        settings: { chat: { themeId: 'white-glass' } },
        availableThemes: [{
          id: 'white-glass',
          colors: {
            panel: 'rgba(255, 255, 255, 0.34)',
            text: '#171719',
            muted: 'rgba(20, 20, 22, 0.66)',
            border: 'rgba(255, 255, 255, 0.48)',
            accent: 'rgba(255, 255, 255, 0.94)'
          }
        }]
      }
    });

    assert.equal(theme.currentTheme.mode, 'white-glass');
    assert.equal(theme.currentTheme.backgroundColor, 'rgba(255, 255, 255, 0.34)');
    assert.equal(theme.currentTheme.textColor, '#171719');
    assert.equal(theme.toCssVariables()['--voice-border'], 'rgba(255, 255, 255, 0.48)');
  });

  it('should ignore empty streaming partials before UI and normalization', function() {
    const { VoiceSessionManager, STTEngine, TranscriptResult, STT_EVENTS, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const sttEngine = new STTEngine();
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const partialEvents = [];
    const errorEvents = [];

    manager.on(SESSION_EVENTS.VOICE_PARTIAL_TRANSCRIPT, event => partialEvents.push(event));
    manager.on(SESSION_EVENTS.VOICE_ERROR, event => errorEvents.push(event));
    manager.startSession({ id: 'empty-partial-session' });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: '', confidence: 0, partial: true })
    });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: 'open calendar', confidence: 0.9, partial: true })
    });

    assert.equal(errorEvents.length, 0);
    assert.equal(partialEvents.length, 1);
    assert.equal(partialEvents[0].transcriptResult.transcript, 'open calendar');
  });

  it('should suppress duplicate partial transcripts before UI and normalization', function() {
    const { VoiceSessionManager, STTEngine, TranscriptResult, STT_EVENTS, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const sttEngine = new STTEngine();
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const partialEvents = [];

    manager.on(SESSION_EVENTS.VOICE_PARTIAL_TRANSCRIPT, event => partialEvents.push(event));
    manager.startSession({ id: 'duplicate-partial-session' });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: 'hello', confidence: 0.9, partial: true })
    });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: 'hello', confidence: 0.91, partial: true })
    });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: 'hello there', confidence: 0.92, partial: true })
    });

    assert.equal(partialEvents.length, 2);
    assert.equal(partialEvents[0].transcriptResult.transcript, 'hello');
    assert.equal(partialEvents[1].transcriptResult.transcript, 'hello there');
    assert.equal(manager.getTranscriptProcessingStatus().metrics.transcriptsProcessed, 0);
  });

  it('should recover empty final transcripts without closing the voice session', function() {
    const EventEmitter = require('events');
    const { VoiceSessionManager, TranscriptResult, STT_EVENTS, SESSION_EVENTS, VoiceStateMachine } = require('../../apps/desktop/voice');
    let running = false;
    let starts = 0;
    let resets = 0;
    const sttEngine = new EventEmitter();
    sttEngine.start = () => {
      running = true;
      starts += 1;
      return { started: true, state: 'DECODING' };
    };
    sttEngine.isRunning = () => running;
    sttEngine.cancel = () => {
      running = false;
      return { cancelled: true };
    };
    sttEngine.getStatus = () => ({ running, decoder: { state: running ? 'DECODING' : 'STOPPED' } });
    const manager = new VoiceSessionManager({
      resources: {
        sttEngine,
        audioProcessor: {
          on() {},
          reset: () => {
            resets += 1;
            return { reset: true };
          },
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const cancelled = [];

    manager.on(SESSION_EVENTS.VOICE_SESSION_CANCELLED, event => cancelled.push(event));
    manager.startSession({ id: 'empty-final-recovery' });
    manager.startSpeechToText();
    running = false;
    sttEngine.emit(STT_EVENTS.FINAL_RESULT, {
      result: new TranscriptResult({ finalTranscript: '', confidence: 0, partial: false })
    });

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.LISTENING);
    assert.equal(manager.isActive(), true);
    assert.equal(cancelled.length, 0);
    assert.equal(starts, 2);
    assert.equal(resets, 1);
    assert.equal(manager.getMetrics().runtimePipeline.emptyFinals, 1);
  });

  it('should reject queued audio captured before the active recognition cycle', function() {
    const { VoiceSessionManager, AudioFrame } = require('../../apps/desktop/voice');
    let now = new Date('2026-06-30T10:00:00.000Z');
    let processed = 0;
    let running = false;
    const manager = new VoiceSessionManager({
      clock: () => now,
      resources: {
        sttEngine: {
          on() {},
          start: () => {
            running = true;
            return { started: true, state: 'DECODING' };
          },
          isRunning: () => running,
          cancel: () => {
            running = false;
            return { cancelled: true };
          },
          getStatus: () => ({ running, decoder: { state: running ? 'DECODING' : 'STOPPED' } })
        },
        audioProcessor: {
          on() {},
          processFrame: () => {
            processed += 1;
          },
          reset: () => ({ reset: true }),
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'fresh-audio-boundary' });
    manager.startSpeechToText();
    manager._processAudioFrameForSession(new AudioFrame({
      timestamp: '2026-06-30T09:59:59.000Z',
      pcm: [0, 0],
      frameIndex: 1
    }));
    now = new Date('2026-06-30T10:00:00.200Z');
    manager._processAudioFrameForSession(new AudioFrame({
      timestamp: '2026-06-30T10:00:00.120Z',
      pcm: [0, 0],
      frameIndex: 2
    }));

    assert.equal(processed, 1);
    assert.equal(manager.getMetrics().runtimePipeline.staleAudioFrames, 1);
  });

  it('should keep capture alive and flush queued frames between recognition cycles', function() {
    const { VoiceSessionManager, VoiceStateMachine } = require('../../apps/desktop/voice');
    let sttRunning = true;
    let pauseCalls = 0;
    let resumeCalls = 0;
    let flushes = 0;
    let sttStarts = 0;
    const manager = new VoiceSessionManager({
      resources: {
        audioCapture: {
          on() {},
          getStatus: () => ({
            capturing: true,
            paused: false,
            available: true
          }),
          pause: () => {
            pauseCalls += 1;
            return { paused: true };
          },
          resume: () => {
            resumeCalls += 1;
            return { resumed: true };
          },
          getBuffer: () => ({
            flush: () => {
              flushes += 1;
              return { flushed: true, droppedFrames: 12 };
            }
          }),
          close: () => ({ closed: true })
        },
        audioProcessor: {
          on() {},
          reset: () => ({ reset: true }),
          getStatus: () => ({ initialized: true })
        },
        sttEngine: {
          on() {},
          start: () => {
            sttRunning = true;
            sttStarts += 1;
            return { started: true };
          },
          isRunning: () => sttRunning,
          cancel: () => {
            sttRunning = false;
            return { cancelled: true };
          },
          getStatus: () => ({ running: sttRunning, decoder: { state: sttRunning ? 'DECODING' : 'STOPPED' } })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });

    manager.startSession({ id: 'capture-half-duplex' });
    manager.beginProcessing();
    manager.beginExecution();
    sttRunning = false;
    manager.resumeListeningCycle('assistant-complete');

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.LISTENING);
    assert.equal(pauseCalls, 0);
    assert.equal(resumeCalls, 0);
    assert.equal(flushes, 1);
    assert.equal(sttStarts, 1);
    assert.equal(manager.getMetrics().runtimePipeline.recognitionConsumerPauses, 1);
    assert.equal(manager.getMetrics().runtimePipeline.recognitionConsumerResumes, 1);
    assert.equal(manager.getMetrics().runtimePipeline.captureBufferFlushes, 1);
    assert.equal(manager.getMetrics().runtimePipeline.captureBufferFlushedFrames, 12);
  });

  it('should emit exactly one final transcript per recognition cycle', function() {
    const { VoiceSessionManager, STTEngine, TranscriptResult, STT_EVENTS, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const sttEngine = new STTEngine();
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const finalEvents = [];

    manager.on(SESSION_EVENTS.VOICE_FINAL_TRANSCRIPT, event => finalEvents.push(event));
    manager.startSession({ id: 'single-final-session' });
    sttEngine.events.emit(STT_EVENTS.FINAL_RESULT, {
      result: new TranscriptResult({ finalTranscript: 'open chrome', confidence: 0.9, partial: false })
    });
    sttEngine.events.emit(STT_EVENTS.FINAL_RESULT, {
      result: new TranscriptResult({ finalTranscript: 'open calendar', confidence: 0.9, partial: false })
    });

    assert.equal(finalEvents.length, 1);
    assert.equal(finalEvents[0].transcriptResult.finalTranscript, 'open chrome');
    assert.equal(manager.getMetrics().runtimePipeline.duplicateFinals, 1);
  });

  it('should create, position, show, update, and hide the Voice overlay window through minimal IPC', async function() {
    const { VoiceWindowController } = require('../../apps/desktop/voice');
    const sent = [];
    const bounds = [];
    class MockWindow {
      constructor(options) {
        this.options = options;
        this.webContents = { send: (_channel, message) => sent.push(message) };
        this.destroyed = false;
      }
      isDestroyed() { return this.destroyed; }
      loadURL(url) { this.url = url; return Promise.resolve(); }
      setBounds(nextBounds) { bounds.push(nextBounds); this.bounds = nextBounds; }
      getBounds() { return this.bounds; }
      setAlwaysOnTop(value, level) { this.alwaysOnTop = { value, level }; }
      showInactive() { this.visible = true; }
      hide() { this.visible = false; }
      destroy() { this.destroyed = true; }
    }
    const controller = new VoiceWindowController({
      BrowserWindow: MockWindow,
      screen: {
        getPrimaryDisplay: () => ({ workArea: { x: 10, y: 20, width: 1000, height: 700 } })
      },
      configuration: {
        size: { width: 256, height: 50 },
        mediumSize: { width: 360, height: 118 },
        expandedSize: { width: 440, height: 236 },
        position: { vertical: 'top', yOffset: 12 }
      }
    });

    const shown = controller.show({ state: 'LISTENING', statusText: 'Listening' });
    controller.updateAssistantResult({
      response: 'Opening screenshots.'
    });
    await new Promise(resolve => setTimeout(resolve, 190));
    controller.updateAssistantResult({
      response: 'I found 2 matching folders. Choose a number.',
      choices: [
        { index: 1, title: 'Screenshots - C:\\A\\Screenshots', path: 'C:\\A\\Screenshots' },
        { index: 2, title: 'Screenshots - C:\\B\\Screenshots', path: 'C:\\B\\Screenshots' }
      ]
    });
    await new Promise(resolve => setTimeout(resolve, 190));
    controller.updateState({ state: 'LISTENING', statusText: 'Listening' });
    await new Promise(resolve => setTimeout(resolve, 210));
    controller.updateTranscript({ transcript: 'open visual', partial: true });
    controller.hide();

    assert.equal(shown.visible, true);
    assert.equal(controller.getStatus().created, true);
    assert.deepEqual(bounds[0], { x: 382, y: 32, width: 256, height: 50 });
    assert.ok(bounds.some(entry => entry.x === 330 && entry.y === 32 && entry.width === 360 && entry.height === 118));
    assert.ok(bounds.some(entry => entry.x === 295 && entry.y === 32 && entry.width === 430 && entry.height === 204));
    assert.deepEqual(bounds[bounds.length - 1], { x: 382, y: 32, width: 256, height: 50 });
    assert.ok(sent.some(message => message.operation === 'showOverlay'));
    assert.ok(sent.some(message => message.operation === 'displayAssistantResult'));
    assert.ok(sent.some(message => message.operation === 'updateTranscript'));
    assert.ok(sent.some(message => message.operation === 'hideOverlay'));
  });

  it('should react to VoiceSessionManager events and keep UI state presentation-only', function() {
    const { VoiceOverlay, VoiceSessionManager, STTEngine, TranscriptResult, STT_EVENTS, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const windowUpdates = [];
    const sttEngine = new STTEngine();
    const manager = new VoiceSessionManager({
      resources: { sttEngine },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const overlay = new VoiceOverlay({
      windowController: {
        show: view => windowUpdates.push({ type: 'show', view }),
        hide: () => windowUpdates.push({ type: 'hide' }),
        updateState: view => windowUpdates.push({ type: 'state', view }),
        updateTranscript: payload => windowUpdates.push({ type: 'transcript', payload }),
        displayError: view => windowUpdates.push({ type: 'error', view })
      }
    });
    const transcriptEvents = [];

    manager.on(SESSION_EVENTS.VOICE_PARTIAL_TRANSCRIPT, event => transcriptEvents.push(event));
    overlay.attachToSessionManager(manager);
    manager.startSession({ id: 'ui-session' });
    sttEngine.events.emit(STT_EVENTS.PARTIAL_RESULT, {
      result: new TranscriptResult({ transcript: 'open visual', partial: true })
    });
    manager.beginProcessing();
    sttEngine.events.emit(STT_EVENTS.FINAL_RESULT, {
      result: new TranscriptResult({ finalTranscript: 'open visual studio code', partial: false })
    });
    manager.beginExecution();
    manager.finishSession();

    assert.equal(transcriptEvents.length, 1);
    assert.ok(windowUpdates.some(update => update.type === 'transcript' && update.payload.transcript === 'open visual'));
    assert.ok(windowUpdates.some(update => update.type === 'state' && update.view.state === 'PROCESSING'));
    assert.ok(windowUpdates.some(update => update.type === 'state' && update.view.state === 'EXECUTING'));
    assert.equal(overlay.getMetrics().transcriptUpdates >= 2, true);
  });

  it('should display assistant replies and folder choices in the voice overlay', function() {
    const { VoiceOverlay } = require('../../apps/desktop/voice/ui');
    const windowUpdates = [];
    const overlay = new VoiceOverlay({
      windowController: {
        updateAssistantResult: payload => windowUpdates.push(payload)
      }
    });

    const update = overlay.displayAssistantResult({
      success: false,
      needsClarification: true,
      intent: 'folder.open',
      response: 'I found 2 matching folders. Choose a number.',
      data: {
        choices: [
          { index: 1, title: 'Screenshots - C:\\A\\Screenshots', path: 'C:\\A\\Screenshots' },
          { index: 2, title: 'Screenshots - C:\\B\\Screenshots', path: 'C:\\B\\Screenshots' }
        ]
      }
    });

    assert.equal(update.updated, true);
    assert.equal(windowUpdates.length, 1);
    assert.equal(windowUpdates[0].response, 'I found 2 matching folders. Choose a number.');
    assert.equal(windowUpdates[0].heading, 'Choose an option');
    assert.equal(windowUpdates[0].choices.length, 2);
    assert.equal(windowUpdates[0].choices[0].path, 'C:\\A\\Screenshots');
  });

  it('should dispatch normalized voice text through the same assistant text boundary', async function() {
    const { AssistantInputAdapter, NormalizedTranscript } = require('../../apps/desktop/voice');
    const calls = [];
    const assistant = {
      processCommand: async (...args) => {
        calls.push(args);
        return {
          success: true,
          intent: 'app.open',
          entities: { appName: 'VS Code' },
          response: `handled ${args[0]}`
        };
      }
    };
    const adapter = new AssistantInputAdapter({ assistant });
    const direct = await assistant.processCommand('Open VS Code');
    calls.length = 0;
    const spoken = await adapter.handle(new NormalizedTranscript({
      normalizedTranscript: 'Open VS Code',
      validation: { valid: true }
    }));

    assert.deepEqual(spoken, direct);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0], 'Open VS Code');
  });

  it('should prove typed and spoken command corpus results stay identical', async function() {
    const { AssistantInputAdapter, NormalizedTranscript } = require('../../apps/desktop/voice');
    const commands = Array.from({ length: 100 }, (_item, index) => `Open VS Code ${index + 1}`);
    const assistant = {
      processCommand: async (input) => ({
        success: true,
        nlp: { text: input.toLowerCase() },
        nlu: { intent: 'app.open', confidence: 0.99 },
        intent: 'app.open',
        entities: { appName: input.replace(/^Open\s+/i, '') },
        data: { action: 'open-app', target: input },
        response: `Opened ${input}`
      })
    };
    const adapter = new AssistantInputAdapter({ assistant });

    for (const command of commands) {
      const typed = await assistant.processCommand(command);
      const spoken = await adapter.handle(new NormalizedTranscript({
        normalizedTranscript: command,
        validation: { valid: true }
      }));
      assert.deepEqual(spoken, typed);
    }
  });

  it('should reject empty voice transcripts without calling the assistant', async function() {
    const { AssistantInputAdapter } = require('../../apps/desktop/voice');
    const { EmptyVoiceCommandError } = require('../../apps/desktop/voice/integration/VoiceIntegrationErrors');
    let called = false;
    const adapter = new AssistantInputAdapter({
      assistant: {
        processCommand: async () => {
          called = true;
          return { success: true };
        }
      }
    });

    await assert.rejects(() => adapter.handle({ normalizedTranscript: '   ' }), EmptyVoiceCommandError);
    assert.equal(called, false);
  });

  it('should bridge VoiceSessionManager normalized transcripts to assistant input only', async function() {
    const { VoiceAssistantBridge, VoiceSessionManager, TranscriptResult, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const calls = [];
    const assistant = {
      processCommand: async (...args) => {
        calls.push(args);
        return { success: true, intent: 'app.open', response: 'done' };
      }
    };
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const bridge = new VoiceAssistantBridge({
      manager,
      assistant,
      configuration: { autoTransitionSession: false }
    });
    const normalizedEvents = [];
    manager.on(SESSION_EVENTS.VOICE_NORMALIZED_TRANSCRIPT, event => normalizedEvents.push(event));

    manager.startSession({ id: 'assistant-bridge-session' });
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'open visual studio code',
      confidence: 0.9,
      partial: false
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(normalizedEvents.length, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['Open VS Code']);
    bridge.detach();
  });

  it('should resume the same voice session after assistant execution', async function() {
    const { VoiceAssistantBridge, VoiceSessionManager, VoiceStateMachine, TranscriptResult } = require('../../apps/desktop/voice');
    let sttRunning = false;
    let sttStarts = 0;
    let audioResets = 0;
    const sttEngine = {
      on() {},
      initialize: () => ({ initialized: true }),
      start: () => {
        sttRunning = true;
        sttStarts += 1;
        return { started: true, state: 'DECODING' };
      },
      isRunning: () => sttRunning,
      cancel: () => {
        sttRunning = false;
        return { cancelled: true, state: 'STOPPED' };
      },
      getStatus: () => ({ running: sttRunning })
    };
    const manager = new VoiceSessionManager({
      resources: {
        sttEngine,
        audioProcessor: {
          on() {},
          reset: () => {
            audioResets += 1;
            return { reset: true };
          },
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const bridge = new VoiceAssistantBridge({
      manager,
      assistant: {
        processCommand: async () => ({ success: true, response: 'done' })
      }
    });

    manager.startSession({ id: 'continuous-session' });
    manager.startSpeechToText();
    sttRunning = false;
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'hello assistant',
      confidence: 0.9,
      partial: false
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.LISTENING);
    assert.equal(manager.isActive(), true);
    assert.equal(manager.getSession().context.recognition.finalTranscript, '');
    assert.equal(manager.getSession().context.recognition.partialTranscript, '');
    assert.equal(sttRunning, true);
    assert.equal(sttStarts, 2);
    assert.equal(audioResets, 1);
    bridge.detach();
  });

  it('should wait for voice TTS completion before resuming recognition', async function() {
    const { VoiceAssistantBridge, VoiceSessionManager, VoiceStateMachine, TranscriptResult } = require('../../apps/desktop/voice');
    let sttRunning = false;
    let sttStarts = 0;
    let audioResets = 0;
    let resolveTts;
    let spokenText = '';
    const sttEngine = {
      on() {},
      initialize: () => ({ initialized: true }),
      start: () => {
        sttRunning = true;
        sttStarts += 1;
        return { started: true, state: 'DECODING' };
      },
      isRunning: () => sttRunning,
      cancel: () => {
        sttRunning = false;
        return { cancelled: true, state: 'STOPPED' };
      },
      getStatus: () => ({ running: sttRunning })
    };
    const manager = new VoiceSessionManager({
      resources: {
        sttEngine,
        audioProcessor: {
          on() {},
          reset: () => {
            audioResets += 1;
            return { reset: true };
          },
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const bridge = new VoiceAssistantBridge({
      manager,
      assistant: {
        processCommand: async () => ({ success: true, response: 'The time is 8 PM.' })
      },
      textToSpeech: {
        speakAsync: text => {
          spokenText = text;
          return new Promise(resolve => {
            resolveTts = resolve;
          });
        },
        stop: () => {}
      }
    });

    manager.startSession({ id: 'tts-synchronized-session' });
    manager.startSpeechToText();
    sttRunning = false;
    manager.beginProcessing();
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'what is the time',
      confidence: 0.9,
      partial: false
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(spokenText, 'The time is 8 PM.');
    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.SPEAKING);
    assert.equal(sttRunning, false);
    assert.equal(sttStarts, 1);

    resolveTts({ outcome: 'completed' });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.LISTENING);
    assert.equal(sttRunning, true);
    assert.equal(sttStarts, 2);
    assert.equal(audioResets, 1);
    assert.equal(manager.getMetrics().runtimePipeline.ttsCompletions, 1);
    assert.equal(manager.getMetrics().runtimePipeline.listeningCycles, 1);
    bridge.detach();
  });

  it('should speak the assistant spokenResponse instead of the full chat response', async function() {
    const { VoiceAssistantBridge, VoiceSessionManager, TranscriptResult } = require('../../apps/desktop/voice');
    let sttRunning = false;
    let spokenText = null;
    const manager = new VoiceSessionManager({
      resources: {
        sttEngine: {
          on() {},
          initialize: () => ({ initialized: true }),
          start: () => {
            sttRunning = true;
            return { started: true, state: 'DECODING' };
          },
          isRunning: () => sttRunning,
          cancel: () => {
            sttRunning = false;
            return { cancelled: true, state: 'STOPPED' };
          },
          getStatus: () => ({ running: sttRunning })
        },
        audioProcessor: {
          on() {},
          reset: () => ({ reset: true }),
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const bridge = new VoiceAssistantBridge({
      manager,
      assistant: {
        processCommand: async () => ({
          success: true,
          response: 'I found 4 matching local files: Resume.docx, Resume Backup.pdf, Resume old.docx, and one more.',
          spokenResponse: 'I found four resume files.'
        })
      },
      textToSpeech: {
        speakAsync: text => {
          spokenText = text;
          return Promise.resolve({ outcome: 'completed' });
        },
        stop: () => {}
      }
    });

    manager.startSession({ id: 'spoken-response-session' });
    manager.startSpeechToText();
    sttRunning = false;
    manager.beginProcessing();
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'find my resume',
      confidence: 0.9,
      partial: false
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(spokenText, 'I found four resume files.');
    bridge.detach();
  });

  it('should stop TTS and not resume listening when a speaking voice session is cancelled', async function() {
    const { VoiceAssistantBridge, VoiceSessionManager, VoiceStateMachine, TranscriptResult } = require('../../apps/desktop/voice');
    let sttRunning = false;
    let stopped = false;
    let resolveTts;
    const manager = new VoiceSessionManager({
      resources: {
        sttEngine: {
          on() {},
          initialize: () => ({ initialized: true }),
          start: () => {
            sttRunning = true;
            return { started: true, state: 'DECODING' };
          },
          isRunning: () => sttRunning,
          cancel: () => {
            sttRunning = false;
            return { cancelled: true, state: 'STOPPED' };
          },
          getStatus: () => ({ running: sttRunning })
        },
        audioProcessor: {
          on() {},
          reset: () => ({ reset: true }),
          getStatus: () => ({ initialized: true })
        }
      },
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const bridge = new VoiceAssistantBridge({
      manager,
      assistant: {
        processCommand: async () => ({ success: true, response: 'Cancelling is supported.' })
      },
      textToSpeech: {
        speakAsync: () => new Promise(resolve => {
          resolveTts = resolve;
        }),
        stop: () => {
          stopped = true;
          resolveTts?.({ outcome: 'cancelled' });
        }
      }
    });

    manager.startSession({ id: 'cancel-speaking-session' });
    manager.startSpeechToText();
    sttRunning = false;
    manager.beginProcessing();
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'cancel test',
      confidence: 0.9,
      partial: false
    }));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.SPEAKING);
    manager.cancelSession('cancel while speaking');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(stopped, true);
    assert.equal(manager.getCurrentState(), VoiceStateMachine.STATES.IDLE);
    assert.equal(sttRunning, false);
    assert.equal(manager.getMetrics().runtimePipeline.ttsCancellations, 1);
    bridge.detach();
  });

  it('should stop assistant speech without cancelling the active voice session', async function() {
    const VoiceExecutionCoordinator = require('../../apps/desktop/voice/integration/VoiceExecutionCoordinator');
    let stopped = false;
    const coordinator = new VoiceExecutionCoordinator({
      textToSpeech: {
        isSpeaking: true,
        stop: () => {
          stopped = true;
        }
      }
    });
    coordinator.activeTurn = { id: 'turn-stop-only', cancelled: false };

    const result = coordinator.stopSpeaking('single-tap-stop-speaking');

    assert.equal(result.stopped, true);
    assert.equal(stopped, true);
    assert.equal(coordinator.activeTurn.cancelled, true);
    assert.equal(coordinator.getMetrics().cancelledCommands, 0);
  });

  it('should collect passive local diagnostics without storing private transcript text', function() {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { DiagnosticsManager, VoiceSessionManager, TranscriptResult, SESSION_EVENTS } = require('../../apps/desktop/voice');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-voice-diagnostics-'));
    const manager = new VoiceSessionManager({
      setTimeout: () => ({ unref() {} }),
      clearTimeout: () => {}
    });
    const diagnostics = new DiagnosticsManager({
      configuration: { storageRoot, maximumLogSizeBytes: 4096 },
      clock: () => new Date('2026-06-30T10:00:00.000Z')
    });

    diagnostics.start({ sessionManager: manager, resources: { sessionManager: manager } });
    diagnostics.recordMetric('audio.queue.depth', 3, { transcript: 'open secret file' });
    diagnostics.recordLatency('assistant.dispatch', 42);
    diagnostics.observeEvent(SESSION_EVENTS.VOICE_RECOGNITION_CYCLE, {
      phase: 'started',
      session: { sessionId: 'diagnostics-session' }
    });
    manager.startSession({ id: 'diagnostics-session' });
    manager.processTranscript(new TranscriptResult({
      finalTranscript: 'open visual studio code',
      confidence: 0.9,
      partial: false
    }));
    manager.beginProcessing();
    manager.beginExecution();
    manager.finishSession();
    const report = diagnostics.generateReport('summary');
    const snapshot = diagnostics.getSnapshot();

    assert.equal(snapshot.metrics.totals['audio.queue.depth'], 3);
    assert.equal(snapshot.latency['assistant.dispatch'].p95, 42);
    assert.equal(snapshot.sessions.sessionsStarted, 1);
    assert.equal(snapshot.sessions.recognitionCycles.started, 1);
    assert.equal(snapshot.health.status, 'healthy');
    assert.equal(fs.existsSync(report.path), true);
    assert.equal(JSON.stringify(snapshot).includes('open secret file'), false);
    diagnostics.stop();
  });

  it('should write human-readable sanitized voice diagnostic log lines', function() {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { VoiceLogger } = require('../../apps/desktop/voice');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-voice-log-'));
    const logger = new VoiceLogger({
      enabled: true,
      configuration: { storageRoot, maximumLogSizeBytes: 4096 }
    });

    const result = logger.info('[Voice] Runtime pipeline: partial transcript updated', {
      state: 'LISTENING',
      recognitionCycleId: 'cycle-1',
      transcript: 'open my private folder',
      counters: {
        audioFrames: 100,
        processedFrames: 98,
        sttFrames: 97,
        partialTranscripts: 3
      }
    });
    const content = fs.readFileSync(path.join(storageRoot, 'logs', 'voice.log'), 'utf8');

    assert.equal(result.logged, true);
    assert.match(result.line, /INFO\s+Voice\s+Runtime pipeline: partial transcript updated/);
    assert.match(content, /state=LISTENING/);
    assert.match(content, /recognition-cycle-id=cycle-1/);
    assert.match(content, /transcript-length=22 chars/);
    assert.match(content, /pipeline=audio:100,processed:98,stt:97,partial:3/);
    assert.doesNotMatch(content, /open my private folder/);
  });

  it('should track errors and health status without interrupting voice execution', function() {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { DiagnosticsManager } = require('../../apps/desktop/voice');
    const diagnostics = new DiagnosticsManager({
      configuration: { storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'openx-voice-health-')) }
    });

    diagnostics.recordError(new Error('Microphone unavailable'), { component: 'audio', severity: 'error' });
    diagnostics.recordLatency('recognition', 6000);
    const health = diagnostics.getHealth();

    assert.equal(diagnostics.getSnapshot().errors.count, 1);
    assert.ok(['warning', 'degraded'].includes(health.status));
  });

  it('should keep NLP, routing, automation, and assistant behavior out of Phase 9 diagnostics', function() {
    const {
      AudioDeviceManager,
      TranscriptNormalizer,
      AssistantInputAdapter,
      VoiceAssistantBridge,
      DiagnosticsManager
    } = require('../../apps/desktop/voice');
    const { TranscriptPublisher } = require('../../apps/desktop/voice/ui');

    assert.deepEqual(new AudioDeviceManager().listInputDevices(), []);
    assert.equal(new TranscriptNormalizer().normalize('Hello'), 'Hello');
    assert.deepEqual(new TranscriptPublisher().publish('Hello'), { published: true, transcript: 'Hello', partial: false });
    assert.equal(typeof AssistantInputAdapter, 'function');
    assert.equal(typeof VoiceAssistantBridge, 'function');
    assert.equal(typeof DiagnosticsManager, 'function');
  });
});
