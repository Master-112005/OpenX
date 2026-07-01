'use strict';

const { AnimationFailure } = require('./VoiceUIErrors');

/**
 * Purpose: Coordinates Voice UI animation metadata.
 * Responsibility: Select and count visual transitions without touching recognition state.
 * Dependencies: Optional logger and clock.
 * Lifecycle: Triggered by VoiceOverlay after state rendering.
 * Future extension notes: Renderer animation implementations can subscribe to these metadata events.
 */
class VoiceAnimationController {
  /**
   * Create an animation controller.
   * @param {{reducedMotion?: boolean, logger?: object, clock?: Function}} options Animation options.
   */
  constructor(options = {}) {
    this.reducedMotion = options.reducedMotion === true;
    this.logger = options.logger || null;
    this.clock = options.clock || (() => new Date());
    this.currentAnimation = 'none';
    this.metrics = {
      animationCount: 0,
      suppressedDuplicates: 0,
      lastAnimation: 'none',
      lastTriggeredAt: null
    };
    this.lastSignature = '';
    this.duplicateWindowMs = Number(options.duplicateWindowMs) || 120;
  }

  /**
   * Trigger a named UI animation.
   * @param {string} animation Animation name.
   * @param {object} context Animation metadata.
   * @returns {{animation: string, skipped: boolean, at: string, context: object}}
   */
  trigger(animation, context = {}) {
    const requested = String(animation || 'none');
    if (!requested) {
      throw new AnimationFailure('Voice animation name is invalid.');
    }
    const selected = this.reducedMotion && !['none', 'fade-out'].includes(requested) ? 'none' : requested;
    const now = this.clock();
    const signature = `${selected}:${String(context.state || '')}`;
    const lastTime = this.metrics.lastTriggeredAt ? Date.parse(this.metrics.lastTriggeredAt) : 0;
    if (signature === this.lastSignature && now.getTime() - lastTime <= this.duplicateWindowMs) {
      this.metrics.suppressedDuplicates += 1;
      return Object.freeze({
        animation: selected,
        skipped: true,
        at: now.toISOString(),
        context: Object.freeze({ ...context }),
        reason: 'duplicate-animation'
      });
    }
    const result = Object.freeze({
      animation: selected,
      skipped: selected !== requested,
      at: now.toISOString(),
      context: Object.freeze({ ...context })
    });
    this.currentAnimation = selected;
    this.metrics.animationCount += 1;
    this.metrics.lastAnimation = selected;
    this.metrics.lastTriggeredAt = result.at;
    this.lastSignature = signature;
    this._log('Animation Triggered', result);
    return result;
  }

  /**
   * Return animation metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Write structured animation logs when available.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Voice UI] ${message}`, metadata);
    }
  }
}

module.exports = VoiceAnimationController;
