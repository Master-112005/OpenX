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
    const lines = String(chunk || '')
      .split(/\r?\n/)
      .map(line => this._parseTranscriptLine(line))
      .filter(Boolean);

    for (const text of lines) {
      if (!this.activeSession || this.activeSession.finalized) {
        continue;
      }

      this.activeSession.chunks.push(text);
      this.activeSession.lastActivityAt = Date.now();
      this._armSessionInactivityTimer(this.activeSession.startSpeechTimeoutMs);
      this.emit('event', {
        event: 'partial_result',
        text,
        isFinal: false,
        mode: this.activeSession.mode,
        backend: 'whisper-stream'
      });

      if (this.activeSession.finalTimer) {
        clearTimeout(this.activeSession.finalTimer);
      }
      const debounceMs = Number(this.whisperConfig.finalDebounceMs) > 0
        ? Number(this.whisperConfig.finalDebounceMs)
        : 1200;
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

    const text = this.normalizer.normalize(session.chunks.join(' '));
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
    const raw = String(line || '').trim();
    if (!raw) {
      return '';
    }

    if (/^(?:whisper_|main:|system_info:|sampling|processing|init|error:)/i.test(raw)) {
      return '';
    }

    try {
      const parsed = JSON.parse(raw);
      return this._normalizeTranscriptCandidate(parsed.text || parsed.transcript || '');
    } catch (error) {}

    const cleaned = raw
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/^\([^)]+\)\s*/g, '')
      .replace(/^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/g, '');

    return this._normalizeTranscriptCandidate(cleaned);
  }

  _estimateTranscriptQuality(text, session = {}) {
    const normalized = this.normalizer.normalize(text);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const uniqueRatio = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0;
    const repeatedChunkRatio = this._repeatedChunkRatio(session.chunks || []);
    const shortPhrase = tokens.length <= 2;
    const conversational = this._looksConversational(normalized);
    const knownNoise = this._isNoSpeechMarker(normalized)
      || /^(?:thank you|thanks for watching|music|background music|foreign|silence|subscribe)$/i.test(normalized);

    let confidence = 0.88;
    if (tokens.length >= 3) confidence += 0.04;
    if (tokens.length >= 6) confidence += 0.03;
    if (shortPhrase && !conversational) confidence -= 0.18;
    if (uniqueRatio > 0 && uniqueRatio < 0.5) confidence -= 0.18;
    if (repeatedChunkRatio > 0.35) confidence -= 0.18;
    if (knownNoise) confidence -= 0.45;

    const noSpeechProbability = Math.max(
      knownNoise ? 0.9 : 0,
      shortPhrase && !conversational ? 0.62 : 0.18,
      repeatedChunkRatio > 0.35 ? 0.58 : 0.18
    );
    const compressionRatio = uniqueRatio > 0 ? 1 / uniqueRatio : 3;

    return {
      confidence: Math.max(0.1, Math.min(0.96, Number(confidence.toFixed(2)))),
      noSpeechProbability: Number(Math.min(0.98, noSpeechProbability).toFixed(2)),
      compressionRatio: Number(Math.max(1, compressionRatio).toFixed(2))
    };
  }

  _normalizeTranscriptCandidate(value) {
    const normalized = this.normalizer.normalize(value);
    if (!normalized || this._isNoSpeechMarker(normalized)) {
      return '';
    }
    return normalized;
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

    if (this.whisperConfig.keepContext === true) {
      args.splice(args.length - 2, 0, '--keep-context');
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
