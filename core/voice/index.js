const EventEmitter = require('events');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const {
  AssistantEventBus,
  EVENTS,
  Logger
} = require('../shared/index');
const TextToSpeech = require('./tts/index');
const { SPEECH_STATES, SpeechStateMachine } = require('./state/index');

class VoiceManager extends EventEmitter {
  constructor(config, dependencies = {}) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.eventBus = dependencies.eventBus || config?.eventBus || new AssistantEventBus();
    
    // Asynchronous SAPI TTS engine refactored in Task 1
    this.tts = dependencies.tts || new TextToSpeech(config);
    this.stateMachine = dependencies.stateMachine || new SpeechStateMachine(this.eventBus);
    
    this.isActive = false;
    this.isDestroyed = false;
    this.allowManualActivation = config?.voice?.allowManualActivation !== false;
    this.activationAcknowledgement = String(config?.voice?.activationAcknowledgement || '').trim();
    this.speakActivationAcknowledgement = config?.voice?.speakActivationAcknowledgement === true;
    this.activationMode = config?.voice?.activationMode || 'hotkey';
    this.conversationActive = false;
    this.conversationSilenceTimeoutMs = Number(config?.voice?.conversationSilenceTimeoutMs) > 0
      ? Number(config.voice.conversationSilenceTimeoutMs)
      : 20000;
    
    // Persistent Python subprocess properties
    this.engineScriptPath = path.join(__dirname, 'engine', 'audio_engine.py');
    this.pythonCommand = config?.voice?.recognition?.pythonCommand
      || config?.voice?.wakeword?.pythonCommand
      || 'python';
    this.workerProcess = null;
    this.workerReadline = null;
    this.workerReady = false;
    this.workerStartupPromise = null;
    this.pendingFollowUpListen = null;
    this.pendingListenAfterResume = null;
    this.resumeListenFallbackTimer = null;
    
