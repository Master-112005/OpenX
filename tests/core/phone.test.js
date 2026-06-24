const assert = require('assert');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

const {
  DeviceRegistry,
  PairingService,
  PhoneCommandRouter,
  PhoneConnectionManager,
  PhoneServer
} = require('../../core/phone');

function createLogger() {
  return { info() {}, warn() {}, error() {} };
}

function nextJson(socket) {
  return once(socket, 'message').then(([data]) => JSON.parse(data.toString('utf8')));
}

function createPairingService(directory) {
  const deviceRegistry = new DeviceRegistry({ filePath: path.join(directory, 'devices.json') });
  return new PairingService({
    deviceRegistry,
    identityVerificationService: { verifyIdentity: async () => ({ success: true }) },
    pairingPath: path.join(directory, 'pairing.json'),
    permissionsPath: path.join(directory, 'permissions.json')
  });
}

describe('Phone communication', function() {
  let server;
  let socket;
  let tempDir;

  beforeEach(function() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-phone-'));
  });

  afterEach(async function() {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (server) await server.stop();
    socket = null;
    server = null;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('tracks client connection metadata', function() {
    const manager = new PhoneConnectionManager({
      now: () => 123,
      createId: () => 'client-1'
    });
    const clientId = manager.add({ readyState: WebSocket.OPEN }, { deviceName: 'Test phone' });

    assert.equal(clientId, 'client-1');
    assert.deepEqual(manager.get(clientId), {
      socket: { readyState: WebSocket.OPEN },
      connectedAt: 123,
      lastSeen: 123,
      deviceName: 'Test phone',
      deviceId: null
    });
  });

  it('routes commands through the current assistant public API', async function() {
    const calls = [];
    let currentAssistant = {
      processCommand: async (...args) => {
        calls.push(args);
        return { success: true, response: 'done' };
      }
    };
    const router = new PhoneCommandRouter(() => currentAssistant);

    assert.deepEqual(await router.route('  Open Chrome  '), { success: true, response: 'done' });
    assert.deepEqual(calls, [['Open Chrome', 'phone']]);
    currentAssistant = null;
    await assert.rejects(() => router.route('hello'), /not initialized/);
  });

  it('accepts commands and returns assistant responses over WebSocket', async function() {
    const calls = [];
    const router = new PhoneCommandRouter({
      processCommand: async (...args) => {
        calls.push(args);
        return { success: true, response: 'Chrome launched successfully' };
      }
    });
    const pairingService = createPairingService(tempDir);
    pairingService.deviceRegistry.registerDevice('phone001', 'Test Phone');
    server = new PhoneServer({ port: 0, commandRouter: router, pairingService, logger: createLogger() });
    const address = await server.start();

    socket = new WebSocket(`ws://127.0.0.1:${address.port}?deviceId=phone001&deviceName=Test%20Phone`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    assert.deepEqual(await statusPromise, { type: 'status', status: 'connected' });

    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({ type: 'command', message: 'Open Chrome', timestamp: 123456789 }));
    assert.deepEqual(await responsePromise, {
      type: 'response',
      success: true,
      message: 'Chrome launched successfully',
      timestamp: 123456789
    });
    assert.deepEqual(calls, [['Open Chrome', 'phone']]);
    assert.equal(server.clients.size, 1);
    assert.equal([...server.clients.values()][0].deviceName, 'Test Phone');
  });

  it('rejects malformed and unsupported messages without invoking the assistant', async function() {
    let commandCount = 0;
    const router = new PhoneCommandRouter({
      processCommand: async () => {
        commandCount += 1;
        return { success: true, response: 'done' };
      }
    });
    server = new PhoneServer({
      port: 0,
      commandRouter: router,
      pairingService: createPairingService(tempDir),
      logger: createLogger()
    });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;

    let errorPromise = nextJson(socket);
    socket.send('not json');
    assert.deepEqual(await errorPromise, { type: 'error', message: 'Invalid message format' });

    errorPromise = nextJson(socket);
    socket.send(JSON.stringify({ type: 'ping' }));
    assert.deepEqual(await errorPromise, { type: 'error', message: 'Invalid command' });
    assert.equal(commandCount, 0);
  });

  it('returns a protocol error when assistant execution fails', async function() {
    const router = new PhoneCommandRouter({
      processCommand: async () => {
        throw new Error('automation failed');
      }
    });
    const pairingService = createPairingService(tempDir);
    pairingService.deviceRegistry.registerDevice('phone001', 'Test Phone');
    server = new PhoneServer({ port: 0, commandRouter: router, pairingService, logger: createLogger() });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}?deviceId=phone001`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;

    const errorPromise = nextJson(socket);
    socket.send(JSON.stringify({ type: 'command', message: 'Open Chrome' }));
    assert.deepEqual(await errorPromise, { type: 'error', message: 'Unable to execute command' });
  });

  it('broadcasts to all connected clients', async function() {
    const router = new PhoneCommandRouter({ processCommand: async () => ({ success: true }) });
    server = new PhoneServer({
      port: 0,
      commandRouter: router,
      pairingService: createPairingService(tempDir),
      logger: createLogger()
    });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;

    const messagePromise = nextJson(socket);
    assert.equal(server.broadcast({ type: 'status', status: 'connected' }), 1);
    assert.deepEqual(await messagePromise, { type: 'status', status: 'connected' });
  });
});
