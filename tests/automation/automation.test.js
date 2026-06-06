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
