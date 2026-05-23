const EventEmitter = require('events');

class VoiceActivityDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    this.threshold = Number(config.threshold ?? 0.015);
  }

  evaluate(frame = {}) {
    const rms = Number.isFinite(frame.rms)
      ? Number(frame.rms)
      : this._calculateRms(frame.samples);
    const vadDecision = frame.webrtcVad !== undefined ? Boolean(frame.webrtcVad) : true;
    const speechDetected = vadDecision && rms >= this.threshold;
    const detail = {
      speechDetected,
      vadDecision,
      rms,
      threshold: this.threshold
    };

    this.emit(speechDetected ? 'speech' : 'silence', detail);
    return detail;
  }

  _calculateRms(samples) {
    if (!Array.isArray(samples) && !ArrayBuffer.isView(samples)) {
      return 0;
    }

    if (samples.length === 0) {
      return 0;
    }

    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const value = Number(samples[index]) || 0;
      sum += value * value;
    }

    return Math.sqrt(sum / samples.length);
  }
}

module.exports = VoiceActivityDetector;
