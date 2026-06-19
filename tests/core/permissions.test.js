const assert = require('assert');

describe('Permission Validator', function() {
  let PermissionValidator;

  before(function() {
    PermissionValidator = require('../../core/permissions/index');
  });

  it('should allow low permission actions', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: true, requiresAuth: false },
          high: { requiresConfirmation: true, requiresAuth: true }
        }
      }
    });
    const intent = { id: 'volume.up', permissionLevel: 'low', description: 'Increase volume' };
    const result = validator.validate(intent, {});
    assert.ok(result.allowed);
    assert.equal(result.requiresConfirmation, false);
  });

  it('should require confirmation for medium permission', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: true, requiresAuth: false }
        }
      }
    });
    const intent = { id: 'file.delete', permissionLevel: 'medium', description: 'Delete file' };
    const result = validator.validate(intent, { filename: 'test.txt' });
    assert.ok(result.allowed);
    assert.ok(result.requiresConfirmation);
  });

  it('should deny actions above user level', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: true, requiresAuth: false },
          critical: { requiresConfirmation: true, requiresAuth: true }
        }
      }
    });
    validator.setUserLevel('medium');
    const intent = { id: 'system.shutdown', permissionLevel: 'critical', description: 'Shutdown' };
    const result = validator.validate(intent, {});
    assert.ok(!result.allowed);
  });

  it('should build confirmation message', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          medium: { requiresConfirmation: true, requiresAuth: false }
        }
      }
    });
    const intent = { id: 'file.delete', permissionLevel: 'medium', description: 'Delete file' };
    const result = validator.validate(intent, { filename: 'test.txt' });
    assert.ok(result.confirmationMessage.includes('Delete file'));
  });

  it('should keep confirmations enabled when user chooses critical full access', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          medium: { requiresConfirmation: true, requiresAuth: false },
          critical: { requiresConfirmation: true, requiresAuth: true }
        }
      }
    });
    validator.setUserLevel('critical');

    const intent = { id: 'app.close', permissionLevel: 'medium', description: 'Close app' };
    const result = validator.validate(intent, { appName: 'chrome' });

    assert.ok(result.allowed);
    assert.equal(result.requiresConfirmation, true);
  });

  it('should require authentication for high-risk authenticated actions', function() {
    const validator = new PermissionValidator({
      permissions: {
        levels: {
          high: { requiresConfirmation: true, requiresAuth: true }
        }
      }
    });
    validator.setUserLevel('high');

    const intent = { id: 'file.delete', permissionLevel: 'high', description: 'Delete file' };
    const result = validator.validate(intent, { filename: 'secret.txt' });

    assert.equal(result.allowed, false);
    assert.equal(result.requiresAuth, true);
  });
});
