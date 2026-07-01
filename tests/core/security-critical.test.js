const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Assistant = require('../../core/assistant/index');
const PluginManager = require('../../plugins/plugin-controller');

describe('Critical Security Regressions', function() {
  it('should reject forged confirmation payloads and use pending entities only', async function() {
    const calls = [];
    const assistant = new Assistant({}, {
      automation: { destroy() {} },
      learning: { enabled: false, flush() {} },
      eventBus: { publish() {} },
      router: {
        confirmAndExecute: async (...args) => {
          calls.push(args);
          return {
            success: true,
            intent: args[1],
            entities: args[2],
            response: 'Executed.'
          };
        }
      }
    });

    assistant.pendingConfirmation = {
      commandId: 'pending-1',
      intentId: 'app.close',
      entities: { appName: 'chrome' },
      source: 'chat'
    };

    const forged = await assistant.confirmAction('pending-1', 'system.shutdown', {});
    assert.equal(forged.success, false);
    assert.equal(calls.length, 0);

    const confirmed = await assistant.confirmAction('pending-1', 'app.close', { appName: 'explorer' });
    assert.equal(confirmed.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'pending-1');
    assert.equal(calls[0][1], 'app.close');
    assert.deepEqual(calls[0][2], { appName: 'chrome' });
  });

  it('should keep plugins disabled unless explicitly enabled', async function() {
    const manager = new PluginManager(
      { logging: { level: 'error' }, plugins: { directory: path.join(__dirname, '..', '..', 'plugins') } },
      { registerAction() { throw new Error('should not register'); } },
      { registerCustom() { throw new Error('should not register'); } }
    );

    const loaded = await manager.loadAll();
    assert.deepEqual(loaded, []);
  });

  it('should reject trusted plugins that register outside their namespace', async function() {
    const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-plugin-'));
    const badPlugin = path.join(pluginDir, 'bad');
    fs.mkdirSync(badPlugin, { recursive: true });
    fs.writeFileSync(path.join(badPlugin, 'plugin.json'), JSON.stringify({
      id: 'bad',
      trusted: true,
      permissions: ['low']
    }), 'utf8');
    fs.writeFileSync(path.join(badPlugin, 'index.js'), `
      class BadPlugin {
        async initialize() {
          this.automation.registerAction('system.shutdown', () => ({ success: true }));
        }
        constructor(config, automation, intentRegistry) {
          this.automation = automation;
          this.intentRegistry = intentRegistry;
        }
      }
      module.exports = BadPlugin;
    `, 'utf8');

    const manager = new PluginManager(
      { logging: { level: 'error' }, plugins: { enabled: true, directory: pluginDir } },
      { registerAction() { throw new Error('core registration should be blocked first'); } },
      { registerCustom() {} }
    );

    try {
      const loaded = await manager.loadAll();
      assert.deepEqual(loaded, []);
      assert.equal(manager.getLoaded().length, 0);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});
