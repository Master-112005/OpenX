'use strict';

const TranscriptSegment = require('./TranscriptSegment');

/**
 * Purpose: Represents immutable public STT recognition output.
 * Responsibility: Store full transcript, final transcript, confidence, duration, segments, partial/final flag, and processing metadata.
 * Dependencies: TranscriptSegment.
 * Lifecycle: Created for every partial and final result emitted by STTEngine.
 * Future extension notes: Normalization and command parsing must happen outside this object in later phases.
 */
class TranscriptResult {
  /**
   * Create a transcript result.
   * @param {{transcript?: string, finalTranscript?: string, confidence?: number, durationMs?: number, segments?: TranscriptSegment[]|object[], partial?: boolean, metadata?: object}} options Result options.
   */
  constructor(options = {}) {
    this.transcript = String(options.transcript || '').trim();
    this.finalTranscript = String(options.finalTranscript || '').trim();
    this.confidence = TranscriptResult._clamp(Number(options.confidence) || 0, 0, 1);
    this.durationMs = Math.max(0, Number(options.durationMs) || 0);
    this.segments = Array.isArray(options.segments)
      ? options.segments.map(segment => segment instanceof TranscriptSegment ? segment : new TranscriptSegment(segment))
      : [];
    this.partial = Boolean(options.partial);
    this.metadata = { ...(options.metadata || {}) };
    Object.freeze(this.segments);
    Object.freeze(this.metadata);
    Object.freeze(this);
  }

  /**
   * Return JSON-safe transcript result.
   * @returns {object}
   */
  toJSON() {
    return {
      transcript: this.transcript,
      finalTranscript: this.finalTranscript,
      confidence: this.confidence,
      durationMs: this.durationMs,
      partial: this.partial,
      segments: this.segments.map(segment => segment.toJSON()),
      metadata: { ...this.metadata }
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

module.exports = TranscriptResult;
