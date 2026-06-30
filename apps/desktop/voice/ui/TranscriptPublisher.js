'use strict';

/**
 * Purpose: Defines the future transcript publication boundary.
 * Responsibility: Describe how transcript text may be emitted without IPC or assistant integration.
 * Dependencies: None in Phase 1.
 * Future implementation notes: Later phases can adapt this to renderer events or assistant text input.
 */
class TranscriptPublisher {
  /**
   * Placeholder publish method.
   * @param {string} transcript Future transcript text.
   * @returns {{published: boolean, transcript: string}}
   */
  publish(transcript) {
    return { published: false, transcript: String(transcript || '') };
  }
}

module.exports = TranscriptPublisher;
