const assert = require('assert');

describe('Intent Registry', function() {
  let IntentRegistry;

  before(function() {
    IntentRegistry = require('../../core/assistant/intents').IntentRegistry;
  });

  it('should initialize with all intents', function() {
    const registry = new IntentRegistry();
    const all = registry.getAll();
    assert.ok(all.length > 20, `Expected at least 20 intents, got ${all.length}`);
  });

  it('should return a specific intent by id', function() {
    const registry = new IntentRegistry();
    const intent = registry.get('volume.up');
    assert.ok(intent);
    assert.equal(intent.id, 'volume.up');
    assert.equal(intent.permissionLevel, 'low');
    assert.equal(intent.action, 'volume.up');
  });

  it('should return null for unknown intent', function() {
    const registry = new IntentRegistry();
    const intent = registry.get('nonexistent.intent');
    assert.strictEqual(intent, null);
  });

  it('should allow registering custom intents', function() {
    const registry = new IntentRegistry();
    const customIntent = {
      id: 'test.custom',
      patterns: ['test custom', 'custom test'],
      permissionLevel: 'low',
      action: 'test.custom',
      entities: [],
      description: 'Test custom intent'
    };
    registry.registerCustom(customIntent);
    const retrieved = registry.get('test.custom');
    assert.ok(retrieved);
    assert.equal(retrieved.id, 'test.custom');
  });

  it('should allow unregistering intents', function() {
    const registry = new IntentRegistry();
    registry.unregister('volume.mute');
    const intent = registry.get('volume.mute');
    assert.strictEqual(intent, null);
  });
});
