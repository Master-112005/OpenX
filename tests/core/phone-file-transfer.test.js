const assert = require('assert');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

const {
  DeviceRegistry,
  FileTransferManager,
  FileTransferProtocol,
  PairingService,
  PhoneCommandRouter,
  PhoneServer,
  TransferHistory
} = require('../../core/phone');
const TransferIntegrity = require('../../core/phone/TransferIntegrity');

function quietLogger() {
  return { info() {}, warn() {}, error() {} };
}

function nextJson(socket) {
  return once(socket, 'message').then(([data]) => JSON.parse(data.toString('utf8')));
}

describe('Phone file transfer', function() {
  let tempDir;
  let receiveDirectory;
  let historyPath;
  let registry;
  let history;
  let manager;
  let server;
  let socket;

  beforeEach(function() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-transfer-'));
    receiveDirectory = path.join(tempDir, 'Downloads', 'OpenX_Received');
    historyPath = path.join(tempDir, 'OpenX_Data', 'phone', 'transfer-history.json');
    registry = new DeviceRegistry({ filePath: path.join(tempDir, 'devices.json'), now: () => 1000 });
    registry.registerDevice('phone001', 'Galaxy S25');
    history = new TransferHistory({ filePath: historyPath, createId: () => 'transfer-1' });
    manager = new FileTransferManager({
      deviceRegistry: registry,
      history,
      receiveDirectory,
      tempDirectory: path.join(tempDir, 'zip-temp'),
      logger: quietLogger(),
      now: () => 123456789
    });
  });

  afterEach(async function() {
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    if (server) await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves a trusted phone transfer and persists completed history', async function() {
    const content = Buffer.from('OpenX transfer test');
    const result = await manager.receiveFile({
      type: 'file-transfer',
      deviceId: 'phone001',
      fileName: 'report.pdf',
      fileSize: content.length,
      sha256: new TransferIntegrity().createHash(content),
      data: content.toString('base64')
    });

    assert.equal(result.filePath, path.join(receiveDirectory, 'report.pdf'));
    assert.deepEqual(fs.readFileSync(result.filePath), content);
    assert.deepEqual(result.record, {
      id: 'transfer-1',
      deviceId: 'phone001',
      fileName: 'report.pdf',
      direction: 'phone-to-desktop',
      size: content.length,
      timestamp: 123456789,
      status: 'completed'
    });
    assert.deepEqual(new TransferHistory({ filePath: historyPath }).list(), [result.record]);
  });

  it('rejects transfers from untrusted devices before decoding file data', async function() {
    await assert.rejects(
      () => manager.receiveFile({
        type: 'file-transfer',
        deviceId: 'untrusted-phone',
        fileName: 'report.pdf',
        fileSize: 10,
        data: 'not-base64'
      }),
      error => error.code === 'device_not_paired' && error.message === 'Device not paired'
    );
    assert.equal(fs.readdirSync(receiveDirectory).length, 0);
    assert.equal(history.list().length, 0);
    await assert.rejects(
      () => manager.sendFileToDevice('untrusted-phone', path.join(tempDir, 'missing.txt')),
      error => error.code === 'device_not_paired'
    );
  });

  it('rejects files above the 100 MB limit without decoding the payload', async function() {
    await assert.rejects(
      () => manager.receiveFile({
        type: 'file-transfer',
        deviceId: 'phone001',
        fileName: 'large.bin',
        fileSize: FileTransferProtocol.MAX_FILE_SIZE_BYTES + 1,
        data: ''
      }),
      error => error.code === 'file_too_large'
    );
  });

  it('rejects malformed base64, size mismatches, and unsafe file names', async function() {
    const base = {
      type: 'file-transfer',
      deviceId: 'phone001',
      fileName: 'safe.txt',
      fileSize: 3,
      sha256: new TransferIntegrity().createHash(Buffer.from('abc')),
      data: 'YWJj'
    };
    await assert.rejects(() => manager.receiveFile({ ...base, data: '!!!=' }), /Malformed/);
    await assert.rejects(() => manager.receiveFile({ ...base, fileSize: 4 }), /does not match/);
    await assert.rejects(() => manager.receiveFile({ ...base, fileName: '..\\escape.txt' }), /Invalid file name/);
  });

  it('rejects a transfer when its SHA-256 hash does not match the received bytes', async function() {
    const original = Buffer.from('original');
    const modified = Buffer.from('modified');
    await assert.rejects(
      () => manager.receiveFile({
        type: 'file-transfer',
        deviceId: 'phone001',
        fileName: 'tampered.txt',
        fileSize: modified.length,
        sha256: new TransferIntegrity().createHash(original),
        data: modified.toString('base64')
      }),
      error => error.code === 'hash_mismatch' && /integrity/.test(error.message)
    );
    assert.equal(fs.existsSync(path.join(receiveDirectory, 'tampered.txt')), false);
    assert.equal(history.list()[0].status, 'failed');
  });

  it('zips a folder for transfer using a standard ZIP archive', async function() {
    const folder = path.join(tempDir, 'Project Files');
    fs.mkdirSync(path.join(folder, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'readme.txt'), 'hello', 'utf8');
    fs.writeFileSync(path.join(folder, 'nested', 'data.json'), '{}', 'utf8');

    const zipPath = await manager.zipFolder(folder);
    const signature = fs.readFileSync(zipPath).subarray(0, 4);
    assert.equal(path.extname(zipPath), '.zip');
    assert.equal(signature.subarray(0, 2).toString('ascii'), 'PK');
  });

  it('sends files and zipped folders only to a connected trusted device', async function() {
    const sent = [];
    manager.sendToDevice = async (deviceId, payload) => {
      sent.push({ deviceId, payload });
      return true;
    };
    const folder = path.join(tempDir, 'Documents');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'note.txt'), 'hello', 'utf8');

    const result = await manager.sendFileToDevice('phone001', folder);
    assert.equal(result.record.direction, 'desktop-to-phone');
    assert.equal(result.record.fileName, 'Documents.zip');
    assert.equal(sent[0].deviceId, 'phone001');
    assert.equal(sent[0].payload.type, 'file-transfer');
    assert.equal(sent[0].payload.fileName, 'Documents.zip');
    assert.match(sent[0].payload.data, /^[A-Za-z0-9+/]+=*$/);
  });

  it('handles trusted incoming transfers through the WebSocket protocol', async function() {
    const pairingService = new PairingService({
      deviceRegistry: registry,
      identityVerificationService: { verifyIdentity: async () => ({ success: true }) },
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json')
    });
    const session = pairingService.sessionManager.createSession('phone001');
    server = new PhoneServer({
      port: 0,
      commandRouter: new PhoneCommandRouter({ processCommand: async () => ({ success: true }) }),
      pairingService,
      fileTransferManager: manager,
      logger: quietLogger()
    });
    const address = await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${address.port}?deviceId=phone001`);
    const statusPromise = nextJson(socket);
    await once(socket, 'open');
    await statusPromise;

    const content = Buffer.from('via websocket');
    const responsePromise = nextJson(socket);
    socket.send(JSON.stringify({
      type: 'file-transfer',
      deviceId: 'phone001',
      sessionToken: session.sessionToken,
      requestId: 'file-transfer-1',
      timestamp: Date.now(),
      fileName: 'socket.txt',
      fileSize: content.length,
      sha256: new TransferIntegrity().createHash(content),
      data: content.toString('base64')
    }));

    assert.deepEqual(await responsePromise, { type: 'file-transfer-success' });
    assert.deepEqual(fs.readFileSync(path.join(receiveDirectory, 'socket.txt')), content);
  });
});
