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
});