    this._setupTtsListeners();
  }

  _setupTtsListeners() {
    this.tts.on('speaking', (text) => {
      this.eventBus.publish(EVENTS.RESPONSE_STARTED, { text });
      
      // Enforce Law 5: Pause wake word and VAD during speech output
      this._pauseCaptureStream();
      
      this._transitionTo(SPEECH_STATES.RESPONDING, { text });
      this.emit('speaking', text);
    });

    this.tts.on('completed', () => {
      this.eventBus.publish(EVENTS.RESPONSE_COMPLETED, {});

      this._transitionTo(SPEECH_STATES.IDLE, { reason: 'tts-complete' });

      const followUpListen = this.pendingFollowUpListen
        ? { ...this.pendingFollowUpListen }
        : null;
      this.pendingFollowUpListen = null;

      // Enforce Law 5: resume capture only after SAPI is done, then arm any follow-up STT.
      if (followUpListen) {
        this._resumeCaptureAndStartListening(followUpListen);
      } else {
        this._resumeCaptureStream();
      }

      this.emit('speechCompleted');
    });

    this.tts.on('error', (error) => {
      this.eventBus.publish(EVENTS.VOICE_ERROR, {
        stage: 'tts',
        message: error?.message || String(error || 'Unknown TTS error')
      });
      
      this._resumeCaptureStream();
      this._transitionTo(SPEECH_STATES.ERROR, { stage: 'tts' });
    });
  }

  async initialize() {
    this.logger.info('Initializing voice system');
    await this.tts.initialize();
    
    // Spawn and establish persistent stdin/stdout piping to Python Audio Engine (Law 8)
    await this._startAudioEngine();
    
    this.logger.info('Voice system ready');
    return true;
  }

  _transitionTo(nextState, metadata = {}) {
    try {
      return this.stateMachine.transition(nextState, metadata);
    } catch (error) {
      if (error?.code !== 'INVALID_SPEECH_STATE_TRANSITION') {
        throw error;
      }
      this.logger.warn('Ignoring invalid speech state transition', {
        from: this.stateMachine.getState(),
        to: nextState,
        metadata
      });
      return { changed: false };
    }
  }

  _startAudioEngine() {
    if (this.workerStartupPromise) {
      return this.workerStartupPromise;
    }

    this.workerStartupPromise = new Promise((resolve, reject) => {
      const recognitionConfig = this.config?.voice?.recognition || this.config?.voice?.wakeword || {};
      const activationWord = String(this.config?.voice?.wakeWord || '').trim().toLowerCase();
      const aliases = this.activationMode === 'wakeword' && Array.isArray(recognitionConfig.aliases)
        ? recognitionConfig.aliases
        : [];
      
      const args = [
        '-u',
        this.engineScriptPath,
        '--activation-mode', this.activationMode,
        '--wake-word', activationWord,
        '--model-name', recognitionConfig.modelName || 'tiny.en',
        '--language', recognitionConfig.language || 'en',
        '--device', recognitionConfig.device || 'cpu',
        '--compute-type', recognitionConfig.computeType || 'int8',
        '--sample-rate', String(recognitionConfig.sampleRate || 16000),
        '--frame-duration-ms', String(this.config?.voice?.frameDurationMs || 20),
        '--chunk-duration-ms', String(recognitionConfig.chunkDurationMs || 1200),
        '--cooldown-ms', String(recognitionConfig.cooldownMs || 2500),
        '--energy-threshold', String(recognitionConfig.energyThreshold || 0.003),
        '--speech-start-frames', String(recognitionConfig.speechStartFrames || 2),
        '--vad-aggressiveness', String(recognitionConfig.vadAggressiveness || 2),
        '--device-id', String(this.config?.voice?.audioInputDeviceId !== undefined ? this.config.voice.audioInputDeviceId : -1),
        '--silence-timeout-ms', String(this.config?.voice?.silenceTimeout || 1200),
        '--max-duration-ms', String(this.config?.voice?.stt?.maxDurationMs || 12000),
        '--start-speech-timeout-ms', String(this.config?.voice?.stt?.startSpeechTimeoutMs || 3500),
        '--min-utterance-ms', String(this.config?.voice?.stt?.minUtteranceMs || 250),
        '--speaker-similarity-threshold', String(this.config?.voice?.speakerLock?.similarityThreshold || 0.68)
      ];

      if (this.config?.voice?.allowBluetoothHFP) {
        args.push('--allow-bluetooth-hfp');
      }

      if (this.config?.voice?.speakerLock?.enabled !== false) {
        args.push('--speaker-lock-enabled');
      }

      if (recognitionConfig.modelCacheDir) {
        args.push('--model-cache-dir', recognitionConfig.modelCacheDir);
      }

      for (const alias of aliases) {
        const val = String(alias || '').trim();
        if (val) {
          args.push('--wake-alias', val);
        }
      }

      this.logger.info(`Spawning unified Python audio engine with arguments`, args);
      
      this.workerProcess = spawn(this.pythonCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.workerReadline = readline.createInterface({
        input: this.workerProcess.stdout
      });

      this.workerReadline.on('line', (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          this.logger.warn('Non-JSON audio engine output', line);
          return;
        }

        if (message.event === 'ready') {
          this.workerReady = true;
          this.workerStartupPromise = null;
          resolve();
          return;
        }

        this._handleEngineEvent(message);
      });

      this.workerProcess.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) {
          this.logger.warn('Audio engine stderr', text);
        }
      });

      this.workerProcess.once('exit', (code, signal) => {
        this.logger.warn(`Audio engine exited (${signal || code || 0})`);
        this.workerReady = false;
        this.workerStartupPromise = null;
        this.workerProcess = null;
        if (this.workerReadline) {
          this.workerReadline.close();
          this.workerReadline = null;
        }
        
        if (!this.isDestroyed) {
          // Attempt automatic crash recovery (Law 12)
          this._transitionTo(SPEECH_STATES.RECOVERING);
          setTimeout(() => {
            this.initialize().catch(err => {
              this.logger.error('Audio engine recovery failed', err.message);
              this._transitionTo(SPEECH_STATES.ERROR);
            });
          }, 3000);
        }
      });
    });

    return this.workerStartupPromise;
  }

  _handleEngineEvent(message) {
    switch (message.event) {
      case 'listening':
        this.logger.info(`Microphone streaming persistent hardware InputStream online`, message);
        break;

      case 'resumed':
        this.logger.info('Audio engine capture resumed');
        this._flushPendingListenAfterResume('engine-resumed');
        break;

      case 'paused':
        this.logger.info('Audio engine capture paused');
        break;

      case 'stt_session_activated':
        this.logger.info('Audio engine STT session armed', message);
        break;

      case 'ignored_speech':
        this._handleIgnoredSpeech(message);
        break;
      
      case 'state_changed':
        // Safe logging without frame-level stdout spam
        this.logger.debug(`Audio engine state changed`, message);
        break;
        
      case 'activated':
      case 'wakeword':
        this._handleActivationEvent(message);
        break;
        
      case 'speech_started':
        this._transitionTo(SPEECH_STATES.HEARING_SPEECH);
        this.emit('hearingSpeech', { sessionId: 'persistent' });
        break;
        
      case 'result':
        this._handleSpeechResult(message);
        break;

      case 'session_timeout':
        this._handleSessionTimeout(message);
        break;
        
      case 'error':
        this.logger.error('Audio engine error event', message.message);
        this.eventBus.publish(EVENTS.VOICE_ERROR, { stage: 'engine', message: message.message });
        break;
        
      case 'warning':
        this.logger.warn('Audio engine warning event', message.message);
        break;
        
      default:
        break;
    }
  }

  _handleActivationEvent(data) {
    if (this.stateMachine.currentState !== SPEECH_STATES.IDLE) {
      return;
    }

    this.logger.info('Voice activation detected', data);
    this.isActive = true;
    
    this._transitionTo(SPEECH_STATES.ACTIVATING, {
      trigger: data?.trigger || data?.source || this.activationMode,
      inlineCommand: data?.inlineCommand === true
    });
    this.eventBus.publish(EVENTS.VOICE_ACTIVATED, data);
    this.emit('activated', data);

    const inlineCommand = data?.inlineCommand === true
      ? this._extractInlineCommand(data.transcript, data.wakeWord || '')
      : '';
    if (inlineCommand) {
      this.logger.info('Using inline activation command', { command: inlineCommand });
      this._transitionTo(SPEECH_STATES.THINKING);
      
      const utterance = {
        id: 'inline-' + Date.now(),
        text: inlineCommand,
        confidence: data.confidence || 1.0,
        backend: 'whisper-local'
      };
      
      this.eventBus.publish(EVENTS.STT_COMPLETED, {
        text: inlineCommand,
        confidence: data.confidence || 1.0,
        backend: 'whisper-local'
      });
      
      this.emit('speechResult', {
        text: inlineCommand,
        confidence: data.confidence || 1.0,
        isFinal: true,
        backend: 'whisper-local',
        utterance
      });
      
      this.isActive = false;
      this.emit('deactivated');
    } else {
      // Transition to LISTENING and send command to gather STT speech (Law 8)
      this._transitionTo(SPEECH_STATES.LISTENING);
      this._sendEngineCommand({ command: 'listen' });
      this.emit('listening');
    }
  }

  _handleSpeechResult(data) {
    this._transitionTo(SPEECH_STATES.TRANSCRIBING);
    this._transitionTo(SPEECH_STATES.THINKING);
    
    this.eventBus.publish(EVENTS.STT_COMPLETED, {
      text: data.text,
      confidence: data.confidence || 0.8,
      backend: 'whisper-local'
    });
    
    const utterance = {
      id: 'stt-' + Date.now(),
      text: data.text,
      confidence: data.confidence || 0.8,
      backend: 'whisper-local'
    };

    this.emit('speechResult', {
      text: this._normalizeTranscript(data.text),
      confidence: data.confidence || 0.8,
      isFinal: true,
      backend: 'whisper-local',
      mode: data.mode || 'command',
      utterance
    });

    if (!this.conversationActive) {
      this.isActive = false;
      this.emit('deactivated');
    }
  }

  _handleSessionTimeout(data) {
    this.isActive = false;
    if (data?.mode === 'conversation' || data?.mode === 'confirmation') {
      this.conversationActive = false;
    }
    this._transitionTo(SPEECH_STATES.IDLE, {
      reason: 'session-timeout',
      mode: data?.mode || 'command'
    });
    this.emit('deactivated');
    this.emit('listeningTimeout', {
      mode: data?.mode || 'command',
      timeoutMs: data?.timeoutMs || 0,
      reason: data?.reason || 'session-timeout'
    });
  }

  _handleIgnoredSpeech(data) {
    this.logger.info('Ignored speech input', {
      mode: data?.mode || 'command',
      reason: data?.reason || 'filtered'
    });

    this._transitionTo(SPEECH_STATES.IDLE, {
      reason: data?.reason || 'ignored-speech',
      mode: data?.mode || 'command'
    });

    if (this.conversationActive && !this.isDestroyed) {
      this.startListening(this._getConversationListenOptions());
    }
  }

  speak(text) {
    this.tts.speak(text);
  }

  startListening(options = {}) {
    if (this.stateMachine.currentState !== SPEECH_STATES.IDLE) {
      return false;
    }

    const mode = String(options.mode || 'command');
    const startSpeechTimeoutMs = Number(options.startSpeechTimeoutMs) > 0
      ? Number(options.startSpeechTimeoutMs)
      : mode === 'conversation'
        ? this.conversationSilenceTimeoutMs
        : undefined;
    this.isActive = true;
    this._transitionTo(SPEECH_STATES.LISTENING, { mode });
    this._sendEngineCommand({
      command: 'listen',
      mode,
      startSpeechTimeoutMs,
      maxDurationMs: options.maxDurationMs,
      resetSpeakerLock: options.resetSpeakerLock === true
    });
    this.emit('listening', { mode });
    return true;
  }

  stopListening() {
    this._pauseCaptureStream();
    this.isActive = false;
    this.emit('deactivated');
    this._transitionTo(SPEECH_STATES.IDLE, { reason: 'manual-stop' });
  }

  manualActivate() {
    if (!this.allowManualActivation) {
      this.logger.info('Voice activation ignored because manual activation is disabled');
      return false;
    }

    if (this.stateMachine.currentState !== SPEECH_STATES.IDLE) {
      return false;
    }

    const payload = {
      manual: true,
      source: 'hotkey',
      trigger: this.config?.voice?.activationShortcut || 'Alt+Space'
    };

    this.conversationActive = true;
    this.eventBus.publish(EVENTS.VOICE_ACTIVATED, payload);
    this.emit('activated', payload);
    return this.startListening({
      ...this._getConversationListenOptions(),
      resetSpeakerLock: true
    });
  }

  queueFollowUpListening(options = {}) {
    this.pendingFollowUpListen = {
      mode: String(options.mode || 'command'),
      startSpeechTimeoutMs: Number(options.startSpeechTimeoutMs) > 0
        ? Number(options.startSpeechTimeoutMs)
        : undefined,
      maxDurationMs: Number(options.maxDurationMs) > 0
        ? Number(options.maxDurationMs)
        : undefined
    };
  }

  _resumeCaptureAndStartListening(options = {}) {
    this.pendingListenAfterResume = { ...options };
    this._resumeCaptureStream();

    if (this.resumeListenFallbackTimer) {
      clearTimeout(this.resumeListenFallbackTimer);
    }

    const fallbackDelayMs = Number(this.config?.voice?.resumeListenFallbackMs) > 0
      ? Number(this.config.voice.resumeListenFallbackMs)
      : 350;

    this.resumeListenFallbackTimer = setTimeout(() => {
      this._flushPendingListenAfterResume('resume-fallback');
    }, fallbackDelayMs);
  }

  _flushPendingListenAfterResume(reason) {
    if (!this.pendingListenAfterResume) {
      return false;
    }

    if (this.resumeListenFallbackTimer) {
      clearTimeout(this.resumeListenFallbackTimer);
      this.resumeListenFallbackTimer = null;
    }

    const request = {
      ...this.pendingListenAfterResume,
      resumeReason: reason
    };
    this.pendingListenAfterResume = null;
    return this.startListening(request);
  }

  shouldContinueConversation() {
    return this.conversationActive && !this.isDestroyed;
  }

  getConversationListenOptions() {
    return this._getConversationListenOptions();
  }

  _getConversationListenOptions() {
    return {
      mode: 'conversation',
      startSpeechTimeoutMs: this.conversationSilenceTimeoutMs,
      maxDurationMs: Number(this.config?.voice?.stt?.maxDurationMs) > 0
        ? Number(this.config.voice.stt.maxDurationMs)
        : undefined
    };
  }

  _normalizeTranscript(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/^[.,!?;:\s]+|[.,!?;:\s]+$/g, '')
      .trim();
  }

  _sendEngineCommand(payload) {
    if (!this.workerProcess || this.workerProcess.killed) {
      return;
    }
    try {
      this.workerProcess.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      this.logger.warn('Unable to communicate with Python audio engine', err.message);
    }
  }

  _pauseCaptureStream() {
    this._sendEngineCommand({ command: 'pause' });
  }

  _resumeCaptureStream() {
    this._sendEngineCommand({ command: 'resume' });
  }

  _extractInlineCommand(transcript, wakeWord) {
    const raw = String(transcript || '').trim();
    const wake = String(wakeWord || '').trim().toLowerCase();
    if (!raw || !wake) {
      return '';
    }

    const normalized = raw
      .toLowerCase()
      .replace(/[.,!?]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const pattern = new RegExp(`^(?:hey|hi|hello)?\\s*${wake}\\b\\s*(.*)$`, 'i');
    const match = normalized.match(pattern);
    if (!match) {
      return '';
    }

    return String(match[1] || '').trim();
  }

  destroy() {
    this.isDestroyed = true;
    if (this.workerProcess) {
      try {
        this.workerProcess.stdin.write(JSON.stringify({ command: 'shutdown' }) + '\n');
        this.workerProcess.kill();
      } catch (err) {}
      this.workerProcess = null;
    }
    if (this.resumeListenFallbackTimer) {
      clearTimeout(this.resumeListenFallbackTimer);
      this.resumeListenFallbackTimer = null;
    }
    this.pendingFollowUpListen = null;
    this.pendingListenAfterResume = null;
    this.conversationActive = false;
    this.tts.destroy();
    this.removeAllListeners();
  }

  getStatus() {
    return {
      active: this.isActive,
      conversationActive: this.conversationActive,
      listening: this.stateMachine.currentState === SPEECH_STATES.LISTENING,
      state: this.stateMachine.getState()
    };
  }
}

module.exports = VoiceManager;
