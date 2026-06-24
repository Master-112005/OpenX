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
        serverPort: 8080,
        pairingToken: 'ABC123XY',
        expiresAt: 301000
      });
      assert.deepEqual(Object.keys(result.payload).sort(), [
        'expiresAt', 'pairingToken', 'serverIp', 'serverPort'
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
