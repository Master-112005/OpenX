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

  it('should humanize missing app errors', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('error', 'executionFailed', { error: 'Could not find app: java' });
    assert.ok(result.toLowerCase().includes('cannot find the java app'));
  });

  it('should speak local time and date answers', function() {
    const gen = new ResponseGenerator();
    const time = gen.generate('success', 'system.time', { result: { data: { time: '2:45 PM' } } });
    const date = gen.generate('success', 'system.date', { result: { data: { date: 'Saturday, June 6, 2026' } } });

    assert.ok(time.includes('2:45 PM'));
    assert.ok(date.includes('Saturday, June 6, 2026'));
  });

  it('should speak calculation answers', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'system.calculate', { result: { data: { result: 600 } } });

    assert.ok(result.includes('600'));
  });

  it('should summarize background web search results', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'browser.search', {
      entities: { query: 'apple wwdc' },
      result: {
        data: {
          query: 'apple wwdc',
          results: [{ snippet: 'WWDC starts on Monday.' }]
        }
      }
    });

    assert.ok(result.includes('WWDC starts on Monday'));
    assert.ok(!result.toLowerCase().includes('in your browser'));
  });

  it('should prefer extracted search answers over generic snippets', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'browser.search', {
      entities: { query: 'who won the ipl 2026' },
      result: {
        data: {
          query: 'who won the ipl 2026',
          answer: { text: 'Royal Challengers Bengaluru won IPL 2026.' },
          results: [{ snippet: 'Full list of Indian Premier League winners.' }]
        }
      }
    });

    assert.ok(result.includes('Royal Challengers Bengaluru won IPL 2026'));
    assert.ok(!result.includes('Full list'));
  });

  it('should summarize local file listings', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'file.list', {
      result: {
        data: {
          path: 'C:\\Users\\rakes\\Desktop',
          count: 2,
          entries: [
            { name: 'Projects', type: 'folder' },
            { name: 'notes.txt', type: 'file' }
          ]
        }
      }
    });

    assert.ok(result.includes('Projects'));
    assert.ok(result.includes('notes.txt'));
  });

  it('should describe visible apps separately from raw process counts', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'system.processes', {
      result: {
        data: {
          target: 'apps',
          count: 2,
          names: ['chrome', 'spotify']
        }
      }
    });

    assert.ok(result.includes('2 visible apps'));
    assert.ok(result.includes('chrome'));
    assert.ok(result.includes('spotify'));
    assert.ok(!result.toLowerCase().includes('active processes'));
  });

  it('should answer direct visible app status questions', function() {
    const gen = new ResponseGenerator();
    const open = gen.generate('success', 'system.processes', {
      result: { data: { target: 'apps', queryApp: 'chrome', isOpen: true } }
    });
    const closed = gen.generate('success', 'system.processes', {
      result: { data: { target: 'apps', queryApp: 'instagram', isOpen: false } }
    });

    assert.ok(open.includes('chrome is open'));
    assert.ok(closed.includes('do not see instagram open'));
  });

  it('should report failed configured mode commands', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'mode.start', {
      result: {
        data: {
          modeName: 'development',
          opened: ['youtube', 'chrome'],
          failed: [],
          commandSteps: [
            { input: 'play liked songs', success: true },
            { input: 'open chatgpt', success: false }
          ]
        }
      }
    });

    assert.ok(result.includes('Ran 1 configured command'));
    assert.ok(result.includes('Failed command: open chatgpt'));
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
