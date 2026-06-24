const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DeviceRegistry,
  IdentityVerificationService,
  PairingService,
  PairingTokenManager
} = require('../../core/phone');
const WindowsIdentityVerifier = require('../../apps/desktop/phone-verification');

function createAuditLogger() {
  const entries = [];
  return {
    entries,
    info(message, data) { entries.push({ level: 'info', message, data }); },
    warn(message, data) { entries.push({ level: 'warn', message, data }); }
  };
}

describe('Phone identity verification', function() {
  it('uses the native verifier boundary without requesting credential material', async function() {
    let invocation;
    const verifier = new WindowsIdentityVerifier({
      platform: 'win32',
      execFile(file, args, options, callback) {
        invocation = { file, args, options };
        callback(null, '{"success":true}\n');
      }
    });

    assert.deepEqual(await verifier.verifyIdentity(), { success: true });
    assert.equal(invocation.file, 'powershell.exe');
    const script = Buffer.from(invocation.args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /UserConsentVerifier/);
    assert.doesNotMatch(script, /CredUIPrompt|Get-Credential|LogonUser|password/i);
  });

  it('returns success after native Windows verification succeeds', async function() {
    const logger = createAuditLogger();
    const service = new IdentityVerificationService({
      verifier: { verifyIdentity: async () => ({ success: true }) },
      logger
    });

    assert.deepEqual(await service.verifyIdentity(), { success: true });
    assert.deepEqual(logger.entries.map(entry => entry.message), [
      '[PHONE] Identity verification requested',
      '[PHONE] Identity verification succeeded'
    ]);
  });

  it('fails closed when native Windows verification fails', async function() {
    const logger = createAuditLogger();
    const service = new IdentityVerificationService({
      verifier: { verifyIdentity: async () => ({ success: false, reason: 'verification_canceled' }) },
      logger
    });

    assert.deepEqual(await service.verifyIdentity(), {
      success: false,
      reason: 'verification_failed'
    });
    assert.equal(logger.entries.at(-1).message, '[PHONE] Identity verification failed');
  });

  it('caches only the verification timestamp for ten minutes', async function() {
    let now = 1000;
    let verificationCount = 0;
    const service = new IdentityVerificationService({
      verifier: {
        verifyIdentity: async () => {
          verificationCount += 1;
          return { success: true };
        }
      },
      now: () => now
    });

    await service.verifyIdentity();
    now += 9 * 60 * 1000;
    await service.verifyIdentity();
    assert.equal(verificationCount, 1);
    assert.equal(service.verifiedAt, 1000);

    now = 1000 + 10 * 60 * 1000;
    await service.verifyIdentity();
    assert.equal(verificationCount, 2);
  });

  it('generates and audits a token only after identity verification', async function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-identity-token-'));
    const logger = createAuditLogger();
    const identity = new IdentityVerificationService({
      verifier: { verifyIdentity: async () => ({ success: true }) },
      logger
    });
    const pairing = new PairingService({
      identityVerificationService: identity,
      logger,
      tokenManager: new PairingTokenManager(),
      deviceRegistry: new DeviceRegistry({ filePath: path.join(tempDir, 'devices.json') }),
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json')
    });

    try {
      const result = await pairing.createPairingToken();
      assert.equal(result.success, true);
      assert.match(result.token, /^[A-Z0-9]{8}$/);
      assert.equal(logger.entries.at(-1).message, '[PHONE] Pairing token generated');
    } finally {
      pairing.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects token generation without successful verification', async function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-identity-reject-'));
    const pairing = new PairingService({
      identityVerificationService: { verifyIdentity: async () => ({ success: false }) },
      deviceRegistry: new DeviceRegistry({ filePath: path.join(tempDir, 'devices.json') }),
      pairingPath: path.join(tempDir, 'pairing.json'),
      permissionsPath: path.join(tempDir, 'permissions.json')
    });

    try {
      assert.deepEqual(await pairing.createPairingToken(), {
        success: false,
        message: 'Identity verification required.'
      });
      assert.equal(pairing.tokenManager.tokens.size, 0);
    } finally {
      pairing.destroy();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
