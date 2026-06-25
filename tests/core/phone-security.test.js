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
  PhoneServer,
  SecurityManager,
  SessionManager,
  TransferIntegrity
} = require('../../core/phone');

function nextJson(socket) {
  return once(socket, 'message').then(([data]) => JSON.parse(data.toString('utf8')));
}

function createLogger() {
  const entries = [];
  return {
    entries,
    info(message, data) { entries.push({ level: 'info', message, data }); },
    warn(message, data) { entries.push({ level: 'warn', message, data }); },
    error(message, data) { entries.push({ level: 'error', message, data }); }
  };
}

describe('Phone security hardening', function() {
  let now;
  let tempDir;
  let registry;
  let sessionManager;
  let logger;
  let pairingService;
  let server;
  let socket;

  beforeEach(function() {
    now = 1_000_000;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-phone-security-'));
    logger = createLogger();
    registry = new DeviceRegistry({ filePath: path.join(tempDir, 'devices.json'), now: () => now });
    registry.registerDevice('phone001', 'Galaxy S25');
    sessionManager = new SessionManager({
      now: () => now,
      createToken: () => 'a'.repeat(64)
    });
    pairingService = new PairingService({
      deviceRegistry: registry,
      sessionManager,
      identityVerificationService: { verifyIdentity: async () => ({ success: true }) },
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json'),
      logger
    });
  });

  afterEach(async function() {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (server) await server.stop();
    else pairingService.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('issues cryptographically scoped sessions for 24 hours', function() {
    const session = sessionManager.createSession('phone001');
    assert.deepEqual(session, {
      deviceId: 'phone001',
      sessionToken: 'a'.repeat(64),
      issuedAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000
    });
    assert.equal(sessionManager.validateSession('phone001', session.sessionToken).valid, true);

    now = session.expiresAt;
    assert.equal(sessionManager.validateSession('phone001', session.sessionToken).reason, 'expired-session');
  });

  it('rejects missing, invalid, expired, stale, and replayed authentication data', function() {
    const security = new SecurityManager({
      deviceRegistry: registry,
      sessionManager,
      now: () => now,
      logger
    });
    const session = sessionManager.createSession('phone001');
    const valid = {
      deviceId: 'phone001',
      sessionToken: session.sessionToken,
      requestId: 'request-1',
      timestamp: now
    };

    assert.equal(security.validateConnection({ ...valid, sessionToken: '' }).reason, 'missing-session');
    assert.equal(security.validateConnection({ ...valid, sessionToken: 'b'.repeat(64) }).reason, 'invalid-session');
    assert.equal(security.validateConnection({ ...valid, timestamp: now - 300_001 }).reason, 'stale-timestamp');
    assert.equal(security.validateConnection(valid).valid, true);
    assert.equal(security.validateConnection(valid).reason, 'duplicate-request');
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Authentication failure'));
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Replay attempt'));

    now = session.expiresAt;
    assert.equal(security.validateConnection({ ...valid, requestId: 'request-2', timestamp: now }).reason, 'expired-session');
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Expired session'));
  });

  it('returns a session after pairing and requires it for commands', async function() {
    server = new PhoneServer({
      port: 0,
      commandRouter: new PhoneCommandRouter({
        processCommand: async () => ({ success: true, response: 'done' })
      }),
      pairingService,
      securityManager: new SecurityManager({
        deviceRegistry: registry,
        sessionManager,
        now: () => now,
        logger
      }),
      logger
    });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;

    const pairingToken = await pairingService.createPairingToken();
    let responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'pair',
      deviceId: 'phone001',
      deviceName: 'Galaxy S25',
      token: pairingToken.token
    }));
    const paired = await responsePromise;
    assert.equal(paired.type, 'pair-success');
    assert.equal(paired.deviceId, 'phone001');
    assert.equal(paired.sessionToken, 'a'.repeat(64));
    assert.equal(paired.expiresAt, now + 24 * 60 * 60 * 1000);
    assert.equal(typeof paired.serverIp, 'string');
    assert.equal(paired.serverPort, address.port);

    responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      deviceId: 'phone001',
      sessionToken: paired.sessionToken,
      requestId: 'command-1',
      timestamp: now,
      message: 'Open Chrome'
    }));
    assert.equal((await responsePromise).type, 'response');

    responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      deviceId: 'phone001',
      requestId: 'command-2',
      timestamp: now,
      message: 'Open Chrome'
    }));
    assert.deepEqual(await responsePromise, { type: 'error', message: 'Authentication failed.' });
  });

  it('creates and verifies SHA-256 hashes and detects modified files', function() {
    const integrity = new TransferIntegrity();
    const content = Buffer.from('trusted file content');
    const hash = integrity.createHash(content);

    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(integrity.verify(content, hash), true);
    assert.equal(integrity.verify(Buffer.from('modified content'), hash), false);
  });
});
