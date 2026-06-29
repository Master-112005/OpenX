const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CrashRecoveryPolicy = require('../../apps/desktop/electron/crash-recovery');

describe('Crash Recovery Policy', function() {
  let directory;
  let statePath;

  beforeEach(function() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-recovery-'));
    statePath = path.join(directory, 'crash-recovery.json');
  });

  afterEach(function() {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should allow only a bounded number of restarts inside the crash window', function() {
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 3, windowMs: 1000 });

    assert.equal(policy.requestRestart(1000), true);
    assert.equal(policy.requestRestart(1100), true);
    assert.equal(policy.requestRestart(1200), true);
    assert.equal(policy.requestRestart(1300), false);
  });

  it('should permit recovery after the crash window expires', function() {
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 2, windowMs: 100 });

    assert.equal(policy.requestRestart(1000), true);
    assert.equal(policy.requestRestart(1050), true);
    assert.equal(policy.requestRestart(1200), true);
  });

  it('should reset crash history after a stable runtime', function() {
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 1, windowMs: 1000 });

    assert.equal(policy.requestRestart(1000), true);
    assert.equal(policy.requestRestart(1100), false);
    policy.markStable(1200);
    assert.equal(policy.requestRestart(1300), true);
  });

  it('should recover safely from corrupt state data', function() {
    fs.writeFileSync(statePath, '{bad json', 'utf8');
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 1, windowMs: 1000 });

    assert.equal(policy.requestRestart(1000), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).crashTimestamps, [1000]);
  });

  it('should ignore future timestamps when reading restart history', function() {
    fs.writeFileSync(statePath, JSON.stringify({ crashTimestamps: [1000, 5000] }), 'utf8');
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 2, windowMs: 1000 });

    assert.equal(policy.requestRestart(1100), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')).crashTimestamps, [1000, 1100]);
  });

  it('should expose bounded recovery state for diagnostics', function() {
    const policy = new CrashRecoveryPolicy({ statePath, maxRestarts: 2, windowMs: 1000 });

    assert.equal(policy.requestRestart(1000), true);
    assert.deepEqual(policy.getState(1100), {
      blocked: false,
      crashTimestamps: [1000],
      remainingRestarts: 1
    });
  });
});
