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
    const startedAt = Date.now();
    let timeoutCount = 0;
    let finished = false;

    const finish = (error) => {
      if (finished) {
        return;
      }
      finished = true;
      manager.stop('test-finished');
      done(error);
    };

    manager.on('timeout', () => {
      timeoutCount += 1;
      try {
        assert.equal(timeoutCount, 1);
        assert.equal(Date.now() - startedAt >= 80, true);
        finish();
      } catch (error) {
        finish(error);
      }
    });

    assert.equal(manager.start({ mode: 'conversation', inactivityTimeoutMs: 80 }), true);
    setTimeout(() => {
      try {
        assert.equal(manager.touch(), true);
      } catch (error) {
        finish(error);
      }
    }, 35);
    setTimeout(() => {
      try {
        assert.equal(timeoutCount, 0);
      } catch (error) {
        finish(error);
      }
    }, 75);
    setTimeout(() => {
      if (timeoutCount !== 1) {
        finish(new Error('Expected inactivity timeout after touch extension'));
      }
    }, 180);
  });
});
