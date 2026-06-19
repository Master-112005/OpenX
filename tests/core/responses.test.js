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

  it('should humanize verification failures', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('error', 'executionFailed', {
      error: 'Expected file was not found'
    });

    assert.ok(result.toLowerCase().includes('could not verify'));
    assert.ok(result.toLowerCase().includes('file'));
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

  it('should describe site-specific browser searches', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'browser.siteSearch', {
      entities: { site: 'google photos', query: 'classmates' }
    });

    assert.ok(result.includes('google photos'));
    assert.ok(result.includes('classmates'));
  });

  it('should summarize visible browser tabs', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'browser.listTabs', {
      result: {
        data: {
          browserName: 'chrome',
          count: 2,
          tabs: [{ title: 'ChatGPT' }, { title: 'Google Photos' }]
        }
      }
    });

    assert.ok(result.includes('2 visible chrome tabs'));
    assert.ok(result.includes('ChatGPT'));
    assert.ok(result.includes('Google Photos'));
  });

  it('should describe email draft preparation and missing details', function() {
    const gen = new ResponseGenerator();
    const needsDetails = gen.generate('success', 'email.compose', {
      result: {
        data: {
          contactName: 'rakesh',
          email: 'rakesh@example.com',
          needsDetails: true
        }
      }
    });
    const draft = gen.generate('success', 'email.compose', {
      result: {
        data: {
          contactName: 'rakesh',
          email: 'rakesh@example.com',
          subject: 'Project update'
        }
      }
    });

    assert.ok(needsDetails.includes('rakesh@example.com'));
    assert.ok(needsDetails.includes('subject and message'));
    assert.ok(draft.includes('Project update'));
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

  it('should confirm verified media playback without asking for feedback', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'media.play', {
      result: {
        data: {
          query: 'playdate song',
          platform: 'youtube',
          appName: 'YouTube',
          launchMethod: 'existing-window',
          replacedExisting: true,
          playbackVerification: {
            valid: true,
            requestedQuery: 'playdate song',
            requestedPlatform: 'youtube'
          }
        }
      }
    });

    assert.equal(result, 'Verified YouTube was switched to "playdate song", sir.');
  });

  it('should confirm verified managed media launches', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'media.play', {
      result: {
        data: {
          query: 'playdate song',
          platform: 'youtube',
          appName: 'YouTube',
          launchMethod: 'chrome-pwa',
          replacedExisting: true,
          playbackVerification: {
            valid: true,
            requestedQuery: 'playdate song',
            requestedPlatform: 'youtube',
            launchMethod: 'chrome-pwa'
          }
        }
      }
    });

    assert.equal(
      result,
      'Verified YouTube was opened for "playdate song" after stopping the previous playback, sir.'
    );
  });

  it('should use formal addressing by default', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('info', 'idle');
    assert.equal(result, 'Ready when you are, sir.');
  });

  it('should vary short conversational greetings', function() {
    const gen = new ResponseGenerator();
    const hello = gen.generate('success', 'greeting', {
      entities: { greetingType: 'hello' },
      input: 'hello'
    });
    const hi = gen.generate('success', 'greeting', {
      entities: { greetingType: 'hi' },
      input: 'hi'
    });
    const hey = gen.generate('success', 'greeting', {
      entities: { greetingType: 'hey' },
      input: 'hey'
    });

    assert.notEqual(hello, hi);
    assert.notEqual(hi, hey);
    assert.notEqual(hello, hey);
  });

  it('should support a configured honorific', function() {
    const gen = new ResponseGenerator({ assistant: { honorific: 'master' } });
    const result = gen.generate('success', 'app.open', { entities: { appName: 'chrome' } });
    assert.ok(result.toLowerCase().includes('master'));
  });

  it('should explain when an existing app window was focused', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'app.open', {
      entities: { appName: 'chrome' },
      result: {
        data: {
          launchMethod: 'focus-existing',
          matchedWindow: 'Google Chrome'
        }
      }
    });

    assert.match(result, /Google Chrome was already open/);
    assert.match(result, /foreground/);
  });

  it('should mention the matched window in window responses', function() {
    const gen = new ResponseGenerator();
    const result = gen.generate('success', 'window.minimize', {
      result: { data: { matchedWindow: 'YouTube' } }
    });
    assert.ok(result.includes('YouTube'));
  });
});
