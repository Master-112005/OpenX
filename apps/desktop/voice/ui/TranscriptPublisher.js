'use strict';

const EventEmitter = require('events');
const VOICE_UI_EVENTS = require('./VoiceUIEvents');

/**
 * Purpose: Publishes transcript text to the Voice overlay.
 * Responsibility: Receive partial/final transcript metadata and update the UI efficiently while preserving text formatting.
 * Dependencies: Optional overlay/window target and Voice UI event names.
 * Lifecycle: Owned by VoiceOverlay and called when VoiceSessionManager emits transcript events.
 * Future extension notes: Do not add transcript normalization, parsing, NLP, or command routing here.
 */
class TranscriptPublisher extends EventEmitter {
  /**
   * Create a transcript publisher.
   * @param {{target?: object, logger?: object}} options Publisher options.
   */
  constructor(options = {}) {
    super();
    this.target = options.target || null;
    this.logger = options.logger || null;
    this.partialTranscript = '';
    this.finalTranscript = '';
    this.updateCount = 0;
    this.suppressedDuplicateCount = 0;
  }

  /**
   * Publish transcript text.
   * @param {string|object} transcript Transcript string or event payload.
   * @param {{partial?: boolean}} options Publish options.
   * @returns {{published: boolean, transcript: string, partial: boolean}}
   */
  publish(transcript, options = {}) {
    const payload = this._normalizeTranscript(transcript, options);
    const previous = payload.partial ? this.partialTranscript : this.finalTranscript;
    if (payload.transcript === previous && payload.transcript) {
      this.suppressedDuplicateCount += 1;
      return { published: false, transcript: payload.transcript, partial: payload.partial, skipped: 'duplicate-transcript' };
    }
    if (payload.partial) {
      this.partialTranscript = payload.transcript;
    } else {
      this.finalTranscript = payload.transcript;
      this.partialTranscript = '';
    }
    this.updateCount += 1;

    if (this.target && typeof this.target.updateTranscript === 'function') {
      this.target.updateTranscript(payload);
    }
    this.emit(VOICE_UI_EVENTS.TRANSCRIPT_UPDATED, Object.freeze(payload));
    this._log(payload.partial ? 'Partial Transcript Updated' : 'Final Transcript Updated', payload);
    return { published: true, ...payload };
  }

  /**
   * Publish a partial transcript update.
   * @param {string|object} transcript Transcript string or event payload.
   * @returns {{published: boolean, transcript: string, partial: boolean}}
   */
  publishPartial(transcript) {
    return this.publish(transcript, { partial: true });
  }

  /**
   * Publish a final transcript update.
   * @param {string|object} transcript Transcript string or event payload.
   * @returns {{published: boolean, transcript: string, partial: boolean}}
   */
  publishFinal(transcript) {
    return this.publish(transcript, { partial: false });
  }

  /**
   * Return transcript publisher state.
   * @returns {{partialTranscript: string, finalTranscript: string, updateCount: number}}
   */
  getState() {
    return {
      partialTranscript: this.partialTranscript,
      finalTranscript: this.finalTranscript,
      updateCount: this.updateCount,
      suppressedDuplicateCount: this.suppressedDuplicateCount
    };
  }

  /**
   * Normalize transcript event shapes.
   * @param {string|object} transcript Transcript input.
   * @param {object} options Publish options.
   * @returns {{transcript: string, partial: boolean}}
   * @private
   */
  _normalizeTranscript(transcript, options = {}) {
    if (transcript && typeof transcript === 'object') {
      const result = transcript.result || transcript.transcriptResult || transcript;
      const metadata = result && typeof result.toJSON === 'function' ? result.toJSON() : result;
      const text = metadata.finalTranscript || metadata.transcript || metadata.text || '';
      return {
        transcript: String(text || ''),
        partial: options.partial !== undefined ? options.partial === true : metadata.partial === true
      };
    }
    return {
      transcript: String(transcript || ''),
      partial: options.partial === true
    };
  }

  /**
   * Write structured transcript logs.
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

module.exports = TranscriptPublisher;
