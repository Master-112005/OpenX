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

  it('should initialize the Node speech recognition engine', async function() {
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

  it('should allow low-confidence fuzzy actionable commands into NLP routing', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'ope chrome',
      confidence: 0.34,
      noSpeechProbability: 0.5,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['open chrome']);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should allow low-confidence conversational commands into NLP routing', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'i was saying search for java tutorial',
      confidence: 0.34,
      noSpeechProbability: 0.5,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['search for java tutorial']);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should use NLP-corrected STT text for typo-heavy search commands', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'serch chatgpt in chrome',
      confidence: 0.38,
      noSpeechProbability: 0.5,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['search chatgpt in chrome']);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should recover actionable commands from recognition alternates', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    vm._handleEngineEvent({
      event: 'result',
      text: 'lola',
      confidence: 0.72,
      mode: 'conversation',
      alternates: [
        { text: 'open chrome', confidence: 0.56 },
        { text: 'open edge', confidence: 0.41 }
      ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].text, 'open chrome');
    vm.destroy();
  });

  it('should recover a command alternate when the primary result is filler noise', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    vm._handleEngineEvent({
      event: 'result',
      text: 'the tool',
      confidence: 0.88,
      mode: 'conversation',
      alternates: [
        { text: 'open youtube', confidence: 0.62 },
        { text: 'the tool', confidence: 0.88 }
      ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].text, 'open youtube');
    vm.destroy();
  });

  it('should ignore one-word non-actionable recognition noise before routing', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'lola',
      confidence: 0.91,
      mode: 'conversation'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should hold incomplete command fragments instead of routing them', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'open',
      confidence: 0.9,
      noSpeechProbability: 0.2,
      mode: 'conversation'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.pendingVoiceFragment.verb, 'open');
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should recover a split utterance when the target arrives after an incomplete fragment', async function() {
    const { vm } = createVoiceManager({
      voice: {
        conversationIgnoredSpeechLimit: 3
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
      text: 'open',
      confidence: 0.9,
      noSpeechProbability: 0.2,
      mode: 'conversation'
    });
    vm._handleEngineEvent({
      event: 'result',
      text: 'chrome',
      confidence: 0.72,
      noSpeechProbability: 0.2,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['open chrome']);
    assert.equal(vm.pendingVoiceFragment, null);
    vm.destroy();
  });

  it('should not recover repetitive whisper noise into a command', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'home. home. home. home. open',
      confidence: 0.92,
      noSpeechProbability: 0.18,
      mode: 'conversation'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should ignore short multi-word recognition noise before routing', async function() {
    const { vm } = createVoiceManager({
      voice: {
        conversationIgnoredSpeechLimit: 3
      }
    });
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'the know of',
      confidence: 0.91,
      mode: 'conversation'
    });
    vm._handleEngineEvent({
      event: 'result',
      text: 'the tool',
      confidence: 0.91,
      mode: 'conversation'
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should ignore common speech hallucination phrases from background noise', async function() {
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

  it('should include voice turn quality metadata with accepted transcripts', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'open chrome',
      confidence: 0.91,
      noSpeechProbability: 0.1,
      mode: 'conversation',
      speaker: { verified: true, score: 0.92 }
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].voiceTurn.decision, 'execute');
    assert.equal(results[0].voiceTurn.speaker.status, 'verified');
    assert.equal(results[0].utterance.voiceTurn.quality > 0, true);
    vm.destroy();
  });

  it('should accept short conversational greetings after manual activation', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'hello',
      confidence: 0.7,
      noSpeechProbability: 0.62,
      mode: 'conversation'
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].text, 'hello');
    assert.equal(results[0].voiceTurn.signals.conversational, true);
    vm.destroy();
  });

  it('should block commands when speaker verification reports a mismatch', async function() {
    const { vm } = createVoiceManager();
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'open chrome',
      confidence: 0.95,
      mode: 'conversation',
      speaker: { verified: false, score: 0.2 }
    });

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().state, 'LISTENING');
    vm.destroy();
  });

  it('should reject noisy dictation phrases that look like fuzzy commands', async function() {
    const { vm } = createVoiceManager({
      voice: {
        conversationIgnoredSpeechLimit: 10
      }
    });
    let speechResult = false;

    await vm.initialize();
    vm.on('speechResult', () => {
      speechResult = true;
    });

    assert.equal(vm.manualActivate(), true);

    for (const text of [
      'Although you do a',
      'Albany until',
      "Old then you'd go",
      'all chat you do a',
      'all the new dial',
      'old the you d go'
    ]) {
      vm._handleEngineEvent({
        event: 'result',
        text,
        confidence: 0.72,
        mode: 'conversation'
      });
    }

    assert.equal(speechResult, false);
    assert.equal(vm.getStatus().conversationActive, true);
    vm.destroy();
  });

  it('should still allow question-style voice requests', async function() {
    const { vm } = createVoiceManager();
    const results = [];

    await vm.initialize();
    vm.on('speechResult', (data) => {
      results.push(data);
    });

    assert.equal(vm.manualActivate(), true);

    vm._handleEngineEvent({
      event: 'result',
      text: 'what is the time',
      confidence: 0.72,
      mode: 'conversation'
    });
    vm._handleEngineEvent({
      event: 'result',
      text: 'when apple wwdc event',
      confidence: 0.72,
      mode: 'conversation'
    });

    assert.deepEqual(results.map(result => result.text), ['what is the time', 'when apple wwdc event']);
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
