'use strict';

const EventEmitter = require('events');
const AudioConfiguration = require('./AudioConfiguration');
const AudioFrame = require('./AudioFrame');
const AUDIO_EVENTS = require('./AudioEvents');
const { BufferOverflowError } = require('./AudioErrors');

/**
 * Purpose: Manages ordered raw PCM AudioFrame objects for future streaming consumers.
 * Responsibility: Receive frames, preserve ordering, expose sequential reads, flush/reset data, and report metadata.
 * Dependencies: AudioConfiguration, AudioFrame, AudioEvents, and AudioErrors.
 * Thread ownership: This class owns its in-memory frame queue; callers should use read/push APIs rather than mutating internals.
 * Future integration notes: Preprocessing and STT should consume frames from this buffer continuously without requiring one large allocation.
 */
class AudioBuffer {
  /**
   * Create an audio buffer manager.
   * @param {{configuration?: AudioConfiguration|object, maxFrames?: number, overflowStrategy?: 'throw'|'drop-oldest'}} options Buffer options.
   */
  constructor(options = {}) {
    this.configuration = options.configuration instanceof AudioConfiguration
      ? options.configuration
      : new AudioConfiguration(options.configuration || {});
    this.maxFrames = Number(options.maxFrames) || this.configuration.bufferSize;
    this.overflowStrategy = options.overflowStrategy || 'drop-oldest';
    this.frames = [];
    this.readIndex = 0;
    this.metrics = {
      framesReceived: 0,
      framesRead: 0,
      droppedFrames: 0,
      flushCount: 0,
      resetCount: 0
    };
    this.events = new EventEmitter();
  }

  /**
   * Subscribe to a buffer event.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioBuffer}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Remove a buffer event listener.
   * @param {string} eventName Event name from AudioEvents.
   * @param {Function} listener Event listener.
   * @returns {AudioBuffer}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Add one frame to the buffer.
   * @param {AudioFrame|object} frame Audio frame or frame options.
   * @returns {AudioFrame}
   */
  pushFrame(frame) {
    const audioFrame = frame instanceof AudioFrame ? frame : new AudioFrame(frame);
    if (this.frames.length >= this.maxFrames) {
      this._handleOverflow(audioFrame);
    }
    this.frames.push(audioFrame);
    this.metrics.framesReceived += 1;
    this.events.emit(AUDIO_EVENTS.AUDIO_BUFFER_READY, this.getStatus());
    return audioFrame;
  }

  /**
   * Compatibility alias for pushFrame.
   * @param {AudioFrame|object} frame Audio frame or frame options.
   * @returns {AudioFrame}
   */
  write(frame) {
    return this.pushFrame(frame);
  }

  /**
   * Read the next unread frame in sequence.
   * @returns {AudioFrame|null}
   */
  readFrame() {
    if (this.readIndex >= this.frames.length) return null;
    const frame = this.frames[this.readIndex];
    this.readIndex += 1;
    this.metrics.framesRead += 1;
    return frame;
  }

  /**
   * Compatibility alias for readFrame.
   * @returns {AudioFrame|null}
   */
  read() {
    return this.readFrame();
  }

  /**
   * Read up to count sequential frames.
   * @param {number} count Maximum number of frames.
   * @returns {AudioFrame[]}
   */
  readFrames(count = 1) {
    const limit = Math.max(0, Number(count) || 0);
    const frames = [];
    while (frames.length < limit) {
      const frame = this.readFrame();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }

  /**
   * Return the next unread frame without advancing the read cursor.
   * @returns {AudioFrame|null}
   */
  peek() {
    return this.readIndex < this.frames.length ? this.frames[this.readIndex] : null;
  }

  /**
   * Remove all stored frames but keep metrics.
   * @returns {{flushed: boolean, droppedFrames: number}}
   */
  flush() {
    const droppedFrames = this.frames.length;
    this.frames = [];
    this.readIndex = 0;
    this.metrics.flushCount += 1;
    this.events.emit(AUDIO_EVENTS.AUDIO_BUFFER_FLUSHED, this.getStatus());
    return { flushed: true, droppedFrames };
  }

  /**
   * Reset frames, cursor, and metrics.
   * @returns {{reset: boolean}}
   */
  reset() {
    this.frames = [];
    this.readIndex = 0;
    this.metrics = {
      framesReceived: 0,
      framesRead: 0,
      droppedFrames: 0,
      flushCount: 0,
      resetCount: this.metrics.resetCount + 1
    };
    return { reset: true };
  }

  /**
   * Return true when there are no unread frames.
   * @returns {boolean}
   */
  isEmpty() {
    return this.readIndex >= this.frames.length;
  }

  /**
   * Return buffer status metadata.
   * @returns {{frameCount: number, unreadFrameCount: number, maxFrames: number, sampleRate: number, channels: number}}
   */
  getStatus() {
    return {
      frameCount: this.frames.length,
      unreadFrameCount: Math.max(0, this.frames.length - this.readIndex),
      maxFrames: this.maxFrames,
      sampleRate: this.configuration.sampleRate,
      channels: this.configuration.channels
    };
  }

  /**
   * Return buffer metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Return JSON-safe buffer metadata.
   * @returns {object}
   */
  toJSON() {
    return {
      ...this.getStatus(),
      metrics: this.getMetrics(),
      configuration: this.configuration.toJSON()
    };
  }

  /**
   * Apply configured overflow handling.
   * @param {AudioFrame} frame Frame that triggered overflow.
   * @returns {void}
   * @private
   */
  _handleOverflow(frame) {
    if (this.overflowStrategy === 'throw') {
      throw new BufferOverflowError('Audio buffer capacity exceeded.', {
        details: { frame: frame.toMetadata(), maxFrames: this.maxFrames }
      });
    }
    this.frames.shift();
    this.readIndex = Math.max(0, this.readIndex - 1);
    this.metrics.droppedFrames += 1;
  }
}

module.exports = AudioBuffer;
