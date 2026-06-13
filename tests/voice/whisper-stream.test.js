const assert = require('assert');

describe('Whisper Stream STT Engine', function() {
  let WhisperStreamSpeechEngine;

  before(function() {
    WhisperStreamSpeechEngine = require('../../core/voice/stt/whisper-stream');
  });

  it('should build whisper-stream arguments from config', function() {
    const engine = new WhisperStreamSpeechEngine({
      voice: {
        whisper: {
          executablePath: 'bin/whisper/whisper-stream.exe',
          modelPath: 'models/whisper/ggml-small.en.bin',
          threads: 4,
          stepMs: 1000,
          lengthMs: 8000,
          keepMs: 300,
          maxTokens: 24,
          captureDeviceId: 2,
          audioContext: 96,
          vadThreshold: 0.7,
          freqThreshold: 120,
          keepContext: true
        }
      }
    });

    engine.executablePath = 'bin/whisper/whisper-stream.exe';
    engine.modelPath = 'models/whisper/ggml-small.en.bin';
    const args = engine._buildArgs();

    assert.deepEqual(args.slice(0, 2), ['-m', 'models/whisper/ggml-small.en.bin']);
    assert.ok(args.includes('--keep-context'));
    assert.ok(args.includes('--no-fallback'));
    assert.equal(args[args.indexOf('-t') + 1], '4');
    assert.equal(args[args.indexOf('--capture') + 1], '2');
    assert.equal(args[args.indexOf('--audio-ctx') + 1], '96');
    assert.equal(args[args.indexOf('--vad-thold') + 1], '0.7');
    assert.equal(args[args.indexOf('--freq-thold') + 1], '120');
  });

  it('should disable context carry by default to avoid repeated transcript prefixes', function() {
    const engine = new WhisperStreamSpeechEngine({});

    engine.executablePath = 'bin/whisper/whisper-stream.exe';
    engine.modelPath = 'models/whisper/ggml-small.en.bin';

    assert.equal(engine._buildArgs().includes('--keep-context'), false);
  });

  it('should parse transcript text and ignore whisper diagnostics', function() {
    const engine = new WhisperStreamSpeechEngine({});

    assert.equal(engine._parseTranscriptLine('[00:00:00.000] Open Chrome.'), 'open chrome');
    assert.equal(engine._parseTranscriptLine('\u001b[2K\r Home. Home. Home. Home. Open.'), 'home. home. home. home. open');
    assert.equal(engine._parseTranscriptLine('2k 2k aye. open chrome'), '2k 2k aye. open chrome');
    assert.equal(engine._parseTranscriptLine('whisper_init_from_file: loading model'), '');
    assert.equal(engine._parseTranscriptLine('{"text":"Search ChatGPT","confidence":0.83}'), 'search chatgpt');
    assert.equal(engine._parseTranscriptLine('{"text":"blank_audio"}'), 'blank_audio');
  });

  it('should advertise an after-last-speech timeout policy for listen sessions', function() {
    const engine = new WhisperStreamSpeechEngine({});
    let activated = null;

    engine.ready = true;
    engine.executablePath = 'bin/whisper/whisper-stream.exe';
    engine.modelPath = 'models/whisper/ggml-small.en.bin';
    engine._ensureProcess = () => {};
    engine.on('event', payload => {
      if (payload.event === 'stt_session_activated') {
        activated = payload;
      }
    });

    engine.listen({
      mode: 'conversation',
      startSpeechTimeoutMs: 20000,
      maxDurationMs: 20000
    });

    assert.equal(activated.timeoutPolicy, 'after-last-speech');
    assert.equal(activated.timeoutMs, 20000);
    assert.equal(engine.state, 'LISTENING');
    engine.shutdown();
    assert.equal(engine.state, 'IDLE');
  });

  it('should compose final transcript without duplicating incremental chunks', function() {
    const engine = new WhisperStreamSpeechEngine({});

    assert.equal(engine._composeSessionTranscript({
      chunks: ['open', 'open chrome']
    }), 'open chrome');
    assert.equal(engine._composeSessionTranscript({
      chunks: ['home', 'home home', 'home home home open']
    }), 'home home home open');
  });

  it('should emit only transcript contract fields with final whisper results', function(done) {
    const engine = new WhisperStreamSpeechEngine({});

    engine.on('event', payload => {
      if (payload.event !== 'result') {
        return;
      }

      assert.equal(payload.text, 'open chrome');
      assert.equal(payload.isFinal, true);
      assert.equal(payload.mode, 'conversation');
      assert.equal(payload.backend, 'whisper-stream');
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'confidence'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'noSpeechProbability'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload, 'compressionRatio'), false);
      done();
    });

    engine.activeSession = {
      mode: 'conversation',
      startSpeechTimeoutMs: 20000,
      chunks: ['open chrome'],
      finalized: false,
      finalTimer: null,
      inactivityTimer: null
    };
    engine._finalizeSession('final-transcript');
    assert.equal(engine.state, 'IDLE');
  });

  it('should return an empty transcript instead of classifying no speech', function(done) {
    const engine = new WhisperStreamSpeechEngine({});

    engine.on('event', payload => {
      if (payload.event !== 'result') {
        return;
      }

      assert.deepEqual({
        event: payload.event,
        text: payload.text,
        isFinal: payload.isFinal
      }, {
        event: 'result',
        text: '',
        isFinal: true
      });
      done();
    });

    engine.activeSession = {
      mode: 'conversation',
      startSpeechTimeoutMs: 20000,
      chunks: [],
      finalized: false,
      finalTimer: null,
      inactivityTimer: null
    };
    engine._finalizeSession('session-timeout');
  });
});
