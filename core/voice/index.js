const EventEmitter = require('events');
const {
  AssistantEventBus,
  EVENTS,
  Logger
} = require('../shared/index');
const WakeWordDetector = require('./wakeword/index');
const SpeechToText = require('./stt/index');
const TextToSpeech = require('./tts/index');
const ActiveListener = require('./listener/index');
const { SPEECH_STATES, SpeechStateMachine } = require('./state/index');

class VoiceManager extends EventEmitter {
  constructor(config, dependencies = {}) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.eventBus = dependencies.eventBus || config?.eventBus || new AssistantEventBus();
    this.wakeWord = dependencies.wakeWord || new WakeWordDetector(config);
    this.stt = dependencies.stt || new SpeechToText(config);
    this.tts = dependencies.tts || new TextToSpeech(config);
    this.listener = dependencies.listener || new ActiveListener(config, { eventBus: this.eventBus });
    this.stateMachine = dependencies.stateMachine || new SpeechStateMachine(this.eventBus);
    this.isActive = false;
    this.isActivating = false;
    this.isDestroyed = false;
    this.allowManualActivation = config?.voice?.allowManualActivation === true;
    this.activationAcknowledgement = String(config?.voice?.activationAcknowledgement || '').trim();
    this.speakActivationAcknowledgement = config?.voice?.speakActivationAcknowledgement === true;
    this._setupListeners();
  }

  _setupListeners() {
    this.wakeWord.on('wakeword', async (data) => {
      if (this.isActivating || this.stt.isListening) {
        return;
      }

      this.logger.info('Wake word detected', data);
      const inlineCommand = data?.inlineCommand === true
        ? this._extractInlineCommand(data?.transcript, data?.wakeWord || this.wakeWord.wakeWord)
        : '';
      this.eventBus.publish(EVENTS.WAKEWORD_DETECTED, data);
      this._transitionTo(SPEECH_STATES.WAKE_DETECTED, {
        wakeWord: data?.wakeWord || this.wakeWord.wakeWord,
        manual: Boolean(data?.manual),
        inlineCommand: inlineCommand || null
      });
      await this.wakeWord.pause();
      this.isActive = true;
      this.emit('activated', data);
      this.listener.startSession({
        trigger: data?.manual ? 'manual' : 'wakeword',
        wakeWord: data?.wakeWord || this.wakeWord.wakeWord
      });

      if (this.isDestroyed) {
        return;
      }

      if (inlineCommand) {
        this.logger.info('Using inline wake-word command', { command: inlineCommand });
        this.listener.noteSpeechDetected({
          backend: 'wakeword-inline',
          source: 'wakeword'
        });
        const utterance = this.listener.finalizeUtterance({
          text: inlineCommand,
          confidence: Number(data?.confidence) || 1,
          backend: 'wakeword-inline',
          reason: 'wakeword-inline-command'
        });
        this._transitionTo(SPEECH_STATES.PROCESSING, {
          backend: 'wakeword-inline',
          utteranceId: utterance?.id || null
        });
        this.eventBus.publish(EVENTS.STT_COMPLETED, {
          text: inlineCommand,
          confidence: Number(data?.confidence) || 1,
          backend: 'wakeword-inline',
          utteranceId: utterance?.id || null
        });
        this.emit('speechResult', {
          text: inlineCommand,
          confidence: Number(data?.confidence) || 1,
          isFinal: true,
          backend: 'wakeword-inline',
          utterance
        });
        this.listener.stopSession('wakeword-inline-command');
        this.isActive = false;
        this.emit('deactivated');
        if (!this.isDestroyed) {
          this.wakeWord.resume().catch((err) => {
            this.logger.warn('Unable to resume wake-word detection', err.message);
          });
        }
        return;
      }

      this._transitionTo(SPEECH_STATES.LISTENING, { phase: 'awaiting-speech' });
      this.stt.startListening();

      if (this.speakActivationAcknowledgement && this.activationAcknowledgement) {
        this.isActivating = true;
        this.tts.speakAsync(this.activationAcknowledgement)
          .catch((err) => {
            this.logger.warn('Activation acknowledgement failed', err.message);
          })
          .finally(() => {
            this.isActivating = false;
          });
      }
    });

    this.wakeWord.on('ready', () => {
      this.emit('ready');
    });

    this.stt.on('result', (data) => {
      this.listener.noteSpeechDetected({
        backend: data?.backend || this.stt.backend,
        source: 'stt'
      });
      this._transitionTo(SPEECH_STATES.HEARING_SPEECH, {
        backend: data?.backend || this.stt.backend
      });
      const utterance = this.listener.finalizeUtterance({
        text: data?.text || '',
        confidence: data?.confidence ?? null,
        backend: data?.backend || this.stt.backend,
        reason: 'transcription-complete'
      });
      this._transitionTo(SPEECH_STATES.PROCESSING, {
        backend: data?.backend || this.stt.backend,
        utteranceId: utterance?.id || null
      });
      this.eventBus.publish(EVENTS.STT_COMPLETED, {
        ...data,
        utteranceId: utterance?.id || null
      });
      if (!data?.text || !String(data.text).trim()) {
        this.logger.info('STT completed without speech content', {
          backend: data?.backend || this.stt.backend
        });
        this.emit('speechTimeout', {
          backend: data?.backend || this.stt.backend
        });
        return;
      }
      this.logger.info('Speech recognized', data);
      this.emit('speechResult', { ...data, utterance });
    });

    this.stt.on('listening', () => {
      this._transitionTo(SPEECH_STATES.LISTENING, {
        backend: this.stt.backend
      });
      this.emit('listening');
    });

    this.stt.on('stopped', () => {
      this.isActive = false;
      this.isActivating = false;
      this.listener.stopSession('stt-stopped');
      this.emit('deactivated');
      this._transitionTo(SPEECH_STATES.IDLE, {
        reason: 'stt-stopped'
      });
      if (!this.isDestroyed) {
        this.wakeWord.resume().catch((err) => {
          this.logger.warn('Unable to resume wake-word detection', err.message);
        });
      }
    });

    this.tts.on('speaking', (text) => {
      this.eventBus.publish(EVENTS.RESPONSE_STARTED, { text });
      this._transitionTo(SPEECH_STATES.RESPONDING, { text });
      this.emit('speaking', text);
    });

    this.tts.on('completed', () => {
      this.eventBus.publish(EVENTS.RESPONSE_COMPLETED, {});
      if (!this.isActive && !this.stt.isListening) {
        this._transitionTo(SPEECH_STATES.IDLE, { reason: 'tts-complete' });
      }
      this.emit('speechCompleted');
    });

    this.tts.on('error', (error) => {
      this.eventBus.publish(EVENTS.VOICE_ERROR, {
        stage: 'tts',
        message: error?.message || String(error || 'Unknown TTS error')
      });
      this._transitionTo(SPEECH_STATES.ERROR, {
        stage: 'tts'
      });
    });

    this.listener.on('hearingSpeech', (detail) => {
      this._transitionTo(SPEECH_STATES.HEARING_SPEECH, detail);
      this.emit('hearingSpeech', detail);
    });

    this.listener.on('utterance', (detail) => {
      this.emit('utteranceFinalized', detail);
    });
  }

  async initialize() {
    this.logger.info('Initializing voice system');
    await this.tts.initialize();
    await this.stt.initialize();
    await this.wakeWord.start();
    this.logger.info('Voice system ready');
    return true;
  }

  speak(text) {
    this.tts.speak(text);
  }

  startListening() {
    return this.manualActivate();
  }

  stopListening() {
    this.stt.stopListening();
    this.isActive = false;
    this.isActivating = false;
    this.listener.stopSession('manual-stop');
    this._transitionTo(SPEECH_STATES.IDLE, { reason: 'manual-stop' });
  }

  manualActivate() {
    if (!this.allowManualActivation) {
      this.logger.info('Manual voice activation ignored because wake-word-only mode is enabled');
      return false;
    }

    this.wakeWord.manualActivate();
    return true;
  }

  destroy() {
    this.isDestroyed = true;
    this.listener.stopSession('destroy');
    this.wakeWord.destroy();
    this.stt.destroy();
    this.tts.destroy();
    this.removeAllListeners();
  }

  getStatus() {
    return {
      active: this.isActive,
      activating: this.isActivating,
      listening: this.stt.isListening,
      state: this.stateMachine.getState()
    };
  }

  _transitionTo(nextState, metadata = {}) {
    try {
      return this.stateMachine.transition(nextState, metadata);
    } catch (error) {
      if (error?.code !== 'INVALID_SPEECH_STATE_TRANSITION') {
        throw error;
      }

      this.logger.debug('Ignoring invalid speech state transition', {
        from: this.stateMachine.getState(),
        to: nextState,
        metadata
      });
      return {
        changed: false,
        previousState: this.stateMachine.getState(),
        currentState: this.stateMachine.getState(),
        metadata
      };
    }
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
}

module.exports = VoiceManager;
