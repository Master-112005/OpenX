const assert = require('assert');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

const {
  DeviceRegistry,
  PairingService,
  PairingTokenManager,
  PhoneCommandRouter,
  PhoneServer
} = require('../../core/phone');

function nextJson(socket) {
  return once(socket, 'message').then(([data]) => JSON.parse(data.toString('utf8')));
}

function logger() {
  return { info() {}, warn() {}, error() {} };
}

describe('Phone device pairing', function() {
  let now;
  let tempDir;
  let registry;
  let tokenManager;
  let pairingService;
  let server;
  let sockets;
  let commandCount;

  beforeEach(function() {
    now = 1000;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-pairing-'));
    registry = new DeviceRegistry({
      filePath: path.join(tempDir, 'devices.json'),
      now: () => now
    });
    tokenManager = new PairingTokenManager({ now: () => now });
    pairingService = new PairingService({
      tokenManager,
      deviceRegistry: registry,
      identityVerificationService: { verifyIdentity: async () => ({ success: true }) },
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json')
    });
    sockets = [];
    commandCount = 0;
  });

  afterEach(async function() {
    for (const socket of sockets) {
      if (socket.readyState < WebSocket.CLOSING) socket.close();
    }
    if (server) await server.stop();
    else pairingService.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createServer() {
    const commandRouter = new PhoneCommandRouter({
      processCommand: async () => {
        commandCount += 1;
        return { success: true, response: 'done' };
      }
    });
    server = new PhoneServer({ port: 0, commandRouter, pairingService, logger: logger() });
    return server.start();
  }

  async function connect(address, deviceId = '') {
    const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}${query}`);
    sockets.push(socket);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;
    return socket;
  }

  it('generates eight-character uppercase alphanumeric tokens', function() {
    const generated = tokenManager.generateToken();

    assert.match(generated.token, /^[A-Z0-9]{8}$/);
    assert.equal(generated.expiresAt, now + 5 * 60 * 1000);
    assert.equal(tokenManager.validateToken(generated.token), true);
  });

  it('expires and removes pairing tokens after five minutes', function() {
    const generated = tokenManager.generateToken();
    now = generated.expiresAt;

    assert.equal(tokenManager.validateToken(generated.token), false);
    assert.equal(tokenManager.tokens.has(generated.token), false);
  });

  it('registers trusted devices and persists them to devices.json', function() {
    const device = registry.registerDevice('phone001', 'Galaxy S25');
    const restored = new DeviceRegistry({ filePath: path.join(tempDir, 'devices.json') });

    assert.equal(device.trusted, true);
    assert.equal(registry.isTrusted('phone001'), true);
    assert.deepEqual(restored.getDevice('phone001'), device);
    assert.equal(fs.existsSync(path.join(tempDir, 'pairing.json')), true);
    assert.equal(fs.existsSync(path.join(tempDir, 'permissions.json')), true);
  });

  it('rejects commands from untrusted devices without calling the assistant', async function() {
    const address = await createServer();
    const socket = await connect(address, 'unpaired-phone');
    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      deviceId: 'unpaired-phone',
      requestId: 'unpaired-command',
      timestamp: now,
      message: 'Open Chrome'
    }));

    assert.deepEqual(await responsePromise, { type: 'error', message: 'Device not paired' });
    assert.equal(commandCount, 0);
  });

  it('pairs a device with a valid token and permits commands', async function() {
    const address = await createServer();
    const socket = await connect(address);
    const generated = await pairingService.createPairingToken();

    let responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'pair',
      deviceId: 'phone001',
      deviceName: 'Galaxy S25',
      token: generated.token
    }));
    const paired = await responsePromise;
    assert.equal(paired.type, 'pair-success');
    assert.equal(typeof paired.sessionToken, 'string');
    assert.equal(registry.isTrusted('phone001'), true);
    assert.equal(tokenManager.validateToken(generated.token), false);

    responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      deviceId: 'phone001',
      sessionToken: paired.sessionToken,
      requestId: 'paired-command',
      timestamp: now,
      message: 'Open Chrome'
    }));
    assert.equal((await responsePromise).type, 'response');
    assert.equal(commandCount, 1);
  });

  it('preserves device trust when the phone reconnects', async function() {
    registry.registerDevice('phone001', 'Galaxy S25');
    const session = pairingService.sessionManager.createSession('phone001');
    const address = await createServer();
    let socket = await connect(address, 'phone001');
    socket.close();
    await once(socket, 'close');

    now = 2000;
    socket = await connect(address, 'phone001');
    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      deviceId: 'phone001',
      sessionToken: session.sessionToken,
      requestId: 'reconnect-command',
      timestamp: now,
      message: 'Open Chrome'
    }));

    assert.equal((await responsePromise).type, 'response');
    assert.equal(commandCount, 1);
    assert.equal(registry.getDevice('phone001').lastSeen, 2000);
  });

  it('rejects invalid pairing tokens', async function() {
    const address = await createServer();
    const socket = await connect(address);
    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'pair',
      deviceId: 'phone001',
      deviceName: 'Galaxy S25',
      token: 'BAD12345'
    }));

    assert.deepEqual(await responsePromise, { type: 'pair-failed' });
    assert.equal(registry.isTrusted('phone001'), false);
  });

  it('rejects expired pairing tokens', async function() {
    const generated = await pairingService.createPairingToken();
    now = generated.expiresAt;
    const address = await createServer();
    const socket = await connect(address);
    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'pair',
      deviceId: 'phone001',
      deviceName: 'Galaxy S25',
      token: generated.token
    }));

    assert.deepEqual(await responsePromise, { type: 'pair-failed' });
    assert.equal(registry.isTrusted('phone001'), false);
  });
});
