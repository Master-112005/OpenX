const assert = require('assert');

const { QRPairingService } = require('../../core/phone');

function createPairingService(tokens) {
  const invalidated = [];
  let index = 0;
  return {
    invalidated,
    tokenManager: {
      invalidateToken(token) {
        invalidated.push(token);
        return true;
      }
    },
    async createPairingToken() {
      const value = tokens[Math.min(index, tokens.length - 1)];
      index += 1;
      return { success: true, ...value };
    }
  };
}

describe('Phone QR pairing', function() {
  it('prefers a reachable Wi-Fi or Ethernet address over virtual adapters', function() {
    const networkInterfaces = {
      'CloudflareWARP': [
        { family: 'IPv4', internal: false, address: '172.16.0.2' }
      ],
      'vEthernet (WSL (Hyper-V firewall))': [
        { family: 'IPv4', internal: false, address: '172.23.0.1' }
      ],
      'Wi-Fi': [
        { family: 'IPv4', internal: false, address: '10.209.9.148' }
      ],
      'Loopback Pseudo-Interface 1': [
        { family: 'IPv4', internal: true, address: '127.0.0.1' }
      ]
    };

    assert.equal(QRPairingService.resolveDesktopIpv4(networkInterfaces), '10.209.9.148');
    assert.deepEqual(QRPairingService.resolveDesktopIpv4Candidates(networkInterfaces), [
      '10.209.9.148',
      '172.16.0.2',
      '172.23.0.1'
    ]);
  });

  it('generates a PNG data URL for the required pairing payload', async function() {
    const pairingService = createPairingService([{ token: 'ABC123XY', expiresAt: 301000 }]);
    const service = new QRPairingService({
      pairingService,
      serverPort: 8080,
      resolveServerIp: () => '192.168.1.20',
      now: () => 1000
    });

    try {
      const result = await service.generatePairingQR();
      assert.equal(result.success, true);
      assert.match(result.qrDataUrl, /^data:image\/png;base64,/);
      assert.deepEqual(result.payload, {
        serverIp: '192.168.1.20',
        serverIpCandidates: [
          '192.168.1.20',
          ...QRPairingService.resolveDesktopIpv4Candidates().filter(address => address !== '127.0.0.1')
        ].filter((address, index, addresses) => addresses.indexOf(address) === index),
        serverPort: 8080,
        pairingToken: 'ABC123XY',
        expiresAt: 301000,
        protocolVersion: 1
      });
      assert.deepEqual(Object.keys(result.payload).sort(), [
        'expiresAt', 'pairingToken', 'protocolVersion', 'serverIp', 'serverIpCandidates', 'serverPort'
      ]);
      assert.deepEqual(service.getPairingPayload(), result.payload);
    } finally {
      service.destroy();
    }
  });

  it('invalidates and logs an expired QR pairing token', async function() {
    let now = 1000;
    let expirationCallback;
    const logs = [];
    const pairingService = createPairingService([{ token: 'ABC123XY', expiresAt: 301000 }]);
    const service = new QRPairingService({
      pairingService,
      resolveServerIp: () => '10.0.0.5',
      now: () => now,
      setTimeout(callback) {
        expirationCallback = callback;
        return { unref() {} };
      },
      clearTimeout() {},
      logger: { info(message) { logs.push(message); }, warn() {} }
    });

    await service.generatePairingQR();
    now = 301000;
    expirationCallback();

    assert.equal(service.getPairingPayload(), null);
    assert.deepEqual(pairingService.invalidated, ['ABC123XY']);
    assert.ok(logs.includes('[PHONE] QR generated'));
    assert.ok(logs.includes('[PHONE] QR expired'));
  });

  it('generates a new QR and invalidates the previous token', async function() {
    const pairingService = createPairingService([
      { token: 'ABC123XY', expiresAt: 301000 },
      { token: 'NEW456QR', expiresAt: 302000 }
    ]);
    const service = new QRPairingService({
      pairingService,
      resolveServerIp: () => '172.16.0.4',
      now: () => 1000
    });

    try {
      const first = await service.generatePairingQR();
      const second = await service.generatePairingQR();
      assert.equal(first.payload.pairingToken, 'ABC123XY');
      assert.equal(second.payload.pairingToken, 'NEW456QR');
      assert.deepEqual(pairingService.invalidated, ['ABC123XY']);
      assert.deepEqual(service.getPairingPayload(), second.payload);
    } finally {
      service.destroy();
    }
  });

  it('does not generate a QR when identity-protected token creation fails', async function() {
    const service = new QRPairingService({
      pairingService: {
        tokenManager: { invalidateToken() {} },
        createPairingToken: async () => ({
          success: false,
          message: 'Identity verification required.'
        })
      }
    });

    assert.deepEqual(await service.generatePairingQR(), {
      success: false,
      message: 'Identity verification required.'
    });
    assert.equal(service.getPairingPayload(), null);
  });
});
