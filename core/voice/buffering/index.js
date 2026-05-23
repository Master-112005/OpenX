class AudioBufferManager {
  constructor(config = {}) {
    this.frameDurationMs = Number(config.frameDurationMs) > 0 ? Number(config.frameDurationMs) : 20;
    this.preRollDurationMs = Number(config.preRollDurationMs) > 0 ? Number(config.preRollDurationMs) : 400;
    this.maxUtteranceMs = Number(config.maxUtteranceMs) > 0 ? Number(config.maxUtteranceMs) : 12000;
    this.preRollFrameLimit = Math.max(1, Math.ceil(this.preRollDurationMs / this.frameDurationMs));
    this.maxFrameLimit = Math.max(1, Math.ceil(this.maxUtteranceMs / this.frameDurationMs));
    this.preRollFrames = [];
    this.activeFrames = [];
  }

  append(frame) {
    const normalizedFrame = this._normalizeFrame(frame);
    this.preRollFrames.push(normalizedFrame);
    if (this.preRollFrames.length > this.preRollFrameLimit) {
      this.preRollFrames.shift();
    }

    if (this.activeFrames.length > 0) {
      this.activeFrames.push(normalizedFrame);
      if (this.activeFrames.length > this.maxFrameLimit) {
        this.activeFrames = this.activeFrames.slice(-this.maxFrameLimit);
      }
    }

    return normalizedFrame;
  }

  startUtterance() {
    this.activeFrames = [...this.preRollFrames];
  }

  hasActiveUtterance() {
    return this.activeFrames.length > 0;
  }

  getActiveDurationMs() {
    return this.activeFrames.length * this.frameDurationMs;
  }

  finalizeUtterance() {
    const frames = [...this.activeFrames];
    const durationMs = frames.length * this.frameDurationMs;
    this.activeFrames = [];

    return {
      frames,
      durationMs
    };
  }

  reset() {
    this.preRollFrames = [];
    this.activeFrames = [];
  }

  _normalizeFrame(frame) {
    if (Buffer.isBuffer(frame)) {
      return frame;
    }

    if (ArrayBuffer.isView(frame)) {
      return Buffer.from(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    }

    if (frame instanceof ArrayBuffer) {
      return Buffer.from(frame);
    }

    return Buffer.from([]);
  }
}

module.exports = AudioBufferManager;
