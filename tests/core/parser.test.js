const assert = require('assert');

describe('Input Parser', function() {
  let InputParser;

  before(function() {
    InputParser = require('../../core/assistant/parser/index');
  });

  it('should parse a simple command', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('open chrome');
    assert.ok(result.hasCommand);
    assert.equal(result.normalized, 'open chrome');
    assert.equal(result.raw, 'open chrome');
  });

  it('should detect wake word prefix', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('jarvis open chrome');
    assert.ok(result.wakeWordDetected);
    assert.equal(result.commandText, 'open chrome');
  });

  it('should preserve raw command text for entity extraction', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('jarvis create file report.pdf on desktop');
    assert.equal(result.commandText, 'create file report pdf on desktop');
    assert.equal(result.rawCommandText, 'create file report.pdf on desktop');
  });

  it('should handle empty input', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('');
    assert.equal(result.hasCommand, false);
    assert.equal(result.normalized, '');
  });

  it('should handle null input', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse(null);
    assert.equal(result.hasCommand, false);
  });

  it('should normalize input text', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('  OPEN  CHROME  ');
    assert.equal(result.normalized, 'open chrome');
  });

  it('should detect activation-only command', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    assert.ok(parser.isActivation('jarvis'));
    assert.ok(parser.isActivation('hey jarvis'));
    assert.ok(!parser.isActivation('jarvis open chrome'));
  });

  it('should strip polite lead in phrases from commands', function() {
    const parser = new InputParser({ voice: { wakeWord: 'jarvis' } });
    const result = parser.parse('Jarvis, could you please open chrome');
    assert.equal(result.commandText, 'open chrome');
    assert.equal(result.rawCommandText, 'open chrome');
  });
});
