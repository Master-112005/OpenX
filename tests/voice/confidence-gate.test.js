const assert = require('assert');

describe('Voice Confidence Gate', function() {
  let VoiceConfidenceGate;

  before(function() {
    VoiceConfidenceGate = require('../../core/voice/confidence');
  });

  it('should classify high, medium, and low confidence transcripts', function() {
    const gate = new VoiceConfidenceGate();

    assert.equal(gate.assess('open chrome', 0.9).action, 'execute');
    assert.equal(gate.assess('open chrome', 0.7).action, 'confirm');
    assert.equal(gate.assess('open chrome', 0.4).action, 'ignore');
  });

  it('should require confirmation for dangerous commands', function() {
    const gate = new VoiceConfidenceGate();

    assert.equal(gate.assess('shutdown computer', 0.99).action, 'confirm');
    assert.equal(gate.assess('delete file report', 0.99).reason, 'dangerous-action');
  });
});
