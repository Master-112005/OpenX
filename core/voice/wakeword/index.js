const EventEmitter = require('events');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const Logger = require('../../shared/index').Logger;

class WakeWordDetector extends EventEmitter {
  constructor(config) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.wakeWord = (config?.voice?.wakeWord || 'jarvis').toLowerCase();
    this.isListening = false;
    this.isPaused = false;
    this.workerReady = false;
    this.workerProcess = null;
    this.workerReadline = null;
    this.workerStartupPromise = null;
    this.workerShuttingDown = false;
    this.workerScriptPath = path.join(__dirname, 'whisper_wakeword_worker.py');
    this.workerConfig = {
      provider: config?.voice?.wakeword?.provider || 'whisper-local',
      pythonCommand: config?.voice?.wakeword?.pythonCommand || 'python',
      modelName: config?.voice?.wakeword?.modelName || 'tiny.en',
      aliases: Array.isArray(config?.voice?.wakeword?.aliases) ? config.voice.wakeword.aliases : [],
      language: config?.voice?.wakeword?.language || 'en',
      device: config?.voice?.wakeword?.device || 'cpu',
      computeType: config?.voice?.wakeword?.computeType || 'int8',
      sampleRate: config?.voice?.wakeword?.sampleRate || 16000,
      frameDurationMs: config?.voice?.wakeword?.frameDurationMs || config?.voice?.frameDurationMs || 20,
      chunkDurationMs: config?.voice?.wakeword?.chunkDurationMs || 1800,
      cooldownMs: config?.voice?.wakeword?.cooldownMs || 4000,
      energyThreshold: config?.voice?.wakeword?.energyThreshold || 0.003,
      speechStartFrames: config?.voice?.wakeword?.speechStartFrames || 2,
      vadAggressiveness: config?.voice?.wakeword?.vadAggressiveness || 2,
      modelCacheDir: config?.voice?.wakeword?.modelCacheDir || config?.voice?.stt?.modelCacheDir || null
    };
  }

  async start() {
    if (this.isListening) return true;

    this.logger.info(`Wake word detector started, listening for: "${this.wakeWord}"`);

    if (this.workerConfig.provider === 'whisper-local') {
      this.isListening = true;
      this.isPaused = false;
      this._ensureWorker()
        .then(() => {
          if (!this.workerShuttingDown) {
            this.logger.info(`Wake-word worker ready for "${this.wakeWord}"`);
            this.emit('ready');
          }
        })
        .catch((err) => {
          this.isListening = false;
          if (this.workerShuttingDown || /SIGTERM/.test(String(err?.message || ''))) {
            return;
          }
          this.logger.warn('Wake-word worker startup failed', err.message);
        });
      return true;
    }

    this.isListening = true;
    this.emit('ready');
    return true;
  }

  async pause() {
    if (!this.workerProcess || this.workerProcess.killed || this.isPaused) {
      this.isPaused = true;
      this.isListening = false;
      return;
    }

    this.isPaused = true;
    this.isListening = false;
    this._sendWorkerCommand({ command: 'pause' });
  }

  async resume() {
    if (this.workerConfig.provider !== 'whisper-local') {
      this.isListening = true;
      this.isPaused = false;
      return;
    }

    this.isListening = true;
    this.isPaused = false;
    await this._ensureWorker();
    if (this.workerProcess && !this.workerProcess.killed) {
      this._sendWorkerCommand({ command: 'resume' });
    }
  }

  stop() {
    this.isListening = false;
    this.isPaused = false;
    this._shutdownWorker();
    this.emit('stopped');
  }

  processAudioChunk(audioData) {
    if (!this.isListening) return;
    this.emit('audio', audioData);
  }

  manualActivate() {
    this.emit('wakeword', { wakeWord: this.wakeWord, confidence: 1.0, manual: true });
  }

  destroy() {
    this.stop();
    this.removeAllListeners();
  }

  async _ensureWorker() {
    if (this.workerReady && this.workerProcess && !this.workerProcess.killed) {
      return;
    }

    if (this.workerStartupPromise) {
      return this.workerStartupPromise;
    }

    this.workerStartupPromise = new Promise((resolve, reject) => {
      let startupResolved = false;
      const startupTimeout = setTimeout(() => {
        if (startupResolved) {
          return;
        }

        clearPending();
        reject(new Error('Wake-word worker did not start microphone monitoring in time'));
      }, 12000);

      const args = [
        '-u',
        this.workerScriptPath,
        '--wake-word', this.wakeWord,
        '--model-name', this.workerConfig.modelName,
        '--language', this.workerConfig.language,
        '--device', this.workerConfig.device,
        '--compute-type', this.workerConfig.computeType,
        '--sample-rate', String(this.workerConfig.sampleRate),
        '--frame-duration-ms', String(this.workerConfig.frameDurationMs),
        '--chunk-duration-ms', String(this.workerConfig.chunkDurationMs),
        '--cooldown-ms', String(this.workerConfig.cooldownMs),
        '--energy-threshold', String(this.workerConfig.energyThreshold),
        '--speech-start-frames', String(this.workerConfig.speechStartFrames),
        '--vad-aggressiveness', String(this.workerConfig.vadAggressiveness)
      ];

      for (const alias of this.workerConfig.aliases) {
        const normalizedAlias = String(alias || '').trim().toLowerCase();
        if (normalizedAlias) {
          args.push('--wake-alias', normalizedAlias);
        }
      }

      if (this.workerConfig.modelCacheDir) {
        args.push('--model-cache-dir', this.workerConfig.modelCacheDir);
      }

      this.workerReady = false;
      this.workerShuttingDown = false;
      this.workerProcess = spawn(this.workerConfig.pythonCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.workerReadline = readline.createInterface({
        input: this.workerProcess.stdout
      });

      const clearPending = () => {
        this.workerStartupPromise = null;
      };

      this.workerReadline.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          this.logger.warn('Ignoring non-JSON wake-word worker output', line);
          return;
        }

        if (message.event === 'ready') {
          return;
        }

        if (!startupResolved && message.event === 'listening') {
          this.workerReady = true;
          startupResolved = true;
          clearTimeout(startupTimeout);
          clearPending();
          this._handleWorkerMessage(message);
          resolve();
          return;
        }

        if (!startupResolved && message.event === 'error') {
          clearTimeout(startupTimeout);
          clearPending();
          reject(new Error(message.message || 'Wake-word worker failed during startup'));
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

        this.logger.warn('Wake-word worker stderr', text);
      });

      this.workerProcess.once('exit', (code, signal) => {
        const exitMessage = `Wake-word worker exited (${signal || code || 0})`;
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
          clearTimeout(startupTimeout);
          clearPending();
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

  _handleWorkerMessage(message) {
    switch (message.event) {
      case 'wakeword':
        if (!this.isPaused) {
          this.emit('wakeword', {
            wakeWord: message.wakeWord || this.wakeWord,
            transcript: message.transcript || '',
            confidence: Number(message.confidence) || 1,
            manual: false,
            inlineCommand: message.inlineCommand === true
          });
        }
        break;
      case 'paused':
        this.isPaused = true;
        break;
      case 'resumed':
        this.isPaused = false;
        this.isListening = true;
        break;
      case 'listening':
        this.isListening = true;
        this.logger.info('Wake-word worker started microphone monitoring', {
          device: message.device || 'default',
          sampleRate: Number(message.sampleRate) || this.workerConfig.sampleRate
        });
        break;
      case 'monitoring':
        this.logger.info('Wake-word worker capture summary', {
          speechDetected: Boolean(message.speechDetected),
          chunkDurationMs: Number(message.chunkDurationMs) || 0,
          maxRms: Number(message.maxRms) || 0,
          noiseFloor: Number(message.noiseFloor) || 0,
          transcript: message.transcript || ''
        });
        break;
      case 'warning':
        this.logger.warn('Wake-word worker warning', message.message);
        break;
      case 'error':
        this.logger.warn('Wake-word worker error', message.message);
        break;
      default:
        break;
    }
  }

  _sendWorkerCommand(payload) {
    if (!this.workerProcess || this.workerProcess.killed) {
      return;
    }

    try {
      this.workerProcess.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      this.logger.warn('Unable to communicate with wake-word worker', err.message);
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
      this.logger.warn('Unable to send wake-word worker shutdown command', err.message);
    }

    try {
      this.workerProcess.kill();
    } catch (err) {
      this.logger.warn('Unable to terminate wake-word worker process', err.message);
    }

    this.workerReady = false;
    this.workerProcess = null;
  }
}

module.exports = WakeWordDetector;
