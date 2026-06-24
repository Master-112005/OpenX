const { URL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');
const PhoneConnectionManager = require('./PhoneConnectionManager');
const FileTransferProtocol = require('./FileTransferProtocol');
const SecurityManager = require('./SecurityManager');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8080;
const MAX_COMMAND_LENGTH = 5000;
const MAX_PAYLOAD_BYTES = FileTransferProtocol.MAX_WEBSOCKET_PAYLOAD_BYTES;
const POWER_ACTION_IDS = new Set([
  'system.shutdown',
  'system.restart',
  'system.sleep',
  'system.logoff',
  'system.lock'
]);

class PhoneServer {
  constructor(options = {}) {
    if (!options.commandRouter || typeof options.commandRouter.route !== 'function') {
      throw new TypeError('PhoneServer requires a command router');
    }
    if (!options.pairingService || typeof options.pairingService.pairDevice !== 'function') {
      throw new TypeError('PhoneServer requires a pairing service');
    }

    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.commandRouter = options.commandRouter;
    this.pairingService = options.pairingService;
    this.fileTransferManager = options.fileTransferManager || null;
    this.logger = options.logger || console;
    this.sessionManager = options.sessionManager || this.pairingService.sessionManager;
    this.securityManager = options.securityManager || new SecurityManager({
      deviceRegistry: this.pairingService.deviceRegistry,
      sessionManager: this.sessionManager,
      now: options.now || this.sessionManager.now,
      logger: this.logger
    });
    this.connectionManager = options.connectionManager || new PhoneConnectionManager();
    this.clients = this.connectionManager.clients;
    this.server = null;
    this.startPromise = null;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.server) return Promise.resolve(this.address());

    this.startPromise = new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port: this.port,
        maxPayload: MAX_PAYLOAD_BYTES
      });
      this.server = server;

      const onStartupError = error => {
        server.removeListener('listening', onListening);
        this.server = null;
        this.startPromise = null;
        this.logger.error('[PHONE] Server Error', { error: error.message });
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onStartupError);
        server.on('error', error => {
          this.logger.error('[PHONE] Server Error', { error: error.message });
        });
        this.startPromise = null;
        this.logger.info('[PHONE] Server Listening', this.address());
        resolve(this.address());
      };

      server.once('error', onStartupError);
      server.once('listening', onListening);
      server.on('connection', (socket, request) => this._handleConnection(socket, request));
    });

    return this.startPromise;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.startPromise = null;
    if (!server) {
      this.connectionManager.clear();
      this.pairingService.destroy?.();
      return;
    }

    for (const client of this.clients.values()) {
      try {
        client.socket.close(1001, 'Desktop shutting down');
        client.socket.terminate();
      } catch (_) {
        client.socket.terminate?.();
      }
    }
    this.connectionManager.clear();
    this.pairingService.destroy?.();

    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    this.logger.info('[PHONE] Server Stopped');
  }

  address() {
    const address = this.server?.address();
    if (!address || typeof address === 'string') {
      return { host: this.host, port: this.port };
    }
    return { host: address.address, port: address.port };
  }

  broadcast(payload) {
    let sent = 0;
    for (const clientId of this.clients.keys()) {
      if (this.sendToClient(clientId, payload)) sent += 1;
    }
    return sent;
  }

  sendToClient(clientId, payload) {
    const client = this.connectionManager.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return false;

    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    client.socket.send(serialized, error => {
      if (error) {
        this.logger.error('[PHONE] Send Error', { clientId, error: error.message });
      }
    });
    this.logger.info('[PHONE] Response Sent', { clientId, type: payload?.type });
    return true;
  }

  sendToDevice(deviceId, payload) {
    for (const [clientId, client] of this.clients) {
      if (client.deviceId === deviceId && this.sendToClient(clientId, payload)) return true;
    }
    return false;
  }

  disconnectDevice(deviceId) {
    let disconnected = 0;
    for (const client of this.clients.values()) {
      if (client.deviceId !== deviceId) continue;
      disconnected += 1;
      client.socket.close(1008, 'Device disconnected by desktop');
    }
    return disconnected;
  }

  revokeDeviceSession(deviceId) {
    this.securityManager.clearDevice(deviceId);
    return this.sessionManager.revokeSession(deviceId);
  }

  _handleConnection(socket, request) {
    const metadata = this._readClientMetadata(request);
    const clientId = this.connectionManager.add(socket, metadata);
    this.logger.info('[PHONE] Connected', { clientId, ...metadata });
    this.sendToClient(clientId, { type: 'status', status: 'connected' });

    socket.on('message', data => {
      this._handleMessage(clientId, data).catch(error => {
        this.logger.error('[PHONE] Command Error', { clientId, error: error.message });
        this.sendToClient(clientId, { type: 'error', message: 'Unable to execute command' });
      });
    });
    socket.on('close', () => {
      this.connectionManager.remove(clientId);
      this.logger.info('[PHONE] Disconnected', { clientId, deviceName: metadata.deviceName });
    });
    socket.on('error', error => {
      this.logger.error('[PHONE] Connection Error', { clientId, error: error.message });
    });
  }

  async _handleMessage(clientId, data) {
    this.connectionManager.touch(clientId);
    this.logger.info('[PHONE] Message Received', { clientId });

    let payload;
    try {
      payload = JSON.parse(data.toString('utf8'));
    } catch (_) {
      this.sendToClient(clientId, { type: 'error', message: 'Invalid message format' });
      return;
    }

    if (payload?.type === 'pair') {
      this._handlePairRequest(clientId, payload);
      return;
    }

    if (payload?.type === 'file-transfer') {
      await this._handleFileTransfer(clientId, payload);
      return;
    }

    if (
      !payload ||
      payload.type !== 'command' ||
      typeof payload.message !== 'string' ||
      payload.message.trim().length === 0 ||
      payload.message.length > MAX_COMMAND_LENGTH
    ) {
      this.sendToClient(clientId, { type: 'error', message: 'Invalid command' });
      return;
    }

    const client = this.connectionManager.get(clientId);
    const authentication = this._authenticateRequest(clientId, client, payload);
    if (!authentication) return;
    const deviceId = authentication.deviceId;
    const registry = this.pairingService.deviceRegistry;
    if (!registry.hasPermission(deviceId, 'remoteCommands')) {
      this.logger.info('[PHONE] Permission denied', { deviceId, permission: 'remoteCommands' });
      this.sendToClient(clientId, { type: 'error', message: 'Remote commands disabled.' });
      return;
    }

    const device = registry.getDevice(deviceId);
    this.connectionManager.setDevice(clientId, device);
    registry.updateLastSeen(deviceId);

    const result = await this.commandRouter.route(payload.message, {
      permissionGuard: this._createPermissionGuard(deviceId)
    });
    const message = result?.response || result?.message || 'Command completed';
    this.sendToClient(clientId, {
      type: 'response',
      success: result?.success === true,
      message,
      timestamp: Number.isFinite(payload.timestamp) ? payload.timestamp : Date.now()
    });
  }

  _handlePairRequest(clientId, payload) {
    const result = this.pairingService.pairDevice(payload);
    if (!result.valid) {
      this.logger.warn('[PHONE] Pairing Failed', { clientId, reason: result.reason });
      this.sendToClient(clientId, { type: 'pair-failed' });
      return;
    }

    this.connectionManager.setDevice(clientId, result.device);
    this.logger.info('[PHONE] Device Paired', {
      clientId,
      deviceId: result.device.deviceId,
      deviceName: result.device.deviceName
    });
    this.sendToClient(clientId, {
      type: 'pair-success',
      sessionToken: result.session.sessionToken,
      issuedAt: result.session.issuedAt,
      expiresAt: result.session.expiresAt
    });
  }

  async _handleFileTransfer(clientId, payload) {
    const client = this.connectionManager.get(clientId);
    const authentication = this._authenticateRequest(clientId, client, payload);
    if (!authentication) return;
    const deviceId = authentication.deviceId;
    if (!this.fileTransferManager) {
      this.sendToClient(clientId, { type: 'error', message: 'File transfer unavailable' });
      return;
    }

    try {
      await this.fileTransferManager.receiveFile({ ...payload, deviceId });
      const device = this.pairingService.deviceRegistry.getDevice(deviceId);
      if (device) this.connectionManager.setDevice(clientId, device);
      this.sendToClient(clientId, { type: 'file-transfer-success' });
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        message: error.publicMessage || 'File transfer failed'
      });
    }
  }

  _resolveDeviceId(client, payload) {
    const payloadDeviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
    if (client?.deviceId && payloadDeviceId && client.deviceId !== payloadDeviceId) return '';
    return client?.deviceId || payloadDeviceId;
  }

  _authenticateRequest(clientId, client, payload) {
    const deviceId = this._resolveDeviceId(client, payload);
    if (!deviceId || deviceId !== payload.deviceId) {
      this.logger.warn('[PHONE] Authentication failure', {
        deviceId: payload?.deviceId || null,
        reason: 'device-mismatch'
      });
      this.sendToClient(clientId, { type: 'error', message: 'Authentication failed.' });
      return null;
    }
    const result = this.securityManager.validateConnection(payload);
    if (!result.valid) {
      this.sendToClient(clientId, { type: 'error', message: result.message });
      return null;
    }
    return result;
  }

  _createPermissionGuard(deviceId) {
    return intent => {
      const intentId = String(intent?.id || intent?.action || '').toLowerCase();
      if (!POWER_ACTION_IDS.has(intentId)) return { allowed: true };
      if (this.pairingService.deviceRegistry.hasPermission(deviceId, 'powerActions')) {
        return { allowed: true };
      }
      this.logger.info('[PHONE] Permission denied', { deviceId, permission: 'powerActions', intent: intentId });
      return { allowed: false, response: 'Power actions disabled.' };
    };
  }

  _readClientMetadata(request) {
    try {
      const url = new URL(request?.url || '/', 'ws://localhost');
      const deviceName = url.searchParams.get('deviceName')?.trim();
      const deviceId = url.searchParams.get('deviceId')?.trim();
      return {
        deviceName: deviceName ? deviceName.slice(0, 100) : 'Unknown device',
        deviceId: deviceId ? deviceId.slice(0, 128) : null
      };
    } catch (_) {
      return { deviceName: 'Unknown device', deviceId: null };
    }
  }
}

PhoneServer.DEFAULT_HOST = DEFAULT_HOST;
PhoneServer.DEFAULT_PORT = DEFAULT_PORT;

module.exports = PhoneServer;
