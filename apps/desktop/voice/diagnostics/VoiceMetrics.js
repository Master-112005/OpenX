'use strict';

/**
 * Purpose: Defines the future Voice metrics boundary.
 * Responsibility: Provide a no-op metric recorder interface.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Timing, counters, and health metrics can be introduced without changing callers.
 */
class VoiceMetrics {
  /**
   * Placeholder counter increment.
   * @param {string} name Metric name.
   * @param {number} value Increment value.
   * @returns {{recorded: boolean, name: string, value: number}}
   */
  increment(name, value = 1) {
    return { recorded: false, name: String(name || ''), value: Number(value) || 0 };
  }

  /**
   * Placeholder duration recording.
   * @param {string} name Metric name.
   * @param {number} milliseconds Duration in milliseconds.
   * @returns {{recorded: boolean, name: string, milliseconds: number}}
   */
  timing(name, milliseconds) {
    return {
      recorded: false,
      name: String(name || ''),
      milliseconds: Math.max(0, Number(milliseconds) || 0)
    };
  }
}

module.exports = VoiceMetrics;
