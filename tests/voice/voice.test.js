const assert = require('assert');
const EventEmitter = require('events');

describe('Voice Manager', function() {
  this.timeout(10000);
  let VoiceManager;
  let AssistantEventBus;

  class FakeWakeWord extends EventEmitter {
    constructor(config) {
      super();
      this.wakeWord = config?.voice?.wakeWord || 'jarvis';
      this.isListening = false;
    }

    async start() {
      this.isListening = true;
      this.emit('ready');
      return true;
    }

    async pause() {
      this.isListening = false;
    }

    async resume() {
      this.isListening = true;
    }

    manualActivate() {
      this.emit('wakeword', {
        wakeWord: this.wakeWord,
        confidence: 1,
        manual: true
      });
    }

    destroy() {}
  }

  class FakeSpeechToText extends EventEmitter {
    constructor() {
      super();
      this.isListening = false;
      this.backend = 'test';
    }

    async initialize() {
      return true;
    }

    startListening() {
      this.isListening = true;
      this.emit('listening');
    }

    stopListening() {
      if (!this.isListening) {
        return;
      }

      this.isListening = false;
      this.emit('stopped');
    }

    destroy() {}
  }

  class FakeTextToSpeech extends EventEmitter {
    async initialize() {
      return true;
    }

    speak(text) {
      this.emit('speaking', text);
      this.emit('completed', text);
    }

    async speakAsync(text) {
      this.emit('speaking', text);
      this.emit('completed', text);
    }

    destroy() {}
  }

  function createVoiceManager(config = {}) {
    const mergedConfig = {
      ...config,
      voice: {
        allowManualActivation: true,
        ...(config.voice || {})
      }
    };
    const eventBus = new AssistantEventBus();
    const wakeWord = new FakeWakeWord(mergedConfig);
    const stt = new FakeSpeechToText();
    const tts = new FakeTextToSpeech();
    const vm = new VoiceManager(mergedConfig, {
      eventBus,
      wakeWord,
      stt,
      tts
    });

    return {
      vm,
      eventBus,
      wakeWord,
      stt,
      tts
    };
  }

  before(function() {
    VoiceManager = require('../../core/voice/index');
    AssistantEventBus = require('../../core/shared/index').AssistantEventBus;
  });

  it('should initialize without errors', async function() {
    const { vm } = createVoiceManager({ voice: { wakeWord: 'jarvis' } });
    await vm.initialize();
    vm.destroy();
  });

  it('should have wake word detector', function() {
    const { vm } = createVoiceManager({ voice: { wakeWord: 'jarvis' } });
    assert.ok(vm.wakeWord);
    assert.equal(vm.wakeWord.wakeWord, 'jarvis');
    vm.destroy();
  });

  it('should have speech-to-text module', function() {
    const { vm } = createVoiceManager({});
    assert.ok(vm.stt);
    vm.destroy();
  });

  it('should have text-to-speech module', function() {
    const { vm } = createVoiceManager({});
    assert.ok(vm.tts);
    vm.destroy();
  });

  it('should emit events on manual activation', function(done) {
    const { vm } = createVoiceManager({});
    vm.on('activated', () => {
      vm.destroy();
      done();
    });
    vm.manualActivate();
  });

  it('should acknowledge activation before starting speech capture', function(done) {
    const { vm, stt } = createVoiceManager({});

    stt.startListening = () => {
      stt.isListening = true;
      assert.equal(vm.getStatus().state, 'LISTENING');
      vm.destroy();
      done();
    };

    vm.manualActivate();
  });

  it('should resume wake-word listening after speech capture stops', function(done) {
    const { vm, wakeWord, stt, tts } = createVoiceManager({});
    let resumed = false;

    wakeWord.pause = async () => {};
    wakeWord.resume = async () => {
      resumed = true;
    };
    tts.speakAsync = async () => {};
    stt.startListening = () => {
      stt.isListening = false;
      stt.emit('stopped');
      setTimeout(() => {
        assert.equal(resumed, true);
        vm.destroy();
        done();
      }, 20);
    };

    vm.manualActivate();
  });

  it('should publish voice lifecycle events through the shared event bus', function(done) {
    const { vm, eventBus, stt } = createVoiceManager({});
    const observed = [];

    eventBus.subscribe('*', ({ event }) => {
      observed.push(event);
    });

    vm.manualActivate();
    setImmediate(() => {
      stt.emit('result', {
        text: 'open chrome',
        confidence: 0.98,
        backend: 'test'
      });

      assert.ok(observed.includes('wakeword.detected'));
      assert.ok(observed.includes('listener.started'));
      assert.ok(observed.includes('utterance.finalized'));
    assert.ok(observed.includes('stt.completed'));
    assert.equal(vm.getStatus().state, 'PROCESSING');
    vm.destroy();
    done();
    });
  });

  it('should ignore manual activation when wake-word-only mode is enabled', function() {
    const eventBus = new AssistantEventBus();
    const config = {
      voice: {
        wakeWord: 'jarvis',
        allowManualActivation: false
      }
    };
    const vm = new VoiceManager(config, {
      eventBus,
      wakeWord: new FakeWakeWord(config),
      stt: new FakeSpeechToText(),
      tts: new FakeTextToSpeech()
    });

    const activated = vm.manualActivate();

    assert.equal(activated, false);
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });

  it('should start speech capture immediately without waiting for activation acknowledgement', function(done) {
    const { vm, stt, tts } = createVoiceManager({
      voice: {
        allowManualActivation: true,
        speakActivationAcknowledgement: true,
        activationAcknowledgement: 'Yes, sir. I am listening.'
      }
    });
    let listeningStarted = false;
    let ttsFinished = false;

    tts.speakAsync = async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      ttsFinished = true;
    };

    stt.startListening = () => {
      listeningStarted = true;
      stt.isListening = true;
      setTimeout(() => {
        assert.equal(listeningStarted, true);
        assert.equal(ttsFinished, false);
        vm.destroy();
        done();
      }, 5);
    };

    vm.manualActivate();
  });

  it('should execute an inline wake-word command without opening a second listening turn', function(done) {
    const { vm, wakeWord, stt } = createVoiceManager({
      voice: {
        allowManualActivation: true
      }
    });
    let startedListening = false;

    stt.startListening = () => {
      startedListening = true;
    };

    vm.on('speechResult', (data) => {
      assert.equal(data.text, 'open chrome');
      assert.equal(data.backend, 'wakeword-inline');
      assert.equal(startedListening, false);
      vm.destroy();
      done();
    });

    wakeWord.emit('wakeword', {
      wakeWord: 'jarvis',
      transcript: 'hey jarvis open chrome',
      confidence: 1,
      manual: false,
      inlineCommand: true
    });
  });

  it('should open a listening turn for wake-word activation without forcing an inline command', function(done) {
    const { vm, wakeWord, stt } = createVoiceManager({
      voice: {
        allowManualActivation: true
      }
    });

    stt.startListening = () => {
      stt.isListening = true;
      vm.destroy();
      done();
    };

    wakeWord.emit('wakeword', {
      wakeWord: 'jarvis',
      transcript: 'jarvis',
      confidence: 1,
      manual: false,
      inlineCommand: false
    });
  });
});
