const EventEmitter = require('events');
const {
  AssistantEventBus,
  EVENTS,
  Logger,
  Normalizer
} = require('../shared/index');
const TextToSpeech = require('./tts/index');
const WindowsSapiSpeechEngine = require('./stt/windows-sapi');
const WhisperStreamSpeechEngine = require('./stt/whisper-stream');
const { SPEECH_STATES, SpeechStateMachine } = require('./state/index');
const IntentRegistry = require('../assistant/intents/index').IntentRegistry;
const NlpProcessor = require('../assistant/nlp/index');
const TranscriptNormalizer = require('./transcript/transcript-normalizer');
const CommandRecoveryReranker = require('./recovery/reranker');
const VoiceConfidenceGate = require('./confidence/index');
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
    this.conversationIgnoredSpeechLimit = Number(config?.voice?.conversationIgnoredSpeechLimit) >= 0
      ? Number(config.voice.conversationIgnoredSpeechLimit)
      : 1;
    this.conversationIgnoredSpeechCount = 0;
    
    this.stt = dependencies.stt || this._createSpeechEngine(config);
    this.nlp = dependencies.nlp || new NlpProcessor(new IntentRegistry());
    this.transcriptNormalizer = dependencies.transcriptNormalizer || new TranscriptNormalizer();
    this.recovery = dependencies.recovery || new CommandRecoveryReranker(config?.voice?.recovery || {});
    this.confidenceGate = dependencies.confidenceGate || new VoiceConfidenceGate(config?.voice?.confidence || {});
    this.workerProcess = null;
    this.workerReady = false;
    this.workerStartupPromise = null;
    this.pendingFollowUpListen = null;
    this.pendingListenAfterResume = null;
    this.resumeListenFallbackTimer = null;
    this.pendingVoiceFragment = null;
    
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
          text: this._normalizeTranscript(message.text || ''),
          mode: message.mode || 'command',
          backend: message.backend || 'unknown'
        });
        this.emit('partialTranscript', message);
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
        backend: data.backend || 'windows-sapi'
      };
      
      this.eventBus.publish(EVENTS.STT_COMPLETED, {
        text: inlineCommand,
        confidence: data.confidence || 1.0,
        backend: data.backend || 'windows-sapi'
      });
      
      this.emit('speechResult', {
        text: inlineCommand,
        confidence: data.confidence || 1.0,
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
    const selected = this._selectReliableTranscript(data);
    const normalizedText = selected.text;
    const reliability = selected.reliability;
    if (!reliability.accepted) {
      if (reliability.reason === 'incompleteCommand' || reliability.reason === 'incomplete-command-fragment') {
        this.pendingVoiceFragment = {
          verb: normalizedText,
          mode: data?.mode || 'command',
          createdAt: Date.now()
        };
      }
      this._handleIgnoredSpeech({
        mode: data?.mode || 'command',
        reason: reliability.reason,
        confidence: selected.confidence ?? data?.confidence ?? null,
        text: normalizedText,
        rawText: data?.text || ''
      });
      return;
    }

    this.pendingVoiceFragment = null;
    this.sessionManager.touch(this._getVoiceInactivityTimeoutMs());

    this.logger.info(`Heard: "${normalizedText}"`, {
      mode: data?.mode || 'command',
      confidence: selected.confidence,
      decision: reliability.action || reliability.voiceTurn?.decision || 'execute',
      quality: reliability.voiceTurn?.quality ?? null,
      backend: data.backend || 'windows-sapi'
    });

    this._transitionTo(SPEECH_STATES.TRANSCRIBING);
    this._transitionTo(SPEECH_STATES.THINKING);
    this.sessionManager.markProcessing({
      mode: data?.mode || 'command',
      text: normalizedText
    });
    this.eventBus.publish(EVENTS.VOICE_PROCESSING_STARTED, {
      text: normalizedText,
      mode: data?.mode || 'command',
      backend: data.backend || 'windows-sapi'
    });
    
    this.eventBus.publish(EVENTS.STT_COMPLETED, {
      text: normalizedText,
      confidence: selected.confidence,
      voiceTurn: reliability.voiceTurn,
      backend: data.backend || 'windows-sapi'
    });
    this.eventBus.publish(EVENTS.VOICE_FINAL_TRANSCRIPT, {
      text: normalizedText,
      confidence: selected.confidence,
      mode: data.mode || 'command',
      voiceTurn: reliability.voiceTurn,
      backend: data.backend || 'windows-sapi'
    });
    
    const utterance = {
      id: 'stt-' + Date.now(),
      text: normalizedText,
      confidence: selected.confidence,
      backend: data.backend || 'windows-sapi',
      voiceTurn: reliability.voiceTurn
    };

    this.emit('speechResult', {
      text: normalizedText,
      confidence: selected.confidence,
      isFinal: true,
      backend: data.backend || 'windows-sapi',
      mode: data.mode || 'command',
      voiceTurn: reliability.voiceTurn,
      utterance
    });
    this.eventBus.publish(EVENTS.VOICE_PROCESSING_FINISHED, {
      text: normalizedText,
      mode: data.mode || 'command',
      backend: data.backend || 'windows-sapi'
    });

    if (!this.conversationActive) {
      this.isActive = false;
      this.emit('deactivated');
    } else {
      this.conversationIgnoredSpeechCount = 0;
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
      this.conversationIgnoredSpeechCount = 0;
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
    this.sessionManager.touch(this._getVoiceInactivityTimeoutMs());

    this.logger.info(`Ignored non-command speech: "${data?.text || ''}"`, {
      mode: data?.mode || 'command',
      reason: data?.reason || 'filtered',
      rawText: data?.rawText || '',
      confidence: data?.confidence ?? null
    });

    this._transitionTo(SPEECH_STATES.IDLE, {
      reason: data?.reason || 'ignored-speech',
      mode: data?.mode || 'command'
    });

    if (this.conversationActive && !this.isDestroyed) {
      this.conversationIgnoredSpeechCount += 1;
      if (this.conversationIgnoredSpeechCount > this.conversationIgnoredSpeechLimit) {
        this.conversationActive = false;
        this.conversationIgnoredSpeechCount = 0;
        this.isActive = false;
        this.emit('deactivated');
        this.emit('listeningTimeout', {
          mode: data?.mode || 'conversation',
          timeoutMs: 0,
          reason: data?.reason || 'ignored-speech'
        });
        return;
      }

      this.startListening(this._getConversationListenOptions());
    }
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
    this.conversationIgnoredSpeechCount = 0;
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
    this.conversationIgnoredSpeechCount = 0;
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

  _normalizeTranscript(text) {
    return this.transcriptNormalizer.normalize(text);
  }

  _assessTranscriptReliability(text, data = {}) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
      return { accepted: false, reason: 'empty-transcript' };
    }

    const mode = String(data?.mode || 'command');
    const confidence = Number(data?.confidence);
    const conversational = this._looksLikeConversationalTranscript(normalized);
    const commandLike = this._looksLikeActionableTranscript(normalized) || conversational;
    const defaultMinConfidence = mode === 'confirmation'
      ? Number(this.config?.voice?.stt?.confirmationMinConfidence ?? 0.45)
      : Number(this.config?.voice?.stt?.minConfidence ?? 0.55);
    const commandRecoveryMinConfidence = Number(this.config?.voice?.stt?.commandRecoveryMinConfidence ?? 0.25);
    if (
      Number.isFinite(confidence)
      && confidence < defaultMinConfidence
      && (confidence < commandRecoveryMinConfidence || !commandLike)
    ) {
      return { accepted: false, reason: 'low-transcript-confidence' };
    }

    const gate = this.confidenceGate.assess(normalized, Number.isFinite(confidence) ? confidence : 0.8, {
      ...data,
      mode,
      commandLike
    });
    const hardRejectReasons = new Set([
      'knownHallucination',
      'incompleteCommand',
      'repeatedLeadIn',
      'repetitive',
      'speakerMismatch',
      'speaker-not-verified',
      'tooShort'
    ]);
    if (
      gate.action === 'ignore'
      && (!commandLike || gate.turn?.reasons?.some(reason => hardRejectReasons.has(reason)))
    ) {
      return { accepted: false, reason: gate.reason, voiceTurn: gate.turn };
    }

    const noSpeechProbability = Number(data?.noSpeechProbability);
    const maxNoSpeechProbability = Number(this.config?.voice?.stt?.maxNoSpeechProbability ?? 0.55);
    if (
      Number.isFinite(noSpeechProbability)
      && noSpeechProbability > maxNoSpeechProbability
      && (noSpeechProbability > 0.85 || !commandLike)
      && !conversational
    ) {
      return { accepted: false, reason: 'transcript-marked-no-speech', voiceTurn: gate.turn };
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (this._isNonActionableTranscript(tokens, mode, normalized)) {
      return { accepted: false, reason: 'non-actionable-transcript', voiceTurn: gate.turn };
    }

    const noisePhrases = new Set([
      'thank you',
      'thanks for watching',
      'subscribe',
      'music',
      'background music',
      'blank audio',
      'blank_audio',
      'boom',
      'no speech',
      'no_speech',
      'oh',
      'silence',
      'yes yes'
    ]);
    if (noisePhrases.has(normalized)) {
      return { accepted: false, reason: 'known-hallucination-phrase', voiceTurn: gate.turn };
    }

    const uniqueTokens = new Set(tokens);
    if (tokens.length >= 5 && uniqueTokens.size <= 2) {
      return { accepted: false, reason: 'repetitive-transcript', voiceTurn: gate.turn };
    }

    if (this._isIncompleteCommandFragment(normalized, mode)) {
      return { accepted: false, reason: 'incomplete-command-fragment', voiceTurn: gate.turn };
    }

    return {
      accepted: true,
      action: gate.action === 'ignore' ? 'execute' : gate.action,
      reason: gate.action === 'ignore' ? 'actionable-low-confidence' : gate.reason,
      voiceTurn: gate.turn
        ? {
            ...gate.turn,
            decision: gate.action === 'ignore' ? 'execute' : gate.turn.decision,
            reasons: gate.action === 'ignore'
              ? Array.from(new Set([...(gate.turn.reasons || []), 'actionable-low-confidence']))
              : gate.turn.reasons
          }
        : gate.turn
    };
  }

  _selectReliableTranscript(data = {}) {
    const candidates = this._buildTranscriptCandidates(data);
    let first = null;

    for (const candidate of candidates) {
      const reliability = this._assessTranscriptReliability(candidate.text, {
        ...data,
        confidence: candidate.confidence
      });
      const enriched = {
        ...candidate,
        reliability
      };

      if (!first) {
        first = enriched;
      }

      if (reliability.accepted && this._looksLikeActionableTranscript(candidate.text)) {
        return enriched;
      }
    }

    const accepted = candidates
      .map(candidate => ({
        ...candidate,
        reliability: this._assessTranscriptReliability(candidate.text, {
          ...data,
          confidence: candidate.confidence
        })
      }))
      .find(candidate => candidate.reliability.accepted);

    return accepted || first || {
      text: '',
      confidence: 0,
      reliability: { accepted: false, reason: 'empty-transcript' }
    };
  }

  _buildTranscriptCandidates(data = {}) {
    const candidates = [];
    const pushCandidate = (text, confidence) => {
      const normalized = this._normalizeTranscript(text);
      if (!normalized) {
        return;
      }
      if (candidates.some(candidate => candidate.text.toLowerCase() === normalized.toLowerCase())) {
        return;
      }
      const score = Number(confidence);
      candidates.push({
        text: normalized,
        confidence: Number.isFinite(score) ? score : 0.8
      });
    };

    if (
      this.pendingVoiceFragment?.verb
      && Date.now() - Number(this.pendingVoiceFragment.createdAt || 0) > 8000
    ) {
      this.pendingVoiceFragment = null;
    }

    const rawText = this._normalizeTranscript(data.text);
    const allowRecovery = !this._isUnreliableTranscriptForRecovery(rawText);

    if (this.pendingVoiceFragment?.verb && data?.text && allowRecovery) {
      const target = this._normalizeTranscript(data.text);
      if (target && !this._isIncompleteCommandFragment(target, data?.mode || 'command')) {
        pushCandidate(`${this.pendingVoiceFragment.verb} ${target}`, Number(data.confidence) > 0 ? Number(data.confidence) : 0.72);
      }
    }

    if (allowRecovery) {
      this._buildRecoveredTranscriptVariants(data.text).forEach(variant => {
        pushCandidate(variant.text, variant.confidence);
      });
      this._buildNlpTranscriptVariants(data.text).forEach(variant => {
        pushCandidate(variant, Number(data.confidence) > 0 ? Number(data.confidence) : 0.72);
      });
    }
    pushCandidate(data.text, data.confidence);
    if (Array.isArray(data.alternates)) {
      for (const alternate of data.alternates) {
        const alternateRawText = this._normalizeTranscript(alternate?.text);
        const allowAlternateRecovery = !this._isUnreliableTranscriptForRecovery(alternateRawText);
        if (allowAlternateRecovery) {
          this._buildRecoveredTranscriptVariants(alternate?.text).forEach(variant => {
            pushCandidate(variant.text, variant.confidence);
          });
          this._buildNlpTranscriptVariants(alternate?.text).forEach(variant => {
            pushCandidate(variant, Number(alternate?.confidence) > 0 ? Number(alternate.confidence) : 0.72);
          });
        }
        pushCandidate(alternate?.text, alternate?.confidence);
      }
    }

    return candidates;
  }

  _buildRecoveredTranscriptVariants(text) {
    const raw = this._normalizeTranscript(text);
    if (!raw) {
      return [];
    }

    try {
      const recovered = this.recovery.recover(raw);
      if (!recovered.changed || !recovered.correctedText) {
        return [];
      }
      return [{
        text: recovered.correctedText,
        confidence: recovered.confidence
      }];
    } catch (error) {
      this.logger.debug('Voice command recovery failed', error.message);
      return [];
    }
  }

  _buildNlpTranscriptVariants(text) {
    const raw = this._normalizeTranscript(text);
    if (!raw) {
      return [];
    }

    try {
      const prepared = this.nlp.prepare(raw);
      return [
        prepared.repairedCommandText,
        prepared.correctedText,
        prepared.commandText
      ]
        .map(value => this._normalizeTranscript(value))
        .filter(value => value && value.toLowerCase() !== raw.toLowerCase());
    } catch (error) {
      this.logger.debug('Voice NLP transcript preparation failed', error.message);
      return [];
    }
  }

  _isNonActionableTranscript(tokens, mode, normalized = '') {
    if (mode === 'confirmation') {
      return false;
    }

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return true;
    }

    const text = String(normalized || '').trim().toLowerCase();
    if (this._isIncompleteCommandFragment(text, mode)) {
      return true;
    }

    const allowedPhrases = new Set([
      'help',
      'show help',
      'system status',
      'what can you do',
      'pause',
      'resume',
      'continue',
      'stop',
      'cancel',
      'yes',
      'no',
      'mute',
      'unmute'
    ]);

    if (allowedPhrases.has(text)) {
      return false;
    }

    if (
      this._looksLikeQuestionTranscript(text)
      || this._looksLikeActionableTranscript(text)
      || this._looksLikeConversationalTranscript(text)
    ) {
      return false;
    }

    const allowedSingleTokenCommands = new Set([
      'help',
      'pause',
      'resume',
      'continue',
      'stop',
      'cancel',
      'yes',
      'no',
      'mute',
      'unmute'
    ]);

    if (tokens.length === 1) {
      return !allowedSingleTokenCommands.has(tokens[0]);
    }

    return true;
  }

  _looksLikeQuestionTranscript(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!/^(?:what|who|when|where|why|how|which)\b/.test(normalized)) {
      return false;
    }

    const targetTokens = new Set([
      'alarm',
      'apple',
      'browser',
      'brightness',
      'calculator',
      'chatgpt',
      'chrome',
      'claude',
      'desktop',
      'documents',
      'downloads',
      'edge',
      'event',
      'excel',
      'file',
      'firefox',
      'folder',
      'gemini',
      'google',
      'link',
      'music',
      'notepad',
      'perplexity',
      'powerpoint',
      'reminder',
      'result',
      'spotify',
      'teams',
      'timer',
      'volume',
      'whatsapp',
      'window',
      'word',
      'date',
      'day',
      'ipl',
      'news',
      'time',
      'wwdc',
      'youtube'
    ]);

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.some(token => targetTokens.has(token)) || tokens.length >= 5;
  }

  _looksLikeConversationalTranscript(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const directPhrases = new Set([
      'bye',
      'good afternoon',
      'good evening',
      'good morning',
      'hello',
      'help',
      'hey',
      'hi',
      'how are you',
      'thanks',
      'what can you do',
      'what is your name',
      'whats your name'
    ]);
    if (directPhrases.has(normalized)) {
      return true;
    }

    return /^(?:hi|hello|hey|good)\b/.test(normalized)
      && normalized.split(/\s+/).filter(Boolean).length <= 5;
  }

  _isIncompleteCommandFragment(text, mode = 'command') {
    if (mode === 'confirmation') {
      return false;
    }

    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized || /\s/.test(normalized)) {
      return false;
    }

    const incompleteVerbs = new Set([
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

    return incompleteVerbs.has(normalized);
  }

  _isUnreliableTranscriptForRecovery(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    const compact = normalized
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokens = compact.split(/\s+/).filter(Boolean);
    const noisePhrases = new Set([
      'background music',
      'blank audio',
      'blank_audio',
      'boom',
      'foreign',
      'music',
      'no speech',
      'no_speech',
      'oh',
      'silence',
      'thank you',
      'thanks for watching',
      'yes yes'
    ]);
    if (noisePhrases.has(compact)) {
      return true;
    }

    if (tokens.length >= 4) {
      const [lastToken] = tokens.slice(-1);
      const leadingTokens = tokens.slice(0, -1);
      const counts = new Map();
      for (const token of leadingTokens) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
      const maxLeadCount = Math.max(...counts.values());
      if (maxLeadCount >= 3 && this._isLikelyActionToken(lastToken)) {
        return true;
      }
    }

    return tokens.length >= 5 && new Set(tokens).size / tokens.length <= 0.45;
  }

  _isLikelyActionToken(token) {
    return new Set([
      'attach',
      'call',
      'clean',
      'close',
      'continue',
      'copy',
      'create',
      'delete',
      'draft',
      'extract',
      'find',
      'go',
      'launch',
      'message',
      'minimize',
      'move',
      'open',
      'pause',
      'play',
      'read',
      'rename',
      'resume',
      'search',
      'send',
      'share',
      'show',
      'skip',
      'start',
      'stop',
      'switch'
    ]).has(String(token || '').toLowerCase());
  }

  _looksLikeActionableTranscript(text) {
    const normalized = String(text || '').trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return false;
    }

    const actionTokens = new Set([
      'open', 'close', 'launch', 'start', 'run', 'search', 'find', 'play', 'pause',
      'resume', 'stop', 'mute', 'unmute', 'increase', 'decrease', 'set', 'turn',
      'switch', 'show', 'create', 'delete', 'move', 'copy', 'rename', 'call', 'message',
      'maximize', 'minimize', 'fullscreen', 'google', 'look', 'lookup', 'queue',
      'remind', 'stream', 'watch'
    ]);
    const targetTokens = new Set([
      'chrome', 'youtube', 'edge', 'firefox', 'spotify', 'notepad', 'calculator',
      'downloads', 'documents', 'desktop', 'volume', 'brightness', 'timer', 'alarm',
      'reminder', 'whatsapp', 'teams', 'word', 'excel', 'powerpoint', 'music', 'window',
      'folder', 'file', 'browser', 'chatgpt', 'claude', 'gemini', 'perplexity', 'google',
      'link', 'result'
    ]);

    const hasActionToken = (token) => {
      if (actionTokens.has(token)) {
        return true;
      }
      if (!token || token.length < 3) {
        return false;
      }
      if (token.length <= 3) {
        return false;
      }
      return Boolean(Normalizer.findClosestOption(token, Array.from(actionTokens), {
        minSimilarity: token.length >= 5 ? 0.62 : 0.72,
        maxDistance: token.length >= 5 ? 2 : 1
      }));
    };

    if (hasActionToken(tokens[0])) {
      return true;
    }

    const fillerTokens = new Set([
      'a', 'an', 'and', 'but', 'can', 'could', 'for', 'i', 'is', 'just', 'me',
      'my', 'now', 'ok', 'okay', 'please', 'saying', 'the', 'to', 'uh', 'um',
      'was', 'would', 'you'
    ]);
    const actionIndex = tokens.findIndex(token => hasActionToken(token));
    if (
      actionIndex >= 0
      && tokens.slice(actionIndex + 1).some(token => !fillerTokens.has(token))
    ) {
      return true;
    }

    return tokens.some(token => hasActionToken(token))
      && tokens.some(token => targetTokens.has(token));
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
    this.conversationIgnoredSpeechCount = 0;
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
