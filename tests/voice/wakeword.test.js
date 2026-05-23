const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

describe('Wake-word worker matcher', function() {
  this.timeout(10000);

  const workerPath = path.join(__dirname, '..', '..', 'core', 'voice', 'wakeword', 'whisper_wakeword_worker.py');

  function runSelftest(wakeWord, transcripts, aliases = []) {
    const args = [
      workerPath,
      '--wake-word', wakeWord
    ];

    const items = Array.isArray(transcripts) ? transcripts : [transcripts];
    for (const transcript of items) {
      args.push('--selftest-transcript', transcript);
    }

    for (const alias of aliases) {
      args.push('--wake-alias', alias);
    }

    const result = spawnSync('python', args, {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const lines = String(result.stdout || '')
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assert.ok(lines.length > 0, 'Expected selftest output');
    return JSON.parse(lines[lines.length - 1]);
  }

  it('should match an exact wake word with a command', function() {
    const output = runSelftest('jarvis', 'hey jarvis open chrome');
    assert.equal(output.matched, true);
    assert.equal(output.command, 'jarvis open chrome');
  });

  it('should match compacted wake-word syllables', function() {
    const output = runSelftest('nova', 'hey no va open downloads');
    assert.equal(output.matched, true);
    assert.equal(output.command, 'nova open downloads');
  });

  it('should accept a close transcription variant for the wake word', function() {
    const output = runSelftest('nova', 'hello nora play music');
    assert.equal(output.matched, true);
    assert.equal(output.command, 'nova play music');
  });

  it('should activate without forcing an inline command when the wake word arrives alone', function() {
    const output = runSelftest('nova', ['noah', 'open chrome']);
    assert.equal(output.matched, true);
    assert.equal(output.command, 'nova');
  });

  it('should not treat non-command follow-up speech as an inline command', function() {
    const output = runSelftest('nova', ['no', 'no one thought']);
    assert.equal(output.matched, false);
    assert.equal(output.command, '');
  });
});
