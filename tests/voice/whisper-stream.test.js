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
    assert.equal(args[args.indexOf('-t') + 1], '4');
    assert.equal(args[args.indexOf('--vad-thold') + 1], '0.7');
    assert.equal(args[args.indexOf('--freq-thold') + 1], '120');
  });

  it('should disable context carry by default to avoid repeated transcript prefixes', function() {
    const engine = new WhisperStreamSpeechEngine({});

    engine.executablePath = 'bin/whisper/whisper-stream.exe';
    engine.modelPath = 'models/whisper/ggml-small.en.bin';

    assert.equal(engine._buildArgs().includes('--keep-context'), false);
  });

  it('should parse transcript lines and ignore whisper diagnostics', function() {
    const engine = new WhisperStreamSpeechEngine({});

    assert.equal(engine._parseTranscriptLine('[00:00:00.000] Open Chrome.'), 'open chrome');
    assert.equal(engine._parseTranscriptLine('2k 2k aye. open chrome'), 'open chrome');
    assert.equal(engine._parseTranscriptLine('whisper_init_from_file: loading model'), '');
    assert.equal(engine._parseTranscriptLine('{"text":"Search ChatGPT"}'), 'search chatgpt');
    assert.equal(engine._parseTranscriptLine('{"text":"blank_audio"}'), '');
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
    engine.shutdown();
  });

  it('should estimate lower confidence for common no-speech hallucinations', function() {
    const engine = new WhisperStreamSpeechEngine({});
    const quality = engine._estimateTranscriptQuality('thanks for watching', {
      chunks: ['thanks for watching', 'thanks for watching']
    });

    assert.equal(quality.confidence < 0.6, true);
    assert.equal(quality.noSpeechProbability >= 0.9, true);
  });

  it('should not mark short conversational greetings as no-speech', function() {
    const engine = new WhisperStreamSpeechEngine({});
    const quality = engine._estimateTranscriptQuality('hello', {
      chunks: ['hello']
    });

    assert.equal(quality.confidence >= 0.85, true);
    assert.equal(quality.noSpeechProbability < 0.55, true);
  });

  it('should emit transcript quality metadata with final whisper results', function(done) {
    const engine = new WhisperStreamSpeechEngine({});

    engine.on('event', payload => {
      if (payload.event !== 'result') {
        return;
      }

      assert.equal(payload.text, 'open chrome');
      assert.equal(Number.isFinite(payload.confidence), true);
      assert.equal(Number.isFinite(payload.noSpeechProbability), true);
      assert.equal(Number.isFinite(payload.compressionRatio), true);
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
  });
});
