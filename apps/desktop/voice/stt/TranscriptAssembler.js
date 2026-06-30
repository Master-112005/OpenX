'use strict';

/**
 * Purpose: Defines future transcript assembly from recognition fragments.
 * Responsibility: Keep fragment ordering and transcript finalization separate from STT engines.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Streaming partials and final transcript merging can be added here later.
 */
class TranscriptAssembler {
  /**
   * Create an empty assembler.
   */
  constructor() {
    this.fragments = [];
  }

  /**
   * Store a placeholder fragment string.
   * @param {string} fragment Transcript fragment.
   * @returns {number}
   */
  addFragment(fragment) {
    this.fragments.push(String(fragment || ''));
    return this.fragments.length;
  }

  /**
   * Return the placeholder assembled transcript.
   * @returns {string}
   */
  assemble() {
    return this.fragments.filter(Boolean).join(' ').trim();
  }

  /**
   * Clear stored placeholder fragments.
   * @returns {{cleared: boolean}}
   */
  reset() {
    this.fragments = [];
    return { cleared: true };
  }
}

module.exports = TranscriptAssembler;
