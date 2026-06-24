const assert = require('assert');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');
const ActionRouter = require('../../core/assistant/router');
const baseConfig = require('../../config');

const {
  DeviceRegistry,
  FileTransferManager,
  PairingService,
  PhoneCommandRouter,
  PhoneServer,
  TransferHistory
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

describe('Phone device permissions', function() {
  let tempDir;
  let devicePath;
  let logger;
  let registry;
  let server;
  let socket;
  let authentication;

  beforeEach(function() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-device-permissions-'));
    devicePath = path.join(tempDir, 'devices.json');
    logger = createLogger();
    registry = new DeviceRegistry({ filePath: devicePath, logger });
    registry.registerDevice('phone001', 'Galaxy S25');
  });

  afterEach(async function() {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (server) await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createPairingService() {
    return new PairingService({
      deviceRegistry: registry,
      identityVerificationService: { verifyIdentity: async () => ({ success: true }) },
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json')
    });
  }

  async function connect(commandProcessor) {
    const pairingService = createPairingService();
    const session = pairingService.sessionManager.createSession('phone001');
    authentication = {
      deviceId: 'phone001',
      sessionToken: session.sessionToken,
      timestamp: Date.now()
    };
    server = new PhoneServer({
      port: 0,
      commandRouter: new PhoneCommandRouter({ processCommand: commandProcessor }),
      pairingService,
      logger
    });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}?deviceId=phone001`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;
  }

  it('saves and reloads per-device permissions', function() {
    assert.deepEqual(registry.getPermissions('phone001'), {
      remoteCommands: true,
      fileTransfer: true,
      receiveFiles: true,
      sendFiles: true,
      powerActions: false
    });

    registry.updatePermissions('phone001', { remoteCommands: false, powerActions: true });
    const restored = new DeviceRegistry({ filePath: devicePath });
    assert.equal(restored.hasPermission('phone001', 'remoteCommands'), false);
    assert.equal(restored.hasPermission('phone001', 'powerActions'), true);
    assert.equal(JSON.parse(fs.readFileSync(devicePath, 'utf8'))[0].permissions.powerActions, true);
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Permission changed'));
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Permission granted'));
  });

  it('migrates existing trusted devices to safe default permissions', function() {
    const legacyPath = path.join(tempDir, 'legacy-devices.json');
    fs.writeFileSync(legacyPath, JSON.stringify([{
      deviceId: 'legacy-phone',
      deviceName: 'Legacy Phone',
      pairedAt: 100,
      lastSeen: 200,
      trusted: true
    }]), 'utf8');

    const migrated = new DeviceRegistry({ filePath: legacyPath });
    assert.equal(migrated.hasPermission('legacy-phone', 'remoteCommands'), true);
    assert.equal(migrated.hasPermission('legacy-phone', 'powerActions'), false);
    assert.equal(JSON.parse(fs.readFileSync(legacyPath, 'utf8'))[0].permissions.powerActions, false);
  });

  it('denies remote commands before invoking the assistant', async function() {
    let commandCount = 0;
    registry.updatePermissions('phone001', { remoteCommands: false });
    await connect(async () => {
      commandCount += 1;
      return { success: true, response: 'done' };
    });

    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      ...authentication,
      requestId: 'denied-command',
      message: 'Open Chrome'
    }));
    assert.deepEqual(await responsePromise, {
      type: 'error',
      message: 'Remote commands disabled.'
    });
    assert.equal(commandCount, 0);
  });

  it('denies resolved power actions without executing automation', async function() {
    let executionCount = 0;
    await connect(async (_input, _source, options) => {
      const permission = options.permissionGuard({ id: 'system.shutdown', action: 'system.shutdown' }, {});
      if (!permission.allowed) return { success: false, response: permission.response };
      executionCount += 1;
      return { success: true, response: 'shutdown' };
    });

    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'command',
      ...authentication,
      requestId: 'power-command',
      message: 'Shutdown computer'
    }));
    const response = await responsePromise;
    assert.equal(response.type, 'response');
    assert.equal(response.success, false);
    assert.equal(response.message, 'Power actions disabled.');
    assert.equal(Number.isFinite(response.timestamp), true);
    assert.equal(executionCount, 0);
  });

  it('enforces the power guard after intent resolution and before automation', async function() {
    let executionCount = 0;
    const router = new ActionRouter(baseConfig, {
      execute: async () => {
        executionCount += 1;
        return { success: true };
      }
    });
    const result = await router.process('shutdown computer', 'phone', {
      permissionGuard(intent) {
        return intent.id === 'system.shutdown'
          ? { allowed: false, response: 'Power actions disabled.' }
          : { allowed: true };
      }
    });

    assert.equal(result.intent, 'system.shutdown');
    assert.equal(result.response, 'Power actions disabled.');
    assert.equal(executionCount, 0);
  });

  it('denies receive, send, and master file-transfer permissions', async function() {
    const history = new TransferHistory({ filePath: path.join(tempDir, 'history.json') });
    const manager = new FileTransferManager({
      deviceRegistry: registry,
      history,
      receiveDirectory: path.join(tempDir, 'received'),
      tempDirectory: path.join(tempDir, 'temp'),
      logger
    });
    const content = Buffer.from('blocked');
    const payload = {
      type: 'file-transfer',
      deviceId: 'phone001',
      fileName: 'blocked.txt',
      fileSize: content.length,
      data: content.toString('base64')
    };

    registry.updatePermissions('phone001', { receiveFiles: false });
    await assert.rejects(() => manager.receiveFile(payload), /Receiving files disabled/);

    const source = path.join(tempDir, 'outgoing.txt');
    fs.writeFileSync(source, 'blocked', 'utf8');
    registry.updatePermissions('phone001', { receiveFiles: true, sendFiles: false });
    await assert.rejects(() => manager.sendFileToDevice('phone001', source), /Sending files disabled/);

    registry.updatePermissions('phone001', { sendFiles: true, fileTransfer: false });
    await assert.rejects(() => manager.receiveFile(payload), /File transfer disabled/);
    await assert.rejects(() => manager.sendFileToDevice('phone001', source), /File transfer disabled/);
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Permission denied'));
  });

  it('removes devices and their persisted permissions', function() {
    assert.equal(registry.removeDevice('phone001'), true);
    assert.equal(registry.getDevice('phone001'), null);
    assert.deepEqual(JSON.parse(fs.readFileSync(devicePath, 'utf8')), []);
    assert.ok(logger.entries.some(entry => entry.message === '[PHONE] Device removed'));
  });
});
