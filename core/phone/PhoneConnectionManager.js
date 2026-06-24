const crypto = require('crypto');

class PhoneConnectionManager {
  constructor(options = {}) {
    this.clients = new Map();
    this.now = options.now || (() => Date.now());
    this.createId = options.createId || (() => crypto.randomUUID());
  }

  add(socket, metadata = {}) {
    let clientId = this.createId();
    while (this.clients.has(clientId)) {
      clientId = this.createId();
    }

    const connectedAt = this.now();
    this.clients.set(clientId, {
      socket,
      connectedAt,
      lastSeen: connectedAt,
      deviceName: metadata.deviceName || 'Unknown device',
      deviceId: metadata.deviceId || null
    });
    return clientId;
  }

  remove(clientId) {
    const client = this.clients.get(clientId);
    this.clients.delete(clientId);
    return client;
  }

  get(clientId) {
    return this.clients.get(clientId);
  }

  touch(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.lastSeen = this.now();
    return true;
  }

  setDevice(clientId, device) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.deviceId = device.deviceId;
    client.deviceName = device.deviceName;
    client.lastSeen = this.now();
    return true;
  }

  clear() {
    this.clients.clear();
  }
}

module.exports = PhoneConnectionManager;
