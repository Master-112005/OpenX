const assert = require('assert');

describe('Automation Engine', function() {
  let AutomationEngine;

  before(function() {
    AutomationEngine = require('../../core/automation/index');
  });

  it('should register all default actions', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('volume.set'));
    assert.ok(actions.includes('app.open'));
    assert.ok(actions.includes('mode.start'));
    assert.ok(actions.includes('file.create'));
    assert.ok(actions.includes('file.open'));
    assert.ok(actions.includes('file.list'));
    assert.ok(actions.includes('folder.create'));
    assert.ok(actions.includes('folder.move'));
    assert.ok(actions.includes('browser.open'));
    assert.ok(actions.includes('browser.search'));
    assert.ok(actions.includes('message.compose'));
    assert.ok(actions.includes('call.start'));
    assert.ok(actions.includes('timer.set'));
    assert.ok(actions.includes('alarm.set'));
    assert.ok(actions.includes('reminder.set'));
    assert.ok(actions.includes('system.status'));
    assert.ok(actions.includes('system.time'));
    assert.ok(actions.includes('system.date'));
    assert.ok(actions.includes('system.calculate'));
    assert.ok(actions.includes('system.screenshot'));
    assert.ok(actions.includes('system.shutdown'));
    assert.ok(actions.includes('window.minimize'));
    assert.ok(actions.includes('help'));
    assert.ok(actions.includes('greeting'));
    assert.ok(actions.includes('thanks'));
  });

  it('should allow registering custom actions', async function() {
    const engine = new AutomationEngine({});
    engine.registerAction('test.action', () => ({ success: true, data: { value: 42 } }));
    const result = await engine.execute('test.action', {});
    assert.ok(result.success);
    assert.equal(result.data.value, 42);
  });

  it('should return error for unknown action', async function() {
    const engine = new AutomationEngine({});
    const result = await engine.execute('nonexistent.action', {});
    assert.equal(result.success, false);
  });

  it('should start configured app modes', async function() {
    const engine = new AutomationEngine({
      modes: [
        {
          name: 'gaming',
          apps: [
            { name: 'chrome', instructions: ['search for chatgpt'] },
            { name: 'discord', instructions: [] }
          ],
          commands: ['set volume to 45']
        }
      ]
    });
    const opened = [];
    engine.apps.open = async (appName) => {
      opened.push(appName);
      return { success: true, data: { appName } };
    };

    const result = await engine.execute('mode.start', { modeName: 'gaming' });

    assert.equal(result.success, true);
    assert.deepEqual(opened, ['chrome', 'discord']);
    assert.deepEqual(result.data.opened, ['chrome', 'discord']);
    assert.deepEqual(result.data.commands, ['search for chatgpt in chrome', 'set volume to 45']);
  });

  it('should run separate app instructions for a saved mode', async function() {
    const engine = new AutomationEngine({
      modes: [
        {
          name: 'development',
          apps: [
            { name: 'youtube', instructions: ['set volume to 100', 'play liked songs'] },
            { name: 'chrome', instructions: ['open chatgpt'] },
            { name: 'terminal', instructions: [] }
          ]
        }
      ]
    });
    const opened = [];
    engine.apps.open = async (appName) => {
      opened.push(appName);
      return { success: true, data: { appName } };
    };

    const result = await engine.execute('mode.start', { modeName: 'development' });

    assert.equal(result.success, true);
    assert.deepEqual(opened, ['youtube', 'chrome', 'terminal']);
    assert.deepEqual(result.data.commands, [
      'set volume to 100',
      'play liked songs',
      'search for chatgpt in chrome',
      'open first result for chatgpt'
    ]);
  });

  it('should match heavily misspelled development mode names', async function() {
    const engine = new AutomationEngine({
      modes: [
        { name: 'developement', apps: [], commands: ['set volume to 50'] }
      ]
    });

    const result = await engine.execute('mode.start', { modeName: 'deveopemt' });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.commands, ['set volume to 50']);
  });

  it('should allow command-only modes', async function() {
    const engine = new AutomationEngine({
      modes: [
        { name: 'media', apps: [], commands: ['play liked songs'] }
      ]
    });
    const result = await engine.execute('mode.start', { modeName: 'media' });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.opened, []);
    assert.deepEqual(result.data.commands, ['play liked songs']);
  });

  it('should fail clearly when a configured mode is missing', async function() {
    const engine = new AutomationEngine({ modes: [] });
    const result = await engine.execute('mode.start', { modeName: 'gaming' });

    assert.equal(result.success, false);
    assert.match(result.error, /Mode not found/);
  });

  it('should route volume actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('volume.set'));
    assert.ok(actions.includes('volume.mute'));
    assert.ok(actions.includes('volume.unmute'));
  });

  it('should route system actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('system.cpu'));
    assert.ok(actions.includes('system.memory'));
    assert.ok(actions.includes('system.battery'));
    assert.ok(actions.includes('system.disk'));
    assert.ok(actions.includes('system.processes'));
    assert.ok(actions.includes('system.time'));
    assert.ok(actions.includes('system.date'));
    assert.ok(actions.includes('system.calculate'));
  });

  it('should execute local calculations', async function() {
    const engine = new AutomationEngine({});
    const result = await engine.execute('system.calculate', { expression: '20*30 + 5' });

    assert.equal(result.success, true);
    assert.equal(result.data.result, 605);
  });

  it('should execute expanded local calculation forms', async function() {
    const engine = new AutomationEngine({});
    const cases = [
      ['ehat is teh value of 999+959*9', 9630],
      ['2 to the power of 8', 256],
      ['square root of 144', 12],
      ['25% of 200', 50],
      ['30 percent of 20', 6],
      ['1,000 + 2.5', 1002.5],
      ['absolute value of -15', 15]
    ];

    for (const [expression, expected] of cases) {
      const result = await engine.execute('system.calculate', { expression });
      assert.equal(result.success, true, expression);
      assert.equal(result.data.result, expected, expression);
    }
  });

  it('should parse human reminder day phrases', function() {
    const SchedulerController = require('../../core/automation/scheduler/index');
    const scheduler = new SchedulerController({});

    const tomorrow = scheduler._parseTimeExpression('tomorrow 10pm');
    const nextSunday = scheduler._parseTimeExpression('next sunday');

    assert.ok(tomorrow instanceof Date);
    assert.ok(nextSunday instanceof Date);
    assert.ok(tomorrow.getTime() > Date.now());
    assert.ok(nextSunday.getTime() > Date.now());
  });

  it('should route media actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('media.play'));
    assert.ok(actions.includes('media.next'));
    assert.ok(actions.includes('media.previous'));
    assert.ok(actions.includes('media.pause'));
    assert.ok(actions.includes('media.resume'));
  });
});
