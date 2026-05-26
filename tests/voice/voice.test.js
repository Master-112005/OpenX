const assert = require('assert');
const EventEmitter = require('events');

describe('Voice Manager & Audio Engine Integration', function() {
  this.timeout(10000);
  let VoiceManager;
  let AssistantEventBus;

  class FakeTextToSpeech extends EventEmitter {
    constructor() {
      super();
      this.isSpeaking = false;
    }
    async initialize() {
      return true;
    }
    speak(text) {
      this.isSpeaking = true;
      this.emit('speaking', text);
      setTimeout(() => {
        this.isSpeaking = false;
        this.emit('completed', text);
      }, 20);
    }
    async speakAsync(text) {
      this.speak(text);
    }
    destroy() {}
  }

  function createVoiceManager(config = {}) {
    const mergedConfig = {
      ...config,
      voice: {
        activationShortcut: 'Alt+Space',
        allowManualActivation: true,
        ...(config.voice || {})
      }
    };
    const eventBus = new AssistantEventBus();
    const tts = new FakeTextToSpeech();

    const vm = new VoiceManager(mergedConfig, {
      eventBus,
      tts
    });

    vm._startAudioEngine = function() {
      this.workerReady = true;
      this.workerProcess = {
        stdin: {
          write: (data) => {
            this.emit('test:stdin', JSON.parse(data.trim()));
          }
        },
        kill: () => {}
      };
      return Promise.resolve();
    };

    return {
      vm,
      eventBus,
      tts
    };
  }

  before(function() {
    VoiceManager = require('../../core/voice/index');
    AssistantEventBus = require('../../core/shared/index').AssistantEventBus;
  });

  it('should initialize and spawn the persistent subprocess', async function() {
    const { vm } = createVoiceManager();
    await vm.initialize();
    assert.equal(vm.workerReady, true);
    assert.ok(vm.workerProcess);
    vm.destroy();
  });

  it('should activate listening when the hotkey is triggered', function(done) {
    const { vm } = createVoiceManager();

    vm.initialize().then(() => {
      const seen = {
        activated: false,
        listenCommand: false
      };

      vm.on('activated', (payload) => {
        seen.activated = true;
        assert.equal(payload.trigger, 'Alt+Space');
      });

      vm.on('test:stdin', (payload) => {
        if (payload.command === 'listen') {
          assert.equal(payload.mode, 'conversation');
          assert.equal(payload.startSpeechTimeoutMs, 20000);
          assert.equal(payload.resetSpeakerLock, true);
          seen.listenCommand = true;
        }
      });

      vm.on('listening', () => {
        assert.equal(seen.activated, true);
        assert.equal(seen.listenCommand, true);
        assert.equal(vm.getStatus().state, 'LISTENING');
        vm.destroy();
        done();
      });

      const result = vm.manualActivate();
      assert.equal(result, true);
    });
  });

  it('should keep a hotkey conversation active after a recognized command', async function() {
    const { vm } = createVoiceManager();
    let deactivated = false;

    await vm.initialize();
    vm.on('deactivated', () => {
      deactivated = true;
    });

    assert.equal(vm.manualActivate(), true);

    const result = await new Promise((resolve) => {
      vm.on('speechResult', (data) => resolve(data));
      vm._handleEngineEvent({
        event: 'result',
        text: 'open chrome',
        confidence: 0.91,
        mode: 'conversation'
      });
    });

    assert.equal(result.text, 'open chrome');
    assert.equal(deactivated, false);
    assert.equal(vm.getStatus().active, true);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should end a hotkey conversation after the 20 second silence timeout', async function() {
    const { vm } = createVoiceManager();

    await vm.initialize();
    assert.equal(vm.manualActivate(), true);

    const timeout = await new Promise((resolve) => {
      vm.on('listeningTimeout', (data) => resolve(data));
      vm._handleEngineEvent({
        event: 'session_timeout',
        mode: 'conversation',
        timeoutMs: 20000,
        reason: 'no-speech-detected'
      });
    });

    assert.equal(timeout.mode, 'conversation');
    assert.equal(timeout.timeoutMs, 20000);
    assert.equal(vm.getStatus().active, false);
    assert.equal(vm.getStatus().conversationActive, false);
    vm.destroy();
  });

  it('should reject manual activation when disabled', async function() {
    const { vm } = createVoiceManager({
      voice: {
        allowManualActivation: false
      }
    });

    await vm.initialize();
    assert.equal(vm.manualActivate(), false);
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });

  it('should suppress capture stream during TTS speaking and resume it upon completion', function(done) {
    const { vm } = createVoiceManager();

    vm.initialize().then(() => {
      let pauseCommand = false;
      let resumeCommand = false;

      vm.on('test:stdin', (payload) => {
        if (payload.command === 'pause') pauseCommand = true;
        if (payload.command === 'resume') resumeCommand = true;
      });

      vm.on('speechCompleted', () => {
        assert.equal(pauseCommand, true);
        assert.equal(resumeCommand, true);
        assert.equal(vm.getStatus().state, 'IDLE');
        vm.destroy();
        done();
      });

      vm.speak('Now testing SAPI suppression laws');
    });
  });

  it('should automatically start a confirmation listening session after speaking a permission prompt', function(done) {
    const { vm } = createVoiceManager();

    vm.initialize().then(() => {
      let listenPayload = null;

      vm.on('test:stdin', (payload) => {
        if (payload.command === 'resume') {
          setImmediate(() => {
            vm._handleEngineEvent({ event: 'resumed' });
          });
        }
        if (payload.command === 'listen') {
          listenPayload = payload;
        }
      });

      vm.on('listening', (data) => {
        if (data?.mode !== 'confirmation') {
          return;
        }

        assert.ok(listenPayload);
        assert.equal(listenPayload.mode, 'confirmation');
        assert.equal(listenPayload.startSpeechTimeoutMs, 10000);
        assert.equal(listenPayload.maxDurationMs, 10000);
        vm.destroy();
        done();
      });

      vm.queueFollowUpListening({
        mode: 'confirmation',
        startSpeechTimeoutMs: 10000,
        maxDurationMs: 10000
      });
      vm.speak('Please confirm that I should proceed.');
    });
  });

  it('should keep assistant TTS at an audible volume even when settings are too low', function() {
    const TextToSpeech = require('../../core/voice/tts/index');
    const tts = new TextToSpeech({
      voice: {
        tts: {
          volume: 20
        }
      }
    });

    assert.equal(tts.volume, 85);
    tts.destroy();
  });

  it('should emit a listening timeout when the confirmation window expires', async function() {
    const { vm } = createVoiceManager();

    await vm.initialize();

    const result = await new Promise((resolve) => {
      vm.on('listeningTimeout', (data) => resolve(data));
      vm._handleEngineEvent({
        event: 'session_timeout',
        mode: 'confirmation',
        timeoutMs: 10000,
        reason: 'no-speech-detected'
      });
    });

    assert.equal(result.mode, 'confirmation');
    assert.equal(result.timeoutMs, 10000);
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });
});
