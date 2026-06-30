(function () {
  'use strict';

  const TARGET_SAMPLE_RATE = 16000;
  const FRAME_DURATION_MS = 20;
  const FRAME_SAMPLE_COUNT = Math.round((TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000);

  let activeStream = null;
  let audioContext = null;
  let sourceNode = null;
  let analyserNode = null;
  let samplingTimer = null;
  let analysisBuffer = null;
  let frameIndex = 0;
  let streaming = false;
  let framesSent = 0;
  let bytesSent = 0;
  let lastStatsAt = 0;
  let currentRunId = 0;
  let activeRunId = 0;

  function report(event, data) {
    const bridge = window.openxVoiceCapture;
    if (!bridge || typeof bridge.report !== 'function') return;
    bridge.report(event, data || {}).catch(() => {});
  }

  function sendFrame(frame) {
    const bridge = window.openxVoiceCapture;
    if (!bridge || typeof bridge.sendFrame !== 'function') return;
    bridge.sendFrame(frame);
  }

  function resetFrameState() {
    frameIndex = 0;
    framesSent = 0;
    bytesSent = 0;
    lastStatsAt = performance.now();
  }

  function closeAudioGraph() {
    if (samplingTimer) {
      clearInterval(samplingTimer);
      samplingTimer = null;
    }
    if (analyserNode) {
      analyserNode.disconnect();
      analyserNode = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    analysisBuffer = null;
  }

  function stopCapture(reason, runId) {
    const nextRunId = Math.max(currentRunId + 1, Number(runId) || 0);
    currentRunId = nextRunId;
    streaming = false;
    closeAudioGraph();
    if (activeStream) {
      for (const track of activeStream.getAudioTracks()) {
        track.stop();
      }
      activeStream = null;
    }
    activeRunId = 0;
    report('stopped', { reason: reason || 'stop', runId: currentRunId, framesSent, bytesSent });
  }

  function downsample(samples, inputSampleRate) {
    const sourceRate = Number(inputSampleRate) || TARGET_SAMPLE_RATE;
    if (sourceRate === TARGET_SAMPLE_RATE) return samples;
    const ratio = sourceRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.max(1, Math.floor(samples.length / ratio));
    const output = new Float32Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = index * ratio;
      const left = Math.floor(sourceIndex);
      const right = Math.min(samples.length - 1, left + 1);
      const weight = sourceIndex - left;
      output[index] = samples[left] * (1 - weight) + samples[right] * weight;
    }
    return output;
  }

  function pcmFromSamples(samples) {
    const pcm = new Uint8Array(samples.length * 2);
    let sumSquares = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[index] || 0));
      const sample = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      pcm[index * 2] = sample & 0xff;
      pcm[(index * 2) + 1] = (sample >> 8) & 0xff;
      sumSquares += clamped * clamped;
    }
    return {
      pcm,
      rms: Math.sqrt(sumSquares / Math.max(1, samples.length))
    };
  }

  function buildFrameSamples(inputSamples, inputSampleRate) {
    const downsampled = downsample(inputSamples, inputSampleRate);
    const frameSamples = new Float32Array(FRAME_SAMPLE_COUNT);
    if (downsampled.length === FRAME_SAMPLE_COUNT) return downsampled;
    if (downsampled.length > FRAME_SAMPLE_COUNT) {
      const offset = Math.max(0, downsampled.length - FRAME_SAMPLE_COUNT);
      return downsampled.slice(offset, offset + FRAME_SAMPLE_COUNT);
    }
    frameSamples.set(downsampled);
    return frameSamples;
  }

  function sendCurrentFrame() {
    if (!streaming || !audioContext || !analyserNode || !analysisBuffer) return;
    analyserNode.getFloatTimeDomainData(analysisBuffer);
    const frameSamples = buildFrameSamples(analysisBuffer, audioContext.sampleRate);
    const encoded = pcmFromSamples(frameSamples);
    sendFrame({
      frameIndex,
      timestamp: new Date().toISOString(),
      pcm: encoded.pcm,
      sampleRate: TARGET_SAMPLE_RATE,
      channels: 1,
      bitDepth: 16,
      sampleCount: FRAME_SAMPLE_COUNT,
      durationMs: FRAME_DURATION_MS,
      runId: activeRunId,
      rms: encoded.rms
    });
    frameIndex += 1;
    framesSent += 1;
    bytesSent += encoded.pcm.byteLength;
    const now = performance.now();
    if (framesSent > 0 && (framesSent === 1 || framesSent % 50 === 0 || now - lastStatsAt >= 2500)) {
      lastStatsAt = now;
      report('frames', { framesSent, bytesSent, rms: encoded.rms });
    }
  }

  async function startCapture(options) {
    const requestedRunId = Math.max(currentRunId + 1, Number(options && options.runId) || 0);
    currentRunId = requestedRunId;

    if (activeStream) {
      if (activeRunId === requestedRunId) {
        report('active', { trackCount: activeStream.getAudioTracks().length, runId: activeRunId, framesSent, bytesSent });
        return;
      }
      const previousRunId = activeRunId;
      closeAudioGraph();
      for (const track of activeStream.getAudioTracks()) {
        track.stop();
      }
      activeStream = null;
      streaming = false;
      activeRunId = 0;
      report('restarting', { previousRunId, runId: requestedRunId, framesSent, bytesSent });
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      report('error', { name: 'MediaDevicesUnavailable', message: 'Microphone capture API is unavailable.' });
      return;
    }

    const requestedSampleRate = Math.max(8000, Math.min(48000, Number(options && options.sampleRate) || TARGET_SAMPLE_RATE));
    const channelCount = Math.max(1, Math.min(2, Number(options && options.channels) || 1));

    try {
      resetFrameState();
      activeStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount,
          sampleRate: requestedSampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      if (currentRunId !== requestedRunId) {
        for (const track of activeStream.getAudioTracks()) {
          track.stop();
        }
        activeStream = null;
        report('stale-start-ignored', { runId: requestedRunId, activeRunId: currentRunId });
        return;
      }
      audioContext = new AudioContext({ sampleRate: requestedSampleRate });
      sourceNode = audioContext.createMediaStreamSource(activeStream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0;
      analysisBuffer = new Float32Array(analyserNode.fftSize);
      sourceNode.connect(analyserNode);
      streaming = true;
      activeRunId = requestedRunId;
      samplingTimer = setInterval(sendCurrentFrame, FRAME_DURATION_MS);
      for (const track of activeStream.getAudioTracks()) {
        track.addEventListener('ended', () => {
          if (activeStream && activeStream.getAudioTracks().every(item => item.readyState === 'ended')) {
            activeStream = null;
          }
          report('track-ended', { label: track.label || 'microphone', framesSent, bytesSent });
        }, { once: true });
      }
      report('started', {
        trackCount: activeStream.getAudioTracks().length,
        requestedSampleRate,
        audioContextSampleRate: audioContext.sampleRate,
        outputSampleRate: TARGET_SAMPLE_RATE,
        channelCount,
        frameDurationMs: FRAME_DURATION_MS,
        runId: activeRunId
      });
    } catch (error) {
      stopCapture('start-failed', currentRunId);
      report('error', {
        name: error && error.name ? String(error.name) : 'MicrophoneError',
        message: error && error.message ? String(error.message) : 'Microphone capture failed.'
      });
    }
  }

  window.addEventListener('beforeunload', () => stopCapture('unload'));

  if (window.openxVoiceCapture) {
    window.openxVoiceCapture.onStart(startCapture);
    window.openxVoiceCapture.onStop(payload => stopCapture(payload && payload.reason, payload && payload.runId));
    window.openxVoiceCapture.ready().catch(() => {});
  }
}());
