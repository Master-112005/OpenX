const { URL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');
const PhoneConnectionManager = require('./PhoneConnectionManager');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8080;
const MAX_COMMAND_LENGTH = 5000;
const MAX_PAYLOAD_BYTES = 64 * 1024;

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
    this.logger = options.logger || console;
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
    const deviceId = this._resolveDeviceId(client, payload);
    const registry = this.pairingService.deviceRegistry;
    if (!deviceId || !registry.isTrusted(deviceId)) {
      this.sendToClient(clientId, { type: 'error', message: 'Device not paired' });
      return;
    }

    const device = registry.getDevice(deviceId);
    this.connectionManager.setDevice(clientId, device);
    registry.updateLastSeen(deviceId);

    const result = await this.commandRouter.route(payload.message);
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
    this.sendToClient(clientId, { type: 'pair-success' });
  }

  _resolveDeviceId(client, payload) {
    const payloadDeviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
    if (client?.deviceId && payloadDeviceId && client.deviceId !== payloadDeviceId) return '';
    return client?.deviceId || payloadDeviceId;
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
