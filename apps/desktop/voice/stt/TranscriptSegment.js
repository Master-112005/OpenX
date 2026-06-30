'use strict';

/**
 * Purpose: Represents one immutable streaming transcript segment.
 * Responsibility: Store segment text, confidence, timestamp, ordering id, and partial/final status.
 * Dependencies: None.
 * Lifecycle: Created by TranscriptAssembler from decoder hypotheses and included in TranscriptResult snapshots.
 * Future extension notes: Timing/alignment metadata can be added here without changing STTEngine's public methods.
 */
class TranscriptSegment {
  /**
   * Create a transcript segment.
   * @param {{text?: string, confidence?: number, timestamp?: Date|string, segmentId?: string, partial?: boolean, frameIndex?: number}} options Segment options.
   */
  constructor(options = {}) {
    this.text = String(options.text || '').trim();
    this.confidence = TranscriptSegment._clamp(Number(options.confidence) || 0, 0, 1);
    this.timestamp = options.timestamp ? new Date(options.timestamp) : new Date();
    this.segmentId = String(options.segmentId || `segment-${this.timestamp.getTime()}`);
    this.partial = Boolean(options.partial);
    this.frameIndex = Number.isInteger(options.frameIndex) ? options.frameIndex : -1;
    Object.freeze(this);
  }

  /**
   * Return JSON-safe segment data.
   * @returns {object}
   */
  toJSON() {
    return {
      text: this.text,
      confidence: this.confidence,
      timestamp: this.timestamp.toISOString(),
      segmentId: this.segmentId,
      partial: this.partial,
      frameIndex: this.frameIndex
    };
  }

  /**
   * Clamp a numeric value.
   * @param {number} value Candidate value.
   * @param {number} min Minimum.
   * @param {number} max Maximum.
   * @returns {number}
   * @private
   */
  static _clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}

module.exports = TranscriptSegment;
