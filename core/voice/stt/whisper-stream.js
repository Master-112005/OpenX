const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const TranscriptNormalizer = require('../transcript/transcript-normalizer');

class WhisperStreamSpeechEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.voiceConfig = config?.voice || {};
    this.whisperConfig = this.voiceConfig.whisper || {};
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.normalizer = new TranscriptNormalizer();
    this.process = null;
    this.ready = false;
    this.activeSession = null;
    this.restartCount = 0;
    this.maxRestarts = Number(this.whisperConfig.maxRestarts) >= 0
      ? Number(this.whisperConfig.maxRestarts)
      : 3;
  }

  async initialize() {
    const executablePath = this._resolvePath(this.whisperConfig.executablePath || 'bin/whisper/whisper-stream.exe');
    const modelPath = this._resolvePath(this.whisperConfig.modelPath || 'models/whisper/ggml-small.en.bin');

    if (!fs.existsSync(executablePath)) {
      this.ready = false;
      const message = `Whisper executable not found: ${executablePath}`;
      this.emit('error', new Error(message));
      return false;
    }

    if (!fs.existsSync(modelPath)) {
      this.ready = false;
      const message = `Whisper model not found: ${modelPath}`;
      this.emit('error', new Error(message));
      return false;
    }

    this.executablePath = executablePath;
    this.modelPath = modelPath;
    this.ready = true;
    this.emit('ready', {
      event: 'ready',
      backend: 'whisper-stream',
      activationMode: this.voiceConfig.activationMode || 'hotkey'
    });
    return true;
  }

  listen(options = {}) {
    if (!this.ready) {
      this.emit('event', {
        event: 'error',
        message: 'Whisper stream is not ready'
      });
      return;
    }

    const mode = String(options.mode || 'command');
    const startSpeechTimeoutMs = Number(options.startSpeechTimeoutMs) > 0
      ? Number(options.startSpeechTimeoutMs)
      : Number(this.voiceConfig.inactivityTimeoutMs || 30000);
    const maxDurationMs = Number(options.maxDurationMs) > 0
      ? Number(options.maxDurationMs)
      : Number(this.voiceConfig.stt?.maxDurationMs || startSpeechTimeoutMs);

    this.activeSession = {
      mode,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      startSpeechTimeoutMs,
      maxDurationMs,
      chunks: [],
      segments: [],
      finalized: false,
      finalTimer: null,
      inactivityTimer: null
    };

    this.emit('event', {
      event: 'stt_session_activated',
      mode,
      startSpeechTimeoutMs,
      maxDurationMs,
      timeoutMs: startSpeechTimeoutMs,
      timeoutPolicy: 'after-last-speech',
      backend: 'whisper-stream'
    });

    this._ensureProcess();
    this._armSessionInactivityTimer(startSpeechTimeoutMs);
  }

  pause() {
    this._finalizeSession('paused');
    this._stopProcess();
    this.emit('event', { event: 'paused', backend: 'whisper-stream' });
  }

  resume() {
    this.emit('event', { event: 'resumed', backend: 'whisper-stream' });
  }

  shutdown() {
    this._finalizeSession('shutdown');
    this._stopProcess();
    this.ready = false;
    this.removeAllListeners();
  }

  _ensureProcess() {
    if (this.process && !this.process.killed) {
      return;
    }

    const args = this._buildArgs();
    this.process = spawn(this.executablePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.logger.info('[WHISPER] Process launched', {
      executablePath: this.executablePath,
      modelPath: this.modelPath
    });

    this.process.stdout.on('data', (chunk) => {
      this._handleStdout(chunk);
    });

    this.process.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) {
        this.logger.debug('[WHISPER] stderr', message.slice(0, 300));
      }
    });

    this.process.once('error', (error) => {
      this.emit('event', {
        event: 'error',
        message: `Whisper stream failed: ${error.message}`,
        backend: 'whisper-stream'
      });
    });

    this.process.once('exit', (code, signal) => {
      this.process = null;
      if (this.ready && this.activeSession && this.restartCount < this.maxRestarts) {
        this.restartCount += 1;
        this.logger.warn('[WHISPER] Process exited, restarting', { code, signal, restartCount: this.restartCount });
        this._ensureProcess();
        return;
      }

      if (this.activeSession) {
        this._finalizeSession('whisper-exited');
      }
    });
  }

  _handleStdout(chunk) {
    const payloads = String(chunk || '')
      .split(/\r?\n/)
      .map(line => this._parseTranscriptPayload(line))
      .filter(payload => payload && payload.text);

    for (const payload of payloads) {
      if (!this.activeSession || this.activeSession.finalized) {
        continue;
      }

      const text = payload.text;
      this.activeSession.chunks.push(text);
      this.activeSession.segments.push(payload);
      this.activeSession.lastActivityAt = Date.now();
      this._armSessionInactivityTimer(this.activeSession.startSpeechTimeoutMs);
      this._logRawTranscriptPayload(payload);
      this.emit('event', {
        event: 'partial_result',
        text,
        confidence: payload.confidence,
        noSpeechProbability: payload.noSpeechProbability,
        isFinal: false,
        mode: this.activeSession.mode,
        backend: 'whisper-stream'
      });

      if (this.activeSession.finalTimer) {
        clearTimeout(this.activeSession.finalTimer);
      }
      const debounceMs = this._getFinalDebounceMs(this.activeSession);
      this.activeSession.finalTimer = setTimeout(() => {
        this._finalizeSession('final-transcript');
      }, debounceMs);
    }
  }

  _finalizeSession(reason) {
    const session = this.activeSession;
    if (!session || session.finalized) {
      return;
    }

    session.finalized = true;
    if (session.finalTimer) {
      clearTimeout(session.finalTimer);
    }
    if (session.inactivityTimer) {
      clearTimeout(session.inactivityTimer);
    }
    this.activeSession = null;

    const text = this._composeSessionTranscript(session);
    if (!text) {
      this.emit('event', {
        event: 'session_timeout',
        mode: session.mode,
        reason: reason === 'session-timeout' ? 'no-speech-detected' : reason,
        timeoutMs: session.startSpeechTimeoutMs,
        backend: 'whisper-stream'
      });
      return;
    }

    const quality = this._estimateTranscriptQuality(text, session);
    this.emit('event', {
      event: 'result',
      text,
      confidence: quality.confidence,
      noSpeechProbability: quality.noSpeechProbability,
      compressionRatio: quality.compressionRatio,
      chunkCount: session.chunks.length,
      isFinal: true,
      speechDetected: true,
      mode: session.mode,
      backend: 'whisper-stream'
    });
  }

  _armSessionInactivityTimer(timeoutMs) {
    if (!this.activeSession || this.activeSession.finalized) {
      return;
    }

    if (this.activeSession.inactivityTimer) {
      clearTimeout(this.activeSession.inactivityTimer);
    }

    const duration = Math.max(1000, Number(timeoutMs) || 20000);
    this.activeSession.inactivityTimer = setTimeout(() => {
      this._finalizeSession('session-timeout');
    }, duration);
  }

  _parseTranscriptLine(line) {
    return this._parseTranscriptPayload(line)?.text || '';
  }

  _parseTranscriptPayload(line) {
    const raw = this._cleanWhisperOutput(line);
    if (!raw) {
      return null;
    }

    if (/^(?:whisper_|main:|system_info:|sampling|processing|init|error:)/i.test(raw)) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      const text = this._normalizeTranscriptCandidate(parsed.text || parsed.transcript || '');
      if (!text) {
        return null;
      }
      return {
        text,
        raw,
        confidence: this._readNumber(parsed.confidence, parsed.probability, parsed.avg_logprob),
        noSpeechProbability: this._readNumber(parsed.noSpeechProbability, parsed.no_speech_prob, parsed.noSpeechProb),
        compressionRatio: this._readNumber(parsed.compressionRatio, parsed.compression_ratio)
      };
    } catch (error) {}

    const cleaned = raw
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/^\([^)]+\)\s*/g, '')
      .replace(/^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/g, '');

    const text = this._normalizeTranscriptCandidate(cleaned);
    if (!text) {
      return null;
    }
    return { text, raw };
  }

  _estimateTranscriptQuality(text, session = {}) {
    const normalized = this.normalizer.normalize(text);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const uniqueRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0;
    const repeatedChunkRatio = this._repeatedChunkRatio(session.chunks || []);
    const shortPhrase = tokens.length <= 2;
    const conversational = this._looksConversational(normalized);
    const repeatedLeadIn = this._hasRepeatedLeadIn(tokens);
    const knownNoise = this._isNoSpeechMarker(normalized)
      || /^(?:boom|thank you|thanks for watching|music|background music|foreign|silence|subscribe|yes yes)$/i.test(normalized);

    let confidence = 0.88;
    if (tokens.length >= 3) confidence += 0.04;
    if (tokens.length >= 6) confidence += 0.03;
    if (shortPhrase && !conversational) confidence -= 0.18;
    if (uniqueRatio > 0 && uniqueRatio < 0.5) confidence -= 0.18;
    if (repeatedChunkRatio > 0.35) confidence -= 0.18;
    if (repeatedLeadIn) confidence -= 0.45;
    if (knownNoise) confidence -= 0.45;

    const estimatedNoSpeechProbability = Math.max(
      knownNoise ? 0.9 : 0,
      repeatedLeadIn ? 0.88 : 0,
      shortPhrase && !conversational ? 0.62 : 0.18,
      repeatedChunkRatio > 0.35 ? 0.58 : 0.18
    );
    const estimatedCompressionRatio = uniqueRatio > 0 ? 1 / uniqueRatio : 3;
    const measuredConfidence = this._averageSegmentMetric(session.segments, 'confidence');
    const measuredNoSpeechProbability = this._maxSegmentMetric(session.segments, 'noSpeechProbability');
    const measuredCompressionRatio = this._maxSegmentMetric(session.segments, 'compressionRatio');

    return {
      confidence: Math.max(0.1, Math.min(0.96, Number((Number.isFinite(measuredConfidence) ? measuredConfidence : confidence).toFixed(2)))),
      noSpeechProbability: Number(Math.min(0.98, Number.isFinite(measuredNoSpeechProbability) ? measuredNoSpeechProbability : estimatedNoSpeechProbability).toFixed(2)),
      compressionRatio: Number(Math.max(1, Number.isFinite(measuredCompressionRatio) ? measuredCompressionRatio : estimatedCompressionRatio).toFixed(2))
    };
  }

  _getFinalDebounceMs(session = {}) {
    const baseMs = Number(this.whisperConfig.finalDebounceMs) > 0
      ? Number(this.whisperConfig.finalDebounceMs)
      : 1600;
    const incompleteMs = Number(this.whisperConfig.incompleteUtteranceDebounceMs) > 0
      ? Number(this.whisperConfig.incompleteUtteranceDebounceMs)
      : 5000;
    const text = this.normalizer.normalize((session.chunks || []).join(' '));

    return this._isLikelyIncompleteUtterance(text)
      ? Math.max(baseMs, incompleteMs)
      : baseMs;
  }

  _composeSessionTranscript(session = {}) {
    const normalizedChunks = (Array.isArray(session.chunks) ? session.chunks : [])
      .map(chunk => this.normalizer.normalize(chunk))
      .filter(Boolean);
    if (!normalizedChunks.length) {
      return '';
    }

    const compacted = [];
    for (const chunk of normalizedChunks) {
      const previous = compacted[compacted.length - 1];
      if (!previous || previous !== chunk) {
        compacted.push(chunk);
      }
    }

    const last = compacted[compacted.length - 1];
    const lastTokens = this._tokenize(last);
    if (this._hasRepeatedLeadIn(lastTokens)) {
      return last;
    }

    if (compacted.length === 1) {
      return last;
    }

    const previous = compacted[compacted.length - 2];
    const previousTokens = this._tokenize(previous);
    if (previousTokens.length > 0 && lastTokens.length >= previousTokens.length) {
      const prefix = lastTokens.slice(0, previousTokens.length).join(' ');
      if (prefix === previousTokens.join(' ')) {
        return last;
      }
    }

    return this.normalizer.normalize(compacted.join(' '));
  }

  _isLikelyIncompleteUtterance(text) {
    const normalized = this.normalizer.normalize(text);
    if (!normalized || /\s/.test(normalized)) {
      return false;
    }

    return new Set([
      'attach',
      'call',
      'close',
      'copy',
      'create',
      'delete',
      'draft',
      'extract',
      'find',
      'launch',
      'message',
      'minimize',
      'move',
      'open',
      'read',
      'rename',
      'search',
      'send',
      'share',
      'show',
      'switch'
    ]).has(normalized);
  }

  _readNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        return number;
      }
    }
    return undefined;
  }

  _cleanWhisperOutput(value) {
    return String(value || '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _averageSegmentMetric(segments = [], key) {
    const values = (Array.isArray(segments) ? segments : [])
      .map(segment => Number(segment?.[key]))
      .filter(Number.isFinite);
    if (!values.length) {
      return undefined;
    }
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  _maxSegmentMetric(segments = [], key) {
    const values = (Array.isArray(segments) ? segments : [])
      .map(segment => Number(segment?.[key]))
      .filter(Number.isFinite);
    if (!values.length) {
      return undefined;
    }
    return Math.max(...values);
  }

  _logRawTranscriptPayload(payload = {}) {
    const raw = String(payload.raw || '').trim();
    if (!raw) {
      return;
    }

    const metadata = {
      raw: raw.slice(0, 300),
      text: payload.text,
      confidence: Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : null,
      noSpeechProbability: Number.isFinite(Number(payload.noSpeechProbability)) ? Number(payload.noSpeechProbability) : null
    };

    if (this.whisperConfig.logRawOutput === true) {
      this.logger.info('[WHISPER] Raw transcript', metadata);
    } else {
      this.logger.debug('[WHISPER] Raw transcript', metadata);
    }
  }

  _normalizeTranscriptCandidate(value) {
    const normalized = this.normalizer.normalize(value);
    if (!normalized || this._isNoSpeechMarker(normalized)) {
      return '';
    }
    return normalized;
  }

  _tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .map(token => token.replace(/^[^\w]+|[^\w]+$/g, ''))
      .filter(Boolean);
  }

  _hasRepeatedLeadIn(tokens = []) {
    if (!Array.isArray(tokens) || tokens.length < 4) {
      return false;
    }

    const actionTokens = new Set([
      'attach',
      'call',
      'close',
      'copy',
      'create',
      'delete',
      'draft',
      'extract',
      'find',
      'launch',
      'message',
      'minimize',
      'move',
      'open',
      'read',
      'rename',
      'search',
      'send',
      'share',
      'show',
      'switch'
    ]);
    const [lastToken] = tokens.slice(-1);
    if (!actionTokens.has(lastToken)) {
      return false;
    }

    const counts = new Map();
    for (const token of tokens.slice(0, -1)) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }

    return Math.max(...counts.values()) >= 3;
  }

  _isNoSpeechMarker(text) {
    return /^(?:blank audio|blank_audio|no speech|no_speech|nospeech|silence)$/i.test(String(text || '').trim());
  }

  _looksConversational(text) {
    const normalized = String(text || '').trim().toLowerCase();
    return /^(?:hi|hello|hey|good morning|good afternoon|good evening|how are you|help|what can you do|what is your name|whats your name)$/.test(normalized);
  }

  _repeatedChunkRatio(chunks = []) {
    const normalized = chunks
      .map(chunk => this.normalizer.normalize(chunk))
      .filter(Boolean);
    if (normalized.length <= 1) {
      return 0;
    }
    const unique = new Set(normalized);
    return 1 - (unique.size / normalized.length);
  }

  _buildArgs() {
    const args = [
      '-m', this.modelPath,
      '-t', String(this.whisperConfig.threads || 8),
      '--step', String(this.whisperConfig.stepMs || 2000),
      '--length', String(this.whisperConfig.lengthMs || 10000),
      '--keep', String(this.whisperConfig.keepMs || 500),
      '--max-tokens', String(this.whisperConfig.maxTokens || 32),
      '--vad-thold', String(this.whisperConfig.vadThreshold || 0.6),
      '--freq-thold', String(this.whisperConfig.freqThreshold || 100),
      '-l', String(this.whisperConfig.language || this.voiceConfig.stt?.language || 'en')
    ];

    const captureDeviceId = Number(this.whisperConfig.captureDeviceId);
    if (Number.isInteger(captureDeviceId) && captureDeviceId >= 0) {
      args.push('--capture', String(captureDeviceId));
    }

    const audioContext = Number(this.whisperConfig.audioContext);
    if (Number.isInteger(audioContext) && audioContext > 0) {
      args.push('--audio-ctx', String(audioContext));
    }

    if (this.whisperConfig.noFallback !== false) {
      args.push('--no-fallback');
    }

    if (this.whisperConfig.saveAudio === true) {
      args.push('--save-audio');
    }

    if (this.whisperConfig.keepContext === true) {
      args.push('--keep-context');
    }

    return args;
  }

  _stopProcess() {
    if (!this.process) {
      return;
    }

    try {
      const pid = this.process.pid;
      if (pid) {
        spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } else {
        this.process.kill();
      }
    } catch (error) {
      this.logger.warn('Failed to stop whisper stream', error.message);
    }

    this.process = null;
  }

  _resolvePath(value) {
    const raw = String(value || '').trim();
    if (path.isAbsolute(raw)) {
      return raw;
    }
    return path.join(process.cwd(), raw);
  }
}

module.exports = WhisperStreamSpeechEngine;
