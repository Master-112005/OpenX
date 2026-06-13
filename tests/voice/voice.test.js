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
      this.timer = null;
      this.stopped = false;
    }
    async initialize() {
      return true;
    }
    speak(text) {
      this.isSpeaking = true;
      this.stopped = false;
      this.emit('speaking', text);
      this.timer = setTimeout(() => {
        this.isSpeaking = false;
        this.emit('completed', text);
      }, 20);
    }
    async speakAsync(text) {
      this.speak(text);
    }
    stop() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.stopped = true;
      this.isSpeaking = false;
      this.emit('stopped');
    }
    destroy() {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    }
  }

  class FakeSpeechToText extends EventEmitter {
    constructor() {
      super();
      this.ready = false;
    }
    async initialize() {
      this.ready = true;
      this.emit('ready', { event: 'ready', backend: 'fake-stt' });
      return true;
    }
    listen(payload) {
      this.emit('test:stdin', { command: 'listen', ...payload });
      this.emit('event', {
        event: 'stt_session_activated',
        mode: payload?.mode || 'command',
        startSpeechTimeoutMs: payload?.startSpeechTimeoutMs
      });
    }
    pause() {
      this.emit('test:stdin', { command: 'pause' });
      this.emit('event', { event: 'paused' });
    }
    resume() {
      this.emit('test:stdin', { command: 'resume' });
      this.emit('event', { event: 'resumed' });
    }
    shutdown() {}
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
    const stt = new FakeSpeechToText();

    const vm = new VoiceManager(mergedConfig, {
      eventBus,
      tts,
      stt
    });

    stt.on('test:stdin', (payload) => vm.emit('test:stdin', payload));

    return {
      vm,
      eventBus,
      tts,
      stt
    };
  }

  before(function() {
    VoiceManager = require('../../core/voice/index');
    AssistantEventBus = require('../../core/shared/index').AssistantEventBus;
  });

  it('should initialize the speech recognition engine', async function() {
    const { vm } = createVoiceManager();
    await vm.initialize();
    assert.equal(vm.workerReady, true);
    vm.destroy();
  });

  it('should select whisper-stream when configured without changing the voice contract', function() {
    const vm = new VoiceManager({
      voice: {
        stt: {
          provider: 'whisper-stream'
        },
        whisper: {}
      }
    }, {
      eventBus: new AssistantEventBus(),
      tts: new FakeTextToSpeech()
    });

    assert.equal(vm.stt.constructor.name, 'WhisperStreamSpeechEngine');
    vm.destroy();
  });

  it('should fall back to Windows SAPI when the configured primary STT engine is unavailable', async function() {
    const vm = new VoiceManager({
      voice: {
        stt: {
          provider: 'whisper-stream'
        },
        whisper: {
          executablePath: 'missing/whisper-stream.exe',
          modelPath: 'missing/ggml-small.en.bin'
        }
      }
    }, {
      eventBus: new AssistantEventBus(),
      tts: new FakeTextToSpeech()
    });

    await vm.initialize();

    assert.equal(vm.stt.constructor.name, 'WindowsSapiSpeechEngine');
    assert.equal(vm.workerReady, true);
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

  it('should preserve the manual activation trigger for fallback shortcuts', async function() {
    const { vm } = createVoiceManager();
    let activationPayload = null;

    await vm.initialize();
    vm.on('activated', (payload) => {
      activationPayload = payload;
    });

    assert.equal(vm.manualActivate({ trigger: 'Control+Alt+Space' }), true);
    assert.equal(activationPayload.trigger, 'Control+Alt+Space');
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should forward any non-empty transcript without STT-side judgment', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    for (const text of [
      'open',
      'thanks for watching',
      'home. home. home. home. open',
      'Although you do a',
      'open chrome'
    ]) {
      vm._handleEngineEvent({
        event: 'result',
        text,
        mode: 'conversation'
      });
    }

    assert.deepEqual(results.map(result => result.text), [
      'open',
      'thanks for watching',
      'home. home. home. home. open',
      'Although you do a',
      'open chrome'
    ]);
    assert.equal(results.every(result => !Object.prototype.hasOwnProperty.call(result, 'confidence')), true);
    assert.equal(results.every(result => !Object.prototype.hasOwnProperty.call(result, 'voiceTurn')), true);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should publish final transcript events with text-only STT metadata', async function() {
    const { vm, eventBus } = createVoiceManager();
    const sttCompleted = [];
    const finalTranscripts = [];

    eventBus.subscribe('stt.completed', payload => sttCompleted.push(payload));
    eventBus.subscribe('voice.finalTranscript', payload => finalTranscripts.push(payload));

    await vm.initialize();
    vm._handleEngineEvent({
      event: 'result',
      text: 'search node js',
      mode: 'command',
      backend: 'fake-stt'
    });

    assert.equal(sttCompleted.length, 1);
    assert.equal(finalTranscripts.length, 1);
    assert.deepEqual(sttCompleted[0].payload, {
      text: 'search node js',
      backend: 'fake-stt'
    });
    assert.deepEqual(finalTranscripts[0].payload, {
      text: 'search node js',
      mode: 'command',
      backend: 'fake-stt'
    });
    vm.destroy();
  });

  it('should treat an empty STT result as no recognized speech', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;
    let timeout = null;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });
    vm.on('listeningTimeout', (data) => {
      timeout = data;
    });

    assert.equal(vm.manualActivate(), true);
    vm._handleEngineEvent({
      event: 'result',
      text: '',
      mode: 'conversation',
      timeoutMs: 20000
    });

    assert.equal(speechResult, false);
    assert.ok(timeout);
    assert.equal(timeout.reason, 'no-speech-detected');
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });

  it('should forward partial transcripts without classification metadata', async function() {
    const { vm, eventBus } = createVoiceManager();
    const partials = [];

    eventBus.subscribe('voice.partialTranscript', payload => partials.push(payload));
    await vm.initialize();

    vm._handleEngineEvent({
      event: 'partial_result',
      text: ' open chrome ',
      mode: 'conversation',
      backend: 'fake-stt'
    });

    assert.deepEqual(partials[0].payload, {
      text: 'open chrome',
      mode: 'conversation',
      backend: 'fake-stt'
    });
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

  it('should interrupt assistant speech and listen again when the hotkey is pressed', async function() {
    const { vm, tts } = createVoiceManager();
    const listenCommands = [];
    let interruptedPayload = null;

    await vm.initialize();
    vm.on('test:stdin', (payload) => {
      if (payload.command === 'listen') {
        listenCommands.push(payload);
      }
    });
    vm.on('activated', (payload) => {
      if (payload.interrupted) {
        interruptedPayload = payload;
      }
    });

    vm.speak('This response is still being spoken.');
    assert.equal(tts.isSpeaking, true);

    const activated = vm.manualActivate();

    assert.equal(activated, true);
    assert.equal(tts.stopped, true);
    assert.ok(interruptedPayload);
    assert.equal(listenCommands.length, 1);
    assert.equal(listenCommands[0].mode, 'conversation');
    assert.equal(listenCommands[0].resetSpeakerLock, true);
    vm.destroy();
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

  it('should default TTS to a slower natural rate and SSML output', function() {
    const TextToSpeech = require('../../core/voice/tts/index');
    const tts = new TextToSpeech({});
    const ssml = tts._buildSsml('Done, sir. Awaiting command.');

    assert.equal(tts.rate, -1);
    assert.equal(tts.naturalize, true);
    assert.ok(ssml.includes('<prosody'));
    assert.ok(ssml.includes('<break time="90ms"/>'));
    assert.ok(ssml.includes('<break time="180ms"/>'));
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
