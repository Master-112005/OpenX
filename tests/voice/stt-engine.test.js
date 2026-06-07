const assert = require('assert');

describe('Node Windows SAPI STT Engine', function() {
  let WindowsSapiSpeechEngine;

  before(function() {
    WindowsSapiSpeechEngine = require('../../core/voice/stt/windows-sapi');
  });

  it('should initialize without a Python worker', async function() {
    const engine = new WindowsSapiSpeechEngine({});
    let ready = null;

    engine.on('ready', (payload) => {
      ready = payload;
    });

    await engine.initialize();

    assert.equal(engine.ready, true);
    assert.equal(ready.backend, 'windows-sapi');
    engine.shutdown();
  });

  it('should parse the last JSON recognition payload', function() {
    const engine = new WindowsSapiSpeechEngine({});
    const payload = engine._parseRecognitionOutput([
      'noise',
      '{"event":"result","text":"open chrome","confidence":0.7}'
    ].join('\n'), 'conversation', 20000);

    assert.equal(payload.event, 'result');
    assert.equal(payload.text, 'open chrome');
  });

  it('should fall back to a clean timeout payload when recognition emits no result', function() {
    const engine = new WindowsSapiSpeechEngine({});
    const payload = engine._parseRecognitionOutput('', 'conversation', 20000);

    assert.equal(payload.event, 'session_timeout');
    assert.equal(payload.mode, 'conversation');
    assert.equal(payload.reason, 'no-speech-detected');
  });

  it('should build a command grammar containing common assistant commands', function() {
    const engine = new WindowsSapiSpeechEngine({});
    const phrases = engine._buildCommandPhrases();
    const script = engine._buildRecognitionScript(20000, 'conversation');

    assert.ok(phrases.includes('open chrome'));
    assert.ok(phrases.includes('open youtube'));
    assert.ok(phrases.includes('open the youtube'));
    assert.ok(phrases.includes('open you tube'));
    assert.ok(phrases.includes('please open youtube'));
    assert.ok(phrases.includes('can you open youtube'));
    assert.ok(phrases.includes('open up youtube'));
    assert.ok(phrases.includes('search for chatgpt in chrome'));
    assert.ok(phrases.includes('open first result for chatgpt'));
    assert.ok(phrases.includes('play liked songs'));
    assert.ok(script.includes('OpenX Commands'));
    assert.ok(script.includes('Alternates'));
  });

  it('should write recognition scripts to a temp file to avoid Windows command length limits', function() {
    const engine = new WindowsSapiSpeechEngine({});
    const scriptPath = engine._writeRecognitionScriptFile(20000, 'conversation');

    assert.ok(scriptPath.endsWith('.ps1'));
    assert.ok(require('fs').existsSync(scriptPath));
    engine._deleteTempScript(scriptPath);
    assert.equal(require('fs').existsSync(scriptPath), false);
  });
});
