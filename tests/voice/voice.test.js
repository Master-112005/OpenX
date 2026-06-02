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

  it('should ignore low-confidence or no-speech transcripts before routing', async function() {
    const { vm } = createVoiceManager({
      voice: {
        stt: {
          minConfidence: 0.55,
          maxNoSpeechProbability: 0.55
        }
      }
    });
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    vm._handleEngineEvent({
      event: 'result',
      text: 'thanks for watching',
      confidence: 0.3,
      noSpeechProbability: 0.92,
      mode: 'command'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });

  it('should allow low-confidence actionable commands into NLP routing', async function() {
    const { vm } = createVoiceManager({
      voice: {
        stt: {
          minConfidence: 0.55,
          commandRecoveryMinConfidence: 0.25
        }
      }
    });
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'open chrome',
      confidence: 0.34,
      noSpeechProbability: 0.6,
      mode: 'conversation'
    });
    vm._handleEngineEvent({
      event: 'result',
      text: 'open youtube',
      confidence: 0.31,
      noSpeechProbability: 0.5,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['open chrome', 'open youtube']);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should ignore common Whisper hallucination phrases from background noise', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    vm._handleEngineEvent({
      event: 'result',
      text: 'thank you',
      confidence: 0.91,
      noSpeechProbability: 0.2,
      mode: 'command'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'IDLE');
    vm.destroy();
  });

  it('should stop re-arming conversation listening after repeated ignored noise', async function() {
    const { vm } = createVoiceManager({
      voice: {
        conversationIgnoredSpeechLimit: 1,
        stt: {
          minConfidence: 0.55
        }
      }
    });
    const listenCommands = [];
    let timeout = null;

    await vm.initialize();
    vm.on('test:stdin', (payload) => {
      if (payload.command === 'listen') {
        listenCommands.push(payload);
      }
    });
    vm.on('listeningTimeout', (data) => {
      timeout = data;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'background noise',
      confidence: 0.2,
      mode: 'conversation'
    });
    assert.equal(vm.getStatus().conversationActive, true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'background noise again',
      confidence: 0.2,
      mode: 'conversation'
    });

    assert.equal(vm.getStatus().conversationActive, false);
    assert.equal(vm.getStatus().active, false);
    assert.ok(timeout);
    assert.equal(timeout.reason, 'low-transcript-confidence');
    assert.equal(listenCommands.length, 2);
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
