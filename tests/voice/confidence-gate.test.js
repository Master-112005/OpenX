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
    assert.equal(gate.assess('background noise', 0.4).action, 'ignore');
    assert.equal(gate.assess('open chrome', 0.4).action, 'execute');
  });

  it('should require confirmation for dangerous commands', function() {
    const gate = new VoiceConfidenceGate();

    assert.equal(gate.assess('shutdown computer', 0.99).action, 'confirm');
    assert.equal(gate.assess('delete file report', 0.99).reason, 'dangerous-action');
  });

  it('should reject high-confidence hallucination phrases', function() {
    const gate = new VoiceConfidenceGate();
    const result = gate.assess('thanks for watching', 0.99, {
      noSpeechProbability: 0.2
    });

    assert.equal(result.action, 'ignore');
    assert.equal(result.turn.signals.knownHallucination, true);
  });

  it('should reject commands when speaker verification reports a mismatch', function() {
    const gate = new VoiceConfidenceGate();
    const result = gate.assess('open chrome', 0.95, {
      speaker: { verified: false, score: 0.2 }
    });

    assert.equal(result.action, 'ignore');
    assert.equal(result.reason, 'speakerMismatch');
  });
});
