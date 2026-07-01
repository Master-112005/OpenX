'use strict';

const ProcessingConfiguration = require('./ProcessingConfiguration');

const DEFAULT_CLASSIFIER_CONFIGURATION = Object.freeze({
  enabled: true,
  minimumSpeechConfidence: 0.18,
  possibleSpeechConfidence: 0.08,
  minimumRms: 0.001,
  maximumZeroCrossingRate: 0.48,
  maximumClippingRatio: 0.18,
  minimumCandidateFrames: 2
});

/**
 * Purpose: Validate processed microphone audio as an intentional speech source before STT consumes it.
 * Responsibility: Reject obvious non-speech, transient noise, media/system hints, and unstable candidates while preserving validated speech endpoints.
 * Dependencies: ProcessingConfiguration for frame timing defaults.
 * Thread ownership: VoiceSessionManager owns this classifier and resets it at recognition boundaries.
 * Future integration notes: A local embedding or wake-word proximity model can replace the heuristics behind this API without changing STT.
 */
class SpeechSourceClassifier {
  /**
   * Create a source classifier.
   * @param {{configuration?: object|ProcessingConfiguration, clock?: () => Date}} dependencies Classifier dependencies.
   */
  constructor(dependencies = {}) {
    this.processingConfiguration = dependencies.configuration instanceof ProcessingConfiguration
      ? dependencies.configuration
      : new ProcessingConfiguration(dependencies.configuration || {});
    this.configuration = {
      ...DEFAULT_CLASSIFIER_CONFIGURATION,
      ...(dependencies.sourceConfiguration || dependencies.speechSourceValidation || {})
    };
    this.clock = dependencies.clock || (() => new Date());
    this.reset();
  }

  /**
   * Classify a processed frame before recognition.
   * @param {object} frame ProcessedAudioFrame-like object.
   * @returns {{accepted: boolean, reason: string, classification: string, confidence: number, metrics: object, segment: object, at: string}}
   */
  classify(frame = {}) {
    this.metrics.framesEvaluated += 1;
    if (!this.configuration.enabled) {
      return this._accept('classifier-disabled', frame, this._measure(frame));
    }

    const measurements = this._measure(frame);
    const state = String(frame.speechActivityState || '').toUpperCase();
    const confidence = this._clamp(Number(frame.speechConfidence) || 0);
    const metadata = frame.processingMetadata || {};
    const sourceHint = String(metadata.sourceHint || metadata.sourceType || metadata.audioSource || '').toLowerCase();
    const explicitNonSpeech = metadata.nonSpeech === true || metadata.mediaPlayback === true || metadata.systemAudioLeak === true;

    if (explicitNonSpeech || /media|music|television|tv|speaker|system|notification|alarm|ringtone|background/.test(sourceHint)) {
      this._resetSegment();
      return this._reject('audio-source-hint-rejected', frame, measurements, 'background-audio');
    }

    if (frame.endpointCandidate) {
      if (this.segment.validated) {
        const decision = this._accept('validated-speech-endpoint', frame, measurements);
        this._resetSegment();
        return decision;
      }
      this._resetSegment();
      return this._reject('endpoint-without-validated-speech', frame, measurements, 'non-speech');
    }

    if (this.segment.validated && this._isValidatedSegmentContinuation(state, confidence, metadata)) {
      this.segment.durationMs += this._frameDuration(frame);
      this.segment.acceptedFrames += 1;
      const reason = state.includes('SILENCE') || state.includes('END')
        ? 'validated-speech-tail'
        : 'validated-speech-continuation';
      return this._accept(reason, frame, measurements);
    }

    const speechCue = this._hasSpeechCue(state, confidence);
    if (!speechCue) {
      if (state.includes('SILENCE') || state === 'UNKNOWN') this._resetSegment();
      return this._reject('no-speech-cue', frame, measurements, 'non-speech');
    }

    this.segment.candidateFrames += 1;
    this.segment.durationMs += this._frameDuration(frame);

    if (measurements.rms < this.configuration.minimumRms && confidence < this.configuration.minimumSpeechConfidence) {
      return this._reject('low-energy-candidate', frame, measurements, 'low-confidence');
    }

    if (state.includes('POSSIBLE') && this.segment.candidateFrames < this.configuration.minimumCandidateFrames) {
      return this._reject('unstable-speech-candidate', frame, measurements, 'unstable-candidate');
    }

    if (measurements.zeroCrossingRate > this.configuration.maximumZeroCrossingRate && confidence < 0.65) {
      return this._reject('transient-or-mechanical-noise', frame, measurements, 'transient-noise');
    }

    if (measurements.clippingRatio > this.configuration.maximumClippingRatio && confidence < 0.85) {
      return this._reject('clipped-electronic-audio', frame, measurements, 'electronic-audio');
    }

    this.segment.validated = true;
    this.segment.acceptedFrames += 1;
    return this._accept('validated-human-speech', frame, measurements);
  }

  /**
   * Reset rolling segment state and keep aggregate metrics.
   * @returns {{reset: boolean}}
   */
  reset() {
    this.segment = {
      candidateFrames: 0,
      acceptedFrames: 0,
      rejectedFrames: 0,
      durationMs: 0,
      validated: false
    };
    this.lastDecision = null;
    this.metrics = this.metrics || {
      framesEvaluated: 0,
      acceptedSpeech: 0,
      rejectedSpeech: 0,
      rejectedNonSpeech: 0,
      rejectedBackgroundAudio: 0,
      rejectedTransientNoise: 0,
      rejectedElectronicAudio: 0,
      rejectedLowConfidence: 0,
      rejectedUnstableCandidates: 0,
      acceptedEndpoints: 0
    };
    return { reset: true };
  }

