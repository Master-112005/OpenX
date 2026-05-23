const assert = require('assert');

describe('Response Generator', function() {
  let ResponseGenerator;

  before(function() {
    ResponseGenerator = require('../../core/assistant/responses/index');
  });

  it('should generate success response with interpolation', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'volume.set', { entities: { value: 70 } });
    assert.ok(result.includes('70'));
    assert.ok(result.toLowerCase().includes('volume'));
    assert.ok(result.toLowerCase().includes('sir'));
  });

  it('should generate error response for unknown command', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('error', 'unknownCommand');
    assert.ok(result.length > 0);
  });

  it('should generate confirmation response', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('confirmation', 'confirmAction', { action: 'Delete file' });
    assert.ok(result.toLowerCase().includes('confirm'));
  });

  it('should handle unknown template with fallback', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'nonexistent.template');
    assert.ok(result.length > 0);
  });

  it('should allow adding custom templates', function() {
    const gen = new ResponseGenerator();
    gen.addTemplate('success', 'custom.test', 'Custom response: {value}');
    const result = gen.generate('success', 'custom.test', { entities: { value: 'hello' } });
    assert.equal(result, 'Custom response: hello, sir.');
  });

  it('should humanize common execution errors', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('error', 'executionFailed', { error: 'File not found' });
    assert.ok(result.toLowerCase().includes('unable to find'));
  });

  it('should use formal addressing by default', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('info', 'idle');
    assert.equal(result, 'Awaiting your next command, sir.');
  });

  it('should support a configured honorific', function() {
    const gen = new ResponseGenerator({ assistant: { honorific: 'master' } });
    const result = gen.generate('success', 'app.open', { entities: { appName: 'chrome' } });
    assert.ok(result.toLowerCase().includes('master'));
  });

  it('should mention the matched window in window responses', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'window.minimize', {
      result: { data: { matchedWindow: 'YouTube' } }
    });
    assert.ok(result.includes('YouTube'));
  });
});
