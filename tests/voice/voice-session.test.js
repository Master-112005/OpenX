const assert = require('assert');

describe('Voice Session Manager', function() {
  let VoiceSessionManager;

  before(function() {
    VoiceSessionManager = require('../../core/voice/session').VoiceSessionManager;
  });

  it('should start, transition, and stop a deterministic session', function() {
    const manager = new VoiceSessionManager({ now: () => 123 });
    const states = [];
    let started = null;
    let ended = null;

    manager.on('stateChanged', payload => states.push(payload.state));
    manager.on('sessionStarted', payload => {
      started = payload;
    });
    manager.on('sessionEnded', payload => {
      ended = payload;
    });

    assert.equal(manager.start({ mode: 'conversation' }), true);
    manager.markProcessing();
    manager.markResponding();
    manager.stop('done');

    assert.equal(started.sessionId, 'voice-123');
    assert.equal(started.mode, 'conversation');
    assert.equal(ended.reason, 'done');
    assert.deepEqual(states, ['LISTENING', 'PROCESSING', 'RESPONDING', 'IDLE']);
  });

  it('should extend the inactivity timeout when activity is observed', function(done) {
    const manager = new VoiceSessionManager({ now: () => 123 });
    let timeoutCount = 0;

    manager.on('timeout', () => {
      timeoutCount += 1;
    });

    assert.equal(manager.start({ mode: 'conversation', inactivityTimeoutMs: 20 }), true);
    setTimeout(() => {
      assert.equal(manager.touch(), true);
    }, 10);
    setTimeout(() => {
      assert.equal(timeoutCount, 0);
    }, 25);
    setTimeout(() => {
      assert.equal(timeoutCount, 1);
      done();
    }, 45);
  });
});
