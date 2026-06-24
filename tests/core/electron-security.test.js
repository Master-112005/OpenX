const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  IPC_VALIDATORS,
  assertTrustedIpcSender,
  createSecureWebPreferences,
  isTrustedRendererUrl
} = require('../../apps/desktop/electron/security');

describe('Electron Security Boundary', function() {
  const rendererRoot = path.resolve(__dirname, '..', '..', 'apps', 'desktop', 'renderer');
  const chatFile = path.join(rendererRoot, 'chat', 'index.html');

  it('should accept only local files inside the renderer root', function() {
    assert.equal(isTrustedRendererUrl(pathToFileURL(chatFile).href, rendererRoot), true);
    assert.equal(isTrustedRendererUrl('https://example.com/', rendererRoot), false);
    assert.equal(isTrustedRendererUrl(pathToFileURL(path.join(rendererRoot, '..', 'preload', 'index.js')).href, rendererRoot), false);
    assert.equal(isTrustedRendererUrl('not a url', rendererRoot), false);
  });

  it('should validate the sender frame before allowing IPC', function() {
    const trustedEvent = { senderFrame: { url: pathToFileURL(chatFile).href } };
    const untrustedEvent = { senderFrame: { url: 'https://example.com/' } };

    assert.equal(assertTrustedIpcSender(trustedEvent, rendererRoot), trustedEvent.senderFrame.url);
    assert.throws(() => assertTrustedIpcSender(untrustedEvent, rendererRoot), /trusted local renderer/);
  });

  it('should expose hardened BrowserWindow preferences', function() {
    const preferences = createSecureWebPreferences('C:\\app\\preload.js');

    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.nodeIntegrationInWorker, false);
    assert.equal(preferences.nodeIntegrationInSubFrames, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.backgroundThrottling, false);
    assert.equal(preferences.allowRunningInsecureContent, false);
    assert.equal(preferences.enableRemoteModule, false);
    assert.equal(preferences.webviewTag, false);
    assert.equal(Object.isFrozen(preferences), true);
  });

  it('should normalize valid command payloads and reject malformed ones', function() {
    assert.deepEqual(
      IPC_VALIDATORS['command:process']({ input: '  open chrome  ', source: 'chat' }),
      { input: 'open chrome', source: 'chat' }
    );
    assert.throws(() => IPC_VALIDATORS['command:process']({ input: '', source: 'chat' }), /must not be empty/);
    assert.throws(() => IPC_VALIDATORS['command:process']({ input: 'hello', source: 'web' }), /not supported/);
    assert.throws(() => IPC_VALIDATORS['command:process']({ input: 'x'.repeat(5001) }), /exceeds/);
  });

  it('should reject dangerous or oversized structured IPC payloads', function() {
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}');

    assert.throws(() => IPC_VALIDATORS['settings:save'](polluted), /forbidden field/);
    assert.throws(
      () => IPC_VALIDATORS['settings:save']({ value: 'x'.repeat(256 * 1024) }),
      /exceeds/
    );
    assert.throws(() => IPC_VALIDATORS['settings:get']({}), /does not accept/);
  });

  it('should validate phone device permission mutations', function() {
    assert.deepEqual(
      IPC_VALIDATORS['phone:device:permissions:update']({
        deviceId: 'phone001',
        permissions: { remoteCommands: false, powerActions: true }
      }),
      {
        deviceId: 'phone001',
        permissions: { remoteCommands: false, powerActions: true }
      }
    );
    assert.throws(
      () => IPC_VALIDATORS['phone:device:permissions:update']({
        deviceId: 'phone001',
        permissions: { administrator: true }
      }),
      /permissions are invalid/
    );
    assert.throws(
      () => IPC_VALIDATORS['phone:device:remove']({ deviceId: '..\\bad' }),
      /deviceId is invalid/
    );
  });

  it('should provide a validator for every registered IPC channel', function() {
    const expectedChannels = [
      'command:process', 'command:confirm', 'assistant:status', 'tts:speak', 'tts:stop',
      'window:openChat', 'window:openSettings', 'config:get', 'settings:get',
      'phone:pairingQR:create', 'phone:devices:list',
      'phone:device:permissions:update', 'phone:device:remove', 'phone:device:disconnect',
      'settings:save', 'settings:reset',
      'schedule:alertAction', 'app:quit'
    ];

    assert.deepEqual(Object.keys(IPC_VALIDATORS).sort(), expectedChannels.sort());
  });
});