  /**
   * Return classifier status.
   * @returns {object}
   */
  getStatus() {
    return {
      enabled: Boolean(this.configuration.enabled),
      segment: { ...this.segment },
      lastDecision: this.lastDecision ? { ...this.lastDecision } : null
    };
  }

  /**
   * Return aggregate classifier metrics.
   * @returns {object}
   */
  getMetrics() {
    return { ...this.metrics };
  }

  _hasSpeechCue(state, confidence) {
    if (state.includes('SPEECH')) return true;
    if (state.includes('POSSIBLE') && confidence >= this.configuration.possibleSpeechConfidence) return true;
    return confidence >= this.configuration.minimumSpeechConfidence;
  }

  _isValidatedSegmentContinuation(state, confidence, metadata = {}) {
    if (state.includes('SPEECH') || state.includes('POSSIBLE') || state.includes('END')) return true;
    const silenceDurationMs = Number(metadata.silenceDurationMs) || 0;
    const allowedTailMs = this.processingConfiguration.endpointSilenceDurationMs + this.processingConfiguration.frameSizeMs;
    if (state.includes('SILENCE') && silenceDurationMs <= allowedTailMs) return true;
    return confidence >= this.configuration.possibleSpeechConfidence;
  }

  _accept(reason, frame, measurements) {
    this.metrics.acceptedSpeech += 1;
    if (frame.endpointCandidate) this.metrics.acceptedEndpoints += 1;
    return this._decision(true, reason, frame, measurements, 'human-speech');
  }

  _reject(reason, frame, measurements, classification) {
    this.segment.rejectedFrames += 1;
    this.metrics.rejectedSpeech += 1;
    const metricByClassification = {
      'non-speech': 'rejectedNonSpeech',
      'background-audio': 'rejectedBackgroundAudio',
      'transient-noise': 'rejectedTransientNoise',
      'electronic-audio': 'rejectedElectronicAudio',
      'low-confidence': 'rejectedLowConfidence',
      'unstable-candidate': 'rejectedUnstableCandidates'
    };
    const key = metricByClassification[classification] || 'rejectedNonSpeech';
    this.metrics[key] += 1;
    return this._decision(false, reason, frame, measurements, classification);
  }

  _decision(accepted, reason, frame, measurements, classification) {
    const decision = {
      accepted,
      reason,
      classification,
      confidence: this._clamp(Number(frame.speechConfidence) || measurements.rms || 0),
      metrics: measurements,
      segment: { ...this.segment },
      frameIndex: Number.isInteger(frame?.originalFrame?.frameIndex) ? frame.originalFrame.frameIndex : null,
      speechActivityState: String(frame.speechActivityState || 'UNKNOWN'),
      endpointCandidate: Boolean(frame.endpointCandidate),
      at: this.clock().toISOString()
    };
    this.lastDecision = decision;
    return decision;
  }

  _measure(frame = {}) {
    const pcm = this._pcmBufferFromFrame(frame);
    if (!pcm.length) return { rms: 0, peak: 0, zeroCrossingRate: 0, clippingRatio: 0, samples: 0 };
    let sumSquares = 0;
    let peak = 0;
    let samples = 0;
    let signChanges = 0;
    let clipped = 0;
    let previousSign = 0;
    for (let index = 0; index + 1 < pcm.length; index += 2) {
      const sample = pcm.readInt16LE(index) / 32768;
      const abs = Math.abs(sample);
      const sign = sample >= 0 ? 1 : -1;
      sumSquares += sample * sample;
      peak = Math.max(peak, abs);
      if (abs >= 0.98) clipped += 1;
      if (previousSign && sign !== previousSign) signChanges += 1;
      previousSign = sign;
      samples += 1;
    }
    if (!samples) return { rms: 0, peak: 0, zeroCrossingRate: 0, clippingRatio: 0, samples: 0 };
    return {
      rms: this._round(Math.sqrt(sumSquares / samples)),
      peak: this._round(peak),
      zeroCrossingRate: this._round(signChanges / samples),
      clippingRatio: this._round(clipped / samples),
      samples
    };
  }

  _pcmBufferFromFrame(frame = {}) {
    if (typeof frame.getPcmBuffer === 'function') return Buffer.from(frame.getPcmBuffer());
    if (frame.cleanedPcm) return Buffer.from(frame.cleanedPcm);
    if (frame.pcm) return Buffer.from(frame.pcm);
    if (frame.originalFrame && typeof frame.originalFrame.getPcmBuffer === 'function') {
      return Buffer.from(frame.originalFrame.getPcmBuffer());
    }
    return Buffer.alloc(0);
  }

  _frameDuration(frame = {}) {
    return Number(frame.originalFrame?.durationMs) || Number(frame.durationMs) || this.processingConfiguration.frameSizeMs;
  }

  _resetSegment() {
    this.segment = {
      candidateFrames: 0,
      acceptedFrames: 0,
      rejectedFrames: 0,
      durationMs: 0,
      validated: false
    };
  }

  _clamp(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  _round(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 10000) / 10000;
  }
}

SpeechSourceClassifier.DEFAULTS = DEFAULT_CLASSIFIER_CONFIGURATION;

module.exports = SpeechSourceClassifier;
