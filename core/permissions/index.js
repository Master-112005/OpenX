const Logger = require('../shared/index').Logger;

const LEVEL_HIERARCHY = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

class PermissionValidator {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.settings = config?.permissions || {
      levels: {
        low: { requiresConfirmation: false, requiresAuth: false },
        medium: { requiresConfirmation: true, requiresAuth: false },
        high: { requiresConfirmation: true, requiresAuth: true },
        critical: { requiresConfirmation: true, requiresAuth: true }
      }
    };
    this.userLevel = config?.permissions?.userLevel || 'medium';
    this.failedAttempts = 0;
    this.maxFailedAttempts = config?.permissions?.maxFailedAttempts || 3;
    this.isAuthenticated = true;
  }

  validate(intent, entities, source) {
    const level = intent.permissionLevel || 'low';
    const levelConfig = this.settings.levels[level];

    if (!levelConfig) {
      return { allowed: false, reason: 'Unknown permission level' };
    }

    const levelValue = LEVEL_HIERARCHY[level] || 0;
    const userLevelValue = LEVEL_HIERARCHY[this.userLevel] || 0;

    if (levelValue > userLevelValue) {
      return {
        allowed: false,
        reason: `Action requires ${level} permission level, current: ${this.userLevel}`,
        requiresConfirmation: false
      };
    }

    if (!this.isAuthenticated && levelConfig.requiresAuth) {
      return {
        allowed: false,
        reason: 'Authentication required for this action',
        requiresConfirmation: true,
        requiresAuth: true
      };
    }

    const confirmationMessage = this._buildConfirmationMessage(intent, entities);

    return {
      allowed: true,
      requiresConfirmation: this.userLevel === 'critical' ? false : levelConfig.requiresConfirmation,
      confirmationMessage
    };
  }

  _buildConfirmationMessage(intent, entities) {
    const parts = [intent.description || 'Perform action'];
    if (entities) {
      for (const [key, value] of Object.entries(entities)) {
        if (value) parts.push(`${key}: ${value}`);
      }
    }
    return parts.join(' - ');
  }

  authenticate(password) {
    if (this.config?.auth?.password && password === this.config.auth.password) {
      this.isAuthenticated = true;
      this.failedAttempts = 0;
      return true;
    }
    this.failedAttempts++;
    if (this.failedAttempts >= this.maxFailedAttempts) {
      this.logger.warn('Maximum authentication attempts exceeded');
    }
    return false;
  }

  setUserLevel(level) {
    if (LEVEL_HIERARCHY[level] !== undefined) {
      this.userLevel = level;
      return true;
    }
    return false;
  }

  getUserLevel() {
    return this.userLevel;
  }

  isActionAllowed(intentId, entities) {
    return true;
  }

  getLevels() {
    return Object.keys(LEVEL_HIERARCHY);
  }
}

module.exports = PermissionValidator;
