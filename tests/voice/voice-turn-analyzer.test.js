const assert = require('assert');

describe('Voice Turn Analyzer', function() {
  let VoiceTurnAnalyzer;

  before(function() {
    VoiceTurnAnalyzer = require('../../core/voice/pipeline/voice-turn-analyzer');
  });

  it('should execute clear actionable commands', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'open chrome',
      confidence: 0.82,
      noSpeechProbability: 0.1
    });

    assert.equal(turn.accepted, true);
    assert.equal(turn.decision, 'execute');
    assert.equal(turn.signals.commandLike, true);
  });

  it('should reject known no-speech hallucinations even with high confidence', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'thanks for watching',
      confidence: 0.96,
      noSpeechProbability: 0.2
    });

    assert.equal(turn.accepted, false);
    assert.equal(turn.decision, 'ignore');
    assert.equal(turn.signals.knownHallucination, true);
  });

  it('should accept short assistant-directed greetings after activation', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'hello',
      confidence: 0.7,
      noSpeechProbability: 0.62,
      mode: 'conversation'
    });

    assert.equal(turn.accepted, true);
    assert.equal(turn.signals.conversational, true);
  });

  it('should reject explicit blank audio markers', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'blank_audio',
      confidence: 0.7,
      noSpeechProbability: 0.9,
      mode: 'conversation'
    });

    assert.equal(turn.accepted, false);
    assert.equal(turn.signals.knownHallucination, true);
  });

  it('should require confirmation for destructive actions', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'delete the newest screenshot',
      confidence: 0.95
    });

    assert.equal(turn.accepted, true);
    assert.equal(turn.decision, 'confirm');
    assert.equal(turn.signals.destructive, true);
  });

  it('should block commands from a mismatched speaker', function() {
    const analyzer = new VoiceTurnAnalyzer();
    const turn = analyzer.analyze({
      text: 'open chrome',
      confidence: 0.95,
      speaker: { verified: false, score: 0.2 }
    });

    assert.equal(turn.accepted, false);
    assert.equal(turn.decision, 'ignore');
    assert.equal(turn.speaker.status, 'mismatch');
  });
});
