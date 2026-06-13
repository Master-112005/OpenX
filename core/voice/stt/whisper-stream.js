const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Logger = require('../../shared/index').Logger;

class WhisperStreamSpeechEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.voiceConfig = config?.voice || {};
    this.whisperConfig = this.voiceConfig.whisper || {};
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.process = null;
    this.ready = false;
    this.state = 'IDLE';
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
        message: 'Whisper stream is not ready',
        backend: 'whisper-stream'
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

    this.state = 'LISTENING';
    this.activeSession = {
      mode,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      startSpeechTimeoutMs,
      maxDurationMs,
      chunks: [],
      finalized: false,
      finalTimer: null,
      inactivityTimer: null,
      speechDetected: false
    };

    this.logger.info('STT session started', { mode, backend: 'whisper-stream' });
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
    this.logger.info('Microphone recording started', { backend: 'whisper-stream' });
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
    this.state = 'IDLE';
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
    const transcripts = String(chunk || '')
      .split(/\r?\n/)
      .map(line => this._parseTranscriptLine(line))
      .filter(Boolean);

    for (const text of transcripts) {
      if (!this.activeSession || this.activeSession.finalized) {
        continue;
      }

      if (!this.activeSession.speechDetected) {
        this.activeSession.speechDetected = true;
        this.logger.info('Speech detected', { backend: 'whisper-stream' });
        this.emit('event', {
          event: 'speech_started',
          mode: this.activeSession.mode,
          backend: 'whisper-stream'
        });
      }

      this.activeSession.chunks.push(text);
      this.activeSession.lastActivityAt = Date.now();
      this._armSessionInactivityTimer(this.activeSession.startSpeechTimeoutMs);
      this._logTranscriptChunk(text);
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
      this.activeSession.finalTimer = setTimeout(() => {
        this.logger.info('Silence detected', { backend: 'whisper-stream' });
        this._finalizeSession('final-transcript');
      }, this._getFinalDebounceMs());
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

    this.logger.info('Recording stopped', { reason, backend: 'whisper-stream' });
    this.state = 'TRANSCRIBING';
    this.logger.info('Transcribing audio', { backend: 'whisper-stream' });

    const text = this._composeSessionTranscript(session);
    this.logger.info(`Transcript: "${text}"`, { backend: 'whisper-stream' });
    this.emit('event', {
      event: 'result',
      text,
      isFinal: true,
      mode: session.mode,
      backend: 'whisper-stream',
      timeoutMs: session.startSpeechTimeoutMs
    });
    this.state = 'IDLE';
    this.logger.info('STT session completed', { mode: session.mode, backend: 'whisper-stream' });
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
      this.logger.info('Silence detected', { backend: 'whisper-stream' });
      this._finalizeSession('session-timeout');
    }, duration);
  }

  _parseTranscriptLine(line) {
    const raw = this._cleanWhisperOutput(line);
    if (!raw || /^(?:whisper_|main:|system_info:|sampling|processing|init|error:)/i.test(raw)) {
      return '';
    }

    try {
      const parsed = JSON.parse(raw);
      return this._normalizeTranscriptText(parsed.text || parsed.transcript || '');
    } catch (error) {}

    return this._normalizeTranscriptText(
      raw
        .replace(/^\[[^\]]+\]\s*/g, '')
        .replace(/^\([^)]+\)\s*/g, '')
        .replace(/^\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/g, '')
    );
  }

  _composeSessionTranscript(session = {}) {
    const chunks = (Array.isArray(session.chunks) ? session.chunks : [])
      .map(chunk => this._normalizeTranscriptText(chunk))
      .filter(Boolean);
    if (!chunks.length) {
      return '';
    }

    const compacted = [];
    for (const chunk of chunks) {
      const previous = compacted[compacted.length - 1];
      if (!previous || previous !== chunk) {
        compacted.push(chunk);
      }
    }

    const last = compacted[compacted.length - 1];
    if (compacted.length === 1) {
      return last;
    }

    const previous = compacted[compacted.length - 2];
    const previousTokens = this._tokenize(previous);
    const lastTokens = this._tokenize(last);
    if (previousTokens.length > 0 && lastTokens.length >= previousTokens.length) {
      const prefix = lastTokens.slice(0, previousTokens.length).join(' ');
      if (prefix === previousTokens.join(' ')) {
        return last;
      }
    }

    return this._normalizeTranscriptText(compacted.join(' '));
  }

  _getFinalDebounceMs() {
    return Number(this.whisperConfig.finalDebounceMs) > 0
      ? Number(this.whisperConfig.finalDebounceMs)
      : 1600;
  }

  _cleanWhisperOutput(value) {
    return String(value || '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _normalizeTranscriptText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?]+$/g, '')
      .trim()
      .toLowerCase();
  }

  _tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .split(/\s+/)
      .map(token => token.replace(/^[^\w]+|[^\w]+$/g, ''))
      .filter(Boolean);
  }

  _logTranscriptChunk(text) {
    const payload = { text };
    if (this.whisperConfig.logRawOutput === true) {
      this.logger.info('[WHISPER] Transcript chunk', payload);
    } else {
      this.logger.debug('[WHISPER] Transcript chunk', payload);
    }
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
