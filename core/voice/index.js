const EventEmitter = require('events');
const {
  AssistantEventBus,
  EVENTS,
  Logger
} = require('../shared/index');
const TextToSpeech = require('./tts/index');
const WindowsSapiSpeechEngine = require('./stt/windows-sapi');
const WhisperStreamSpeechEngine = require('./stt/whisper-stream');
const { SPEECH_STATES, SpeechStateMachine } = require('./state/index');
const { VoiceSessionManager } = require('./session/index');

class VoiceManager extends EventEmitter {
  constructor(config, dependencies = {}) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.eventBus = dependencies.eventBus || config?.eventBus || new AssistantEventBus();
    
    // Asynchronous SAPI TTS engine refactored in Task 1
    this.tts = dependencies.tts || new TextToSpeech(config);
    this.stateMachine = dependencies.stateMachine || new SpeechStateMachine(this.eventBus);
    this.sessionManager = dependencies.sessionManager || new VoiceSessionManager();
    
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
    this.stt = dependencies.stt || this._createSpeechEngine(config);
    this.workerProcess = null;
    this.workerReady = false;
    this.workerStartupPromise = null;
    this.pendingFollowUpListen = null;
    this.pendingListenAfterResume = null;
    this.resumeListenFallbackTimer = null;
    
    this._setupTtsListeners();
    this._setupSessionListeners();
  }

  _setupTtsListeners() {
    this.tts.on('speaking', (text) => {
      this.eventBus.publish(EVENTS.RESPONSE_STARTED, { text });
      
      // Enforce Law 5: Pause wake word and VAD during speech output
      this._pauseCaptureStream();
      
      this._transitionTo(SPEECH_STATES.RESPONDING, { text });
      this.sessionManager.markResponding({ text });
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

  _createSpeechEngine(config = {}) {
    const provider = String(
      config?.voice?.stt?.provider
      || config?.voice?.recognition?.provider
      || 'windows-sapi'
    ).trim().toLowerCase();

    if (provider === 'whisper' || provider === 'whisper-stream') {
      return new WhisperStreamSpeechEngine(config);
    }

    return new WindowsSapiSpeechEngine(config);
  }

  _setupSessionListeners() {
    this.sessionManager.on('sessionStarted', (payload) => {
      this.logger.info('[VOICE] Session started', payload);
      this.eventBus.publish(EVENTS.VOICE_SESSION_STARTED, payload);
      this.emit('sessionStarted', payload);
    });

    this.sessionManager.on('sessionEnded', (payload) => {
      this.logger.info('[VOICE] Session ended', payload);
      this.eventBus.publish(EVENTS.VOICE_SESSION_ENDED, payload);
      this.emit('sessionEnded', payload);
    });

    this.sessionManager.on('stateChanged', (payload) => {
      this.eventBus.publish(EVENTS.VOICE_STATE_CHANGED, payload);
    });

    this.sessionManager.on('timeout', (payload) => {
      this.logger.info('No voice activity for 20 seconds. Stopping listening.', {
        timeoutMs: payload.timeoutMs,
        reason: payload.reason
      });
      this._pauseCaptureStream();
      this._handleSessionTimeout({
        mode: this.conversationActive ? 'conversation' : 'command',
        reason: payload.reason,
        timeoutMs: payload.timeoutMs,
        sessionManagerTimeout: true
      });
    });
  }

  async initialize() {
    this.logger.info('Initializing voice system');
    await this.tts.initialize();
    
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
      const onReady = () => {
        this.workerReady = true;
        this.workerStartupPromise = null;
        resolve();
      };
      const onEvent = (message) => this._handleEngineEvent(message);
      const onError = (error) => {
        if (this._fallbackToWindowsSapi(error)) {
          this.workerStartupPromise = null;
          this._startAudioEngine().then(resolve).catch(reject);
          return;
        }
        this.workerStartupPromise = null;
        reject(error);
      };

      this.stt.once('ready', onReady);
      this.stt.once('error', onError);
      this.stt.on('event', onEvent);

      this.stt.initialize().catch(onError);
    });

    return this.workerStartupPromise;
  }

  _fallbackToWindowsSapi(error) {
    if (this.stt instanceof WindowsSapiSpeechEngine) {
      return false;
    }

    this.logger.warn('Primary STT engine unavailable, falling back to Windows SAPI', {
      provider: this.config?.voice?.stt?.provider || 'unknown',
      error: error?.message || String(error || 'unknown error')
    });

    try {
      this.stt.removeAllListeners();
      this.stt.shutdown?.();
    } catch (shutdownError) {
      this.logger.debug('Failed to shutdown unavailable STT engine', shutdownError.message);
    }

    this.stt = new WindowsSapiSpeechEngine({
      ...this.config,
      voice: {
        ...(this.config?.voice || {}),
        stt: {
          ...(this.config?.voice?.stt || {}),
          provider: 'windows-sapi'
        }
      }
    });
    return true;
  }

  _handleEngineEvent(message) {
    switch (message.event) {
      case 'listening':
        this.logger.debug('STT microphone ready', message);
        break;

      case 'resumed':
        this.logger.debug('STT capture resumed');
        this._flushPendingListenAfterResume('engine-resumed');
        break;

      case 'paused':
        this.logger.debug('STT capture paused');
        break;

      case 'stt_session_activated':
        this.logger.info(`Listening for ${message.mode || 'command'} speech. I will stop after ${this._formatMs(message.timeoutMs || message.startSpeechTimeoutMs)} of silence.`, {
          silenceTimeoutMs: message.timeoutMs || message.startSpeechTimeoutMs,
          backend: message.backend || 'unknown',
          timeoutPolicy: message.timeoutPolicy || 'session'
        });
        break;

      case 'partial_result':
      case 'partialTranscript':
        this.sessionManager.touch(this._getVoiceInactivityTimeoutMs());
        this.eventBus.publish(EVENTS.VOICE_PARTIAL_TRANSCRIPT, {
          text: this._cleanTranscriptText(message.text || ''),
          mode: message.mode || 'command',
          backend: message.backend || 'unknown'
        });
        this.emit('partialTranscript', message);
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
        backend: data.backend || 'windows-sapi'
      };
      
      this.eventBus.publish(EVENTS.STT_COMPLETED, {
        text: inlineCommand,
        backend: data.backend || 'windows-sapi'
      });
      
      this.emit('speechResult', {
        text: inlineCommand,
        isFinal: true,
        backend: data.backend || 'windows-sapi',
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
    const text = this._cleanTranscriptText(data?.text || '');
    const mode = data?.mode || 'command';
    const backend = data?.backend || 'windows-sapi';

    if (!text) {
      this._handleSessionTimeout({
        mode,
        reason: 'no-speech-detected',
        timeoutMs: data?.timeoutMs || this._getVoiceInactivityTimeoutMs()
      });
      return;
    }

    this.sessionManager.touch(this._getVoiceInactivityTimeoutMs());

    this.logger.info(`Transcript received: "${text}"`, {
      mode,
      backend
    });

    this._transitionTo(SPEECH_STATES.TRANSCRIBING);
    this._transitionTo(SPEECH_STATES.THINKING);
    this.sessionManager.markProcessing({
      mode,
      text
    });
    this.eventBus.publish(EVENTS.VOICE_PROCESSING_STARTED, {
      text,
      mode,
      backend
    });
    
    this.eventBus.publish(EVENTS.STT_COMPLETED, {
      text,
      backend
    });
    this.eventBus.publish(EVENTS.VOICE_FINAL_TRANSCRIPT, {
      text,
      mode,
      backend
    });
    
    const utterance = {
      id: 'stt-' + Date.now(),
      text,
      backend
    };

    this.emit('speechResult', {
      text,
      isFinal: true,
      backend,
      mode,
      utterance
    });
    this.eventBus.publish(EVENTS.VOICE_PROCESSING_FINISHED, {
      text,
      mode,
      backend
    });

    if (!this.conversationActive) {
      this.isActive = false;
      this.emit('deactivated');
    }
  }

  _handleSessionTimeout(data) {
    this.logger.info('Voice listening stopped after silence timeout', {
      mode: data?.mode || 'command',
      reason: data?.reason || 'session-timeout',
      timeoutMs: data?.timeoutMs || 0
    });
    this.isActive = false;
    if (!data?.sessionManagerTimeout) {
      this.sessionManager.stop(data?.reason || 'session-timeout');
    }
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

  speak(text) {
    this.tts.speak(text);
  }

  startListening(options = {}) {
    if (this.stateMachine.currentState !== SPEECH_STATES.IDLE) {
      this.logger.info('Voice listen request ignored because the assistant is busy', {
        state: this.stateMachine.getState()
      });
      return false;
    }

    const mode = String(options.mode || 'command');
    const startSpeechTimeoutMs = Number(options.startSpeechTimeoutMs) > 0
      ? Number(options.startSpeechTimeoutMs)
      : mode === 'conversation'
        ? this.conversationSilenceTimeoutMs
        : undefined;
    this.isActive = true;
    this.sessionManager.start({
      mode,
      inactivityTimeoutMs: this._getVoiceInactivityTimeoutMs()
    });
    this._transitionTo(SPEECH_STATES.LISTENING, { mode });
    this.logger.info(`Voice listening started. Speak now; silence timeout is ${this._formatMs(startSpeechTimeoutMs || this._getVoiceInactivityTimeoutMs())}.`, {
      mode,
      silenceTimeoutMs: startSpeechTimeoutMs || this._getVoiceInactivityTimeoutMs(),
      maxUtteranceMs: options.maxDurationMs || null
    });
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
    this.sessionManager.stop('manual-stop');
    this._transitionTo(SPEECH_STATES.IDLE, { reason: 'manual-stop' });
  }

  manualActivate(options = {}) {
    if (!this.allowManualActivation) {
      this.logger.info('Voice activation ignored because manual activation is disabled');
      return false;
    }

    const trigger = typeof options === 'string'
      ? options
      : options?.trigger;

    if (this._canInterruptAssistantSpeech()) {
      return this._interruptAssistantSpeech({ trigger });
    }

    if (this.stateMachine.currentState !== SPEECH_STATES.IDLE) {
      this.logger.info('Voice activation ignored because the assistant is busy', {
        state: this.stateMachine.getState(),
        trigger: trigger || this.config?.voice?.activationShortcut || 'Alt+Space'
      });
      return false;
    }

    const payload = {
      manual: true,
      source: 'hotkey',
      trigger: trigger || this.config?.voice?.activationShortcut || 'Alt+Space'
    };

    this.logger.info('Voice activation requested', payload);
    this.conversationActive = true;
    this.eventBus.publish(EVENTS.VOICE_ACTIVATED, payload);
    this.emit('activated', payload);
    return this.startListening({
      ...this._getConversationListenOptions(),
      resetSpeakerLock: true
    });
  }

  _canInterruptAssistantSpeech() {
    return this.tts?.isSpeaking === true || this.stateMachine.currentState === SPEECH_STATES.RESPONDING;
  }

  _interruptAssistantSpeech(options = {}) {
    this.pendingFollowUpListen = null;
    this.pendingListenAfterResume = null;
    if (this.resumeListenFallbackTimer) {
      clearTimeout(this.resumeListenFallbackTimer);
      this.resumeListenFallbackTimer = null;
    }

    if (typeof this.tts?.stop === 'function') {
      this.tts.stop();
    }

    this._resumeCaptureStream();
    this._transitionTo(SPEECH_STATES.IDLE, { reason: 'barge-in' });

    const payload = {
      manual: true,
      interrupted: true,
      source: 'hotkey',
      trigger: options?.trigger || this.config?.voice?.activationShortcut || 'Alt+Space'
    };

    this.logger.info('Voice activation requested during assistant speech', payload);
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

  _getVoiceInactivityTimeoutMs() {
    return Number(this.config?.voice?.inactivityTimeoutMs) > 0
      ? Number(this.config.voice.inactivityTimeoutMs)
      : this.conversationSilenceTimeoutMs;
  }

  _formatMs(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) {
      return 'the configured timeout';
    }
    if (ms >= 1000) {
      return `${Math.round(ms / 1000)} seconds`;
    }
    return `${ms} ms`;
  }

  _cleanTranscriptText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  _sendEngineCommand(payload) {
    if (this.stt) {
      const command = payload?.command;
      if (command === 'listen') {
        this.stt.listen(payload);
      } else if (command === 'pause') {
        this.stt.pause();
      } else if (command === 'resume') {
        this.stt.resume();
      } else if (command === 'shutdown') {
        this.stt.shutdown();
      }
      return;
    }

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
    if (this.stt) {
      this.stt.shutdown();
    } else if (this.workerProcess) {
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
    this.sessionManager.terminate('destroy');
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
