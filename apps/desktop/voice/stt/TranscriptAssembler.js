'use strict';

const TranscriptSegment = require('./TranscriptSegment');
const TranscriptResult = require('./TranscriptResult');

/**
 * Purpose: Assembles stable streaming transcripts from evolving recognizer hypotheses.
 * Responsibility: Receive partial/final hypotheses, preserve ordering, remove duplicate updates, and produce TranscriptResult objects.
 * Dependencies: TranscriptSegment and TranscriptResult.
 * Lifecycle: Reset at recognition start, updated for every partial hypothesis, finalized when STTEngine final() is called.
 * Future extension notes: Do not add NLP, punctuation correction, or text normalization here; preserve model output only.
 */
class TranscriptAssembler {
  /**
   * Create an empty transcript assembler.
   */
  constructor() {
    this.partialSegments = [];
    this.finalSegments = [];
    this.lastPartialText = '';
    this.startedAt = null;
  }

  /**
   * Start a transcript assembly window.
   * @param {Date|string} startedAt Recognition start timestamp.
   * @returns {{started: boolean}}
   */
  start(startedAt = new Date()) {
    this.startedAt = new Date(startedAt);
    return { started: true };
  }

  /**
   * Add a streaming partial hypothesis.
   * @param {string|object} hypothesis Recognizer hypothesis.
   * @returns {TranscriptResult}
   */
  addPartial(hypothesis) {
    const segment = this._createSegment(hypothesis, true);
    if (segment.text && segment.text !== this.lastPartialText) {
      this.partialSegments.push(segment);
      this.lastPartialText = segment.text;
    }
    return this.getPartialResult();
  }

  /**
   * Compatibility method for legacy callers.
   * @param {string} fragment Transcript fragment.
   * @returns {number}
   */
  addFragment(fragment) {
    this.addPartial({ text: fragment, confidence: 0, partial: true });
    return this.partialSegments.length;
  }

  /**
   * Add a final hypothesis segment.
   * @param {string|object} hypothesis Recognizer hypothesis.
   * @returns {TranscriptResult}
   */
  addFinal(hypothesis) {
    const segment = this._createSegment(hypothesis, false);
    if (segment.text) {
      const duplicate = this.finalSegments.some(existing => existing.text === segment.text && existing.segmentId === segment.segmentId);
      if (!duplicate) this.finalSegments.push(segment);
    }
    return this.getFinalResult();
  }

  /**
   * Return the latest partial result.
   * @returns {TranscriptResult}
   */
  getPartialResult() {
    const text = this.partialSegments.length
      ? this.partialSegments[this.partialSegments.length - 1].text
      : this._joinSegments(this.finalSegments);
    const segments = this.finalSegments.concat(this.partialSegments.slice(-1));
    return new TranscriptResult({
      transcript: text,
      finalTranscript: this._joinSegments(this.finalSegments),
      confidence: this._averageConfidence(segments),
      durationMs: this._durationMs(),
      segments,
      partial: true,
      metadata: { stableSegmentCount: this.finalSegments.length }
    });
  }

  /**
   * Return the final transcript result.
   * @returns {TranscriptResult}
   */
  getFinalResult() {
    const finalSegments = this.finalSegments.length
      ? this.finalSegments
      : this.partialSegments.slice(-1).map(segment => new TranscriptSegment({ ...segment.toJSON(), partial: false }));
    const finalTranscript = this._joinSegments(finalSegments);
    return new TranscriptResult({
      transcript: finalTranscript,
      finalTranscript,
      confidence: this._averageConfidence(finalSegments),
      durationMs: this._durationMs(),
      segments: finalSegments,
      partial: false,
      metadata: { stableSegmentCount: finalSegments.length }
    });
  }

  /**
   * Return the assembled transcript string.
   * @returns {string}
   */
  assemble() {
    return this.getFinalResult().finalTranscript || this.getPartialResult().transcript;
  }

  /**
   * Clear transcript assembly state.
   * @returns {{cleared: boolean}}
   */
  reset() {
    this.partialSegments = [];
    this.finalSegments = [];
    this.lastPartialText = '';
    this.startedAt = null;
    return { cleared: true };
  }

  /**
   * Create a transcript segment from a hypothesis.
   * @param {string|object} hypothesis Hypothesis.
   * @param {boolean} partial Whether the segment is partial.
   * @returns {TranscriptSegment}
   * @private
   */
  _createSegment(hypothesis, partial) {
    const payload = typeof hypothesis === 'string' ? { text: hypothesis } : { ...(hypothesis || {}) };
    return new TranscriptSegment({
      text: payload.text,
      confidence: payload.confidence,
      timestamp: payload.timestamp,
      segmentId: payload.segmentId || `segment-${partial ? 'partial' : 'final'}-${this.partialSegments.length + this.finalSegments.length}`,
      frameIndex: Number.isInteger(payload.frameIndex) ? payload.frameIndex : -1,
      partial
    });
  }

  /**
   * Join segment text while removing adjacent duplicate strings.
   * @param {TranscriptSegment[]} segments Segments.
   * @returns {string}
   * @private
   */
  _joinSegments(segments) {
    const parts = [];
    for (const segment of segments) {
      if (segment.text && parts[parts.length - 1] !== segment.text) {
        parts.push(segment.text);
      }
    }
    return parts.join(' ').trim();
  }

  /**
   * Average segment confidence.
   * @param {TranscriptSegment[]} segments Segments.
   * @returns {number}
   * @private
   */
  _averageConfidence(segments) {
    const usable = segments.filter(segment => segment.text);
    if (!usable.length) return 0;
    return usable.reduce((sum, segment) => sum + segment.confidence, 0) / usable.length;
  }

  /**
   * Return recognition duration.
   * @returns {number}
   * @private
   */
  _durationMs() {
    if (!this.startedAt) return 0;
    return Math.max(0, Date.now() - this.startedAt.getTime());
  }
}

module.exports = TranscriptAssembler;
