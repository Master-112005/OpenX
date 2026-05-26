const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

describe('Audio worker activation mode', function() {
  this.timeout(10000);

  const workerPath = path.join(__dirname, '..', '..', 'core', 'voice', 'engine', 'audio_engine.py');

  function runSelftest(args = []) {
    const result = spawnSync('python', [workerPath, ...args], {
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

  it('should not match spoken wake phrases in hotkey mode', function() {
    const output = runSelftest([
      '--activation-mode', 'hotkey',
      '--selftest-transcript', 'hey jarvis open chrome'
    ]);

    assert.equal(output.matched, false);
    assert.equal(output.command, '');
  });

  it('should keep the old matcher gated behind wakeword mode only', function() {
    const output = runSelftest([
      '--activation-mode', 'wakeword',
      '--wake-word', 'nova',
      '--selftest-transcript', 'hello nora play music'
    ]);

    assert.equal(output.matched, true);
    assert.equal(output.command, 'nova play music');
  });
});
