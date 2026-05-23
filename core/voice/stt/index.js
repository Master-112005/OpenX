const EventEmitter = require('events');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');
const Logger = require('../../shared/index').Logger;

class SpeechToText extends EventEmitter {
  constructor(config) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.isListening = false;
    this.backend = 'sapi';
    this.workerProcess = null;
    this.workerReadline = null;
    this.workerReady = false;
    this.workerStartupPromise = null;
    this.workerShuttingDown = false;
    this.workerScriptPath = path.join(__dirname, 'whisper_worker.py');
    this.pythonCommand = config?.voice?.stt?.pythonCommand || 'python';
    this.whisperConfig = {
      modelName: config?.voice?.stt?.modelName || 'small.en',
      language: config?.voice?.stt?.language || 'en',
      device: config?.voice?.stt?.device || 'cpu',
      computeType: config?.voice?.stt?.computeType || 'int8',
      sampleRate: config?.voice?.stt?.sampleRate || 16000,
      frameDurationMs: config?.voice?.stt?.frameDurationMs || config?.voice?.frameDurationMs || 20,
      maxDurationMs: config?.voice?.stt?.maxDurationMs || 12000,
      silenceTimeoutMs: config?.voice?.silenceTimeout || config?.voice?.stt?.silenceTimeoutMs || 2000,
      startSpeechTimeoutMs: config?.voice?.stt?.startSpeechTimeoutMs || 4000,
      energyThreshold: config?.voice?.stt?.energyThreshold || 0.003,
      minUtteranceMs: config?.voice?.stt?.minUtteranceMs || 250,
      speechStartFrames: config?.voice?.stt?.speechStartFrames || 2,
      vadAggressiveness: config?.voice?.stt?.vadAggressiveness || 2,
      modelCacheDir: config?.voice?.stt?.modelCacheDir || null
    };
  }

  async initialize() {
    this.logger.info('Initializing speech-to-text');

    if (this._shouldUseLocalWhisper()) {
      this.backend = 'whisper-local';
      this.logger.info(`Using local Whisper STT (${this.whisperConfig.modelName})`);
      this._warmupWorker();
      return true;
    }

    this.backend = 'sapi';
    this.logger.info('Using Windows Speech Recognition (SAPI)');
    return true;
  }

  startListening() {
    if (this.isListening) return;

    this.isListening = true;
    this.logger.info(`STT started listening with backend: ${this.backend}`);

    if (this.backend === 'whisper-local') {
      this._startWhisperListening().catch((err) => {
        this.logger.warn('Whisper listening failed, falling back to SAPI for this turn', err.message);
        this.backend = 'sapi';
        this._startSapiListening();
      });
      return;
    }

    this._startSapiListening();
    this.emit('listening');
  }

  stopListening() {
    if (!this.isListening) {
      return;
    }

    this.isListening = false;

    if (this.backend === 'whisper-local' && this.workerProcess && !this.workerProcess.killed) {
      try {
        this.workerProcess.stdin.write(JSON.stringify({ command: 'cancel' }) + '\n');
      } catch (err) {
        this.logger.warn('Unable to cancel Whisper listening cleanly', err.message);
      }
    }

    this.emit('stopped');
  }

  processAudioChunk() {}

  getFinalResult() {
    return '';
  }

  destroy() {
    if (this.isListening) {
      this.stopListening();
    }

    this._shutdownWorker();
    this.removeAllListeners();
  }

  _shouldUseLocalWhisper() {
    return (this.config?.voice?.stt?.provider || 'whisper-local') === 'whisper-local';
  }

  _warmupWorker() {
    this._ensureWorker().catch((err) => {
      if (this.workerShuttingDown || /SIGTERM/.test(String(err?.message || ''))) {
        return;
      }
      this.logger.warn('Whisper worker warmup failed', err.message);
    });
  }

  async _ensureWorker() {
    if (this.workerReady && this.workerProcess && !this.workerProcess.killed) {
      return;
    }

    if (this.workerStartupPromise) {
      return this.workerStartupPromise;
    }

    this.workerStartupPromise = new Promise((resolve, reject) => {
      const args = [
        '-u',
        this.workerScriptPath,
        '--model-name', this.whisperConfig.modelName,
        '--language', this.whisperConfig.language,
        '--device', this.whisperConfig.device,
        '--compute-type', this.whisperConfig.computeType,
        '--sample-rate', String(this.whisperConfig.sampleRate),
        '--frame-duration-ms', String(this.whisperConfig.frameDurationMs),
        '--max-duration-ms', String(this.whisperConfig.maxDurationMs),
        '--silence-timeout-ms', String(this.whisperConfig.silenceTimeoutMs),
        '--start-speech-timeout-ms', String(this.whisperConfig.startSpeechTimeoutMs),
        '--energy-threshold', String(this.whisperConfig.energyThreshold),
        '--min-utterance-ms', String(this.whisperConfig.minUtteranceMs),
        '--speech-start-frames', String(this.whisperConfig.speechStartFrames),
        '--vad-aggressiveness', String(this.whisperConfig.vadAggressiveness)
      ];

      if (this.whisperConfig.modelCacheDir) {
        args.push('--model-cache-dir', this.whisperConfig.modelCacheDir);
      }

      this.workerReady = false;
      this.workerShuttingDown = false;
      this.workerProcess = spawn(this.pythonCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.workerReadline = readline.createInterface({
        input: this.workerProcess.stdout
      });

      const cleanupPending = () => {
        this.workerStartupPromise = null;
      };

      this.workerReadline.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          this.logger.warn('Ignoring non-JSON Whisper worker output', line);
          return;
        }

        if (message.event === 'ready') {
          this.workerReady = true;
          cleanupPending();
          resolve();
          return;
        }

        if (!this.workerReady && message.event === 'error') {
          cleanupPending();
          reject(new Error(message.message || 'Whisper worker failed during startup'));
          return;
        }

        this._handleWorkerMessage(message);
      });

      this.workerProcess.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (!text) {
          return;
        }

        if (/unauthenticated requests to the HF Hub/i.test(text)) {
          return;
        }

        this.logger.warn('Whisper worker stderr', text);
      });

      this.workerProcess.once('exit', (code, signal) => {
        const exitMessage = `Whisper worker exited (${signal || code || 0})`;
        const wasReady = this.workerReady;
        const wasShuttingDown = this.workerShuttingDown;
        this.workerReady = false;
        this.workerShuttingDown = false;
        this.workerProcess = null;
        if (this.workerReadline) {
          this.workerReadline.close();
          this.workerReadline = null;
        }

        if (!wasReady) {
          cleanupPending();
          reject(new Error(exitMessage));
          return;
        }

        if (!wasShuttingDown) {
          this.logger.warn(exitMessage);
        }
      });
    });

    return this.workerStartupPromise;
  }

  async _startWhisperListening() {
    await this._ensureWorker();
    if (!this.isListening || !this.workerProcess || this.workerProcess.killed) {
      return;
    }

    this.workerProcess.stdin.write(JSON.stringify({
      command: 'listen',
      sampleRate: this.whisperConfig.sampleRate,
      frameDurationMs: this.whisperConfig.frameDurationMs,
      maxDurationMs: this.whisperConfig.maxDurationMs,
      silenceTimeoutMs: this.whisperConfig.silenceTimeoutMs,
      startSpeechTimeoutMs: this.whisperConfig.startSpeechTimeoutMs,
      energyThreshold: this.whisperConfig.energyThreshold,
      minUtteranceMs: this.whisperConfig.minUtteranceMs,
      speechStartFrames: this.whisperConfig.speechStartFrames,
      vadAggressiveness: this.whisperConfig.vadAggressiveness,
      language: this.whisperConfig.language
    }) + '\n');
  }

  _handleWorkerMessage(message) {
    switch (message.event) {
      case 'listening_started':
        this.logger.info('Whisper worker started microphone capture');
        this.emit('listening');
        break;
      case 'result':
        this.logger.info('Whisper worker completed capture', {
          speechDetected: Boolean(message.speechDetected),
          fallbackCandidate: Boolean(message.fallbackCandidate),
          durationMs: Number(message.durationMs) || 0,
          maxRms: Number(message.maxRms) || 0,
          noiseFloor: Number(message.noiseFloor) || 0,
          hasText: Boolean(message.text && String(message.text).trim())
        });
        if (message.text && String(message.text).trim()) {
          this.emit('result', {
            text: String(message.text).trim(),
            confidence: Number(message.confidence) || 0.8,
            isFinal: message.isFinal !== false,
            backend: 'whisper-local',
            language: message.language || this.whisperConfig.language
          });
        } else {
          this.emit('result', {
            text: '',
            confidence: Number(message.confidence) || 0,
            isFinal: message.isFinal !== false,
            backend: 'whisper-local',
            language: message.language || this.whisperConfig.language,
            speechDetected: Boolean(message.speechDetected),
            durationMs: Number(message.durationMs) || 0
          });
        }
        break;
      case 'listening_stopped':
        this.logger.info('Whisper worker stopped microphone capture', {
          cancelled: Boolean(message.cancelled)
        });
        if (this.isListening) {
          this.isListening = false;
          this.emit('stopped');
        }
        break;
      case 'warning':
        this.logger.warn('Whisper worker warning', message.message);
        break;
      case 'error':
        this.logger.warn('Whisper worker error', message.message);
        if (this.isListening) {
          this.isListening = false;
          this.emit('stopped');
        }
        break;
      default:
        break;
    }
  }

  _shutdownWorker() {
    if (!this.workerProcess || this.workerProcess.killed) {
      return;
    }

    try {
      this.workerShuttingDown = true;
      this.workerProcess.stdin.write(JSON.stringify({ command: 'shutdown' }) + '\n');
    } catch (err) {
      this.logger.warn('Unable to send Whisper worker shutdown command', err.message);
    }

    try {
      this.workerProcess.kill();
    } catch (err) {
      this.logger.warn('Unable to terminate Whisper worker process', err.message);
    }

    this.workerReady = false;
    this.workerProcess = null;
  }

  _startSapiListening() {
    try {
      const psScript = [
        'Add-Type -AssemblyName System.Speech',
        '$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
        '$engine.SetInputToDefaultAudioDevice()',
        '$grammar = New-Object System.Speech.Recognition.DictationGrammar',
        '$engine.LoadGrammar($grammar)',
        '$result = $engine.Recognize([TimeSpan]::FromSeconds(6))',
        'if ($result -and $result.Text) { Write-Output ($result.Text + "|" + $result.Confidence) }',
        '$engine.Dispose()'
      ].join('; ');

      const result = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        psScript
      ], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });

      const lines = String(result || '').trim().split(/\r?\n/).filter(line => line.includes('|'));
      lines.forEach((line) => {
        const [text, confidence] = line.split('|');
        if (!text) return;
        this.emit('result', {
          text: text.trim(),
          confidence: parseFloat(confidence) || 0.7,
          isFinal: true,
          backend: 'sapi'
        });
      });
    } catch (err) {
      this.logger.warn('SAPI listening iteration complete', err.message);
    }

    if (this.isListening) {
      this.isListening = false;
      this.emit('stopped');
    }
  }
}

module.exports = SpeechToText;
