'use strict';

const EventEmitter = require('events');
const VoiceSession = require('./VoiceSession');
const VoiceStateMachine = require('./VoiceStateMachine');
const { SESSION_EVENTS, VOICE_ERROR_TYPES } = require('./SessionEvents');
const VoiceSettings = require('../config/VoiceSettings');
const VoiceLogger = require('../diagnostics/VoiceLogger');
const VoiceMetrics = require('../diagnostics/VoiceMetrics');
const { AudioCapture, AUDIO_EVENTS } = require('../audio');
const { AudioProcessor, SpeechSourceClassifier, AUDIO_PROCESSING_EVENTS } = require('../preprocessing');
const { STTEngine, STT_EVENTS } = require('../stt');
const { TranscriptProcessor, NORMALIZATION_EVENTS } = require('../normalization');

/**
 * Purpose: Central lifecycle controller for every future OpenX Voice interaction.
 * Responsibility: Own session creation, state transitions, resource placeholders, timeouts, cleanup, events, logging, and metrics.
 * Lifecycle: The manager moves from IDLE through INITIALIZING, READY, LISTENING, PROCESSING, EXECUTING, then closes back to IDLE.
 * Dependencies: VoiceSession, VoiceStateMachine, VoiceLogger, VoiceMetrics, and injectable timer/clock functions for deterministic tests.
 * Future integration notes: Electron, hotkeys, microphone capture, STT, preprocessing, UI, and assistant execution must call this manager instead of controlling each other directly.
 */
class VoiceSessionManager {
  /**
   * Create the Voice session manager.
   * @param {{SessionClass?: typeof VoiceSession, AudioCaptureClass?: typeof AudioCapture, AudioProcessorClass?: typeof AudioProcessor, SpeechSourceClassifierClass?: typeof SpeechSourceClassifier, STTEngineClass?: typeof STTEngine, TranscriptProcessorClass?: typeof TranscriptProcessor, stateMachine?: VoiceStateMachine, logger?: VoiceLogger, metrics?: VoiceMetrics, clock?: () => Date, setTimeout?: Function, clearTimeout?: Function, timeouts?: object, resources?: object}} dependencies Replaceable dependencies.
   */
  constructor(dependencies = {}) {
    this.SessionClass = dependencies.SessionClass || VoiceSession;
    this.AudioCaptureClass = dependencies.AudioCaptureClass || AudioCapture;
    this.AudioProcessorClass = dependencies.AudioProcessorClass || AudioProcessor;
    this.SpeechSourceClassifierClass = dependencies.SpeechSourceClassifierClass || SpeechSourceClassifier;
    this.STTEngineClass = dependencies.STTEngineClass || STTEngine;
    this.TranscriptProcessorClass = dependencies.TranscriptProcessorClass || TranscriptProcessor;
    this.stateMachine = dependencies.stateMachine || new VoiceStateMachine();
    this.logger = dependencies.logger || new VoiceLogger();
    this.metricsRecorder = dependencies.metrics || new VoiceMetrics();
    this.clock = dependencies.clock || (() => new Date());
    this.setTimer = dependencies.setTimeout || setTimeout;
    this.clearTimer = dependencies.clearTimeout || clearTimeout;
    this.timeouts = {
      ...VoiceSettings.session.timeouts,
      ...(dependencies.timeouts || {})
    };
    this.resources = {
      audioCapture: dependencies.resources?.audioCapture || null,
      audioProcessor: dependencies.resources?.audioProcessor || null,
      speechSourceClassifier: dependencies.resources?.speechSourceClassifier || null,
      sttEngine: dependencies.resources?.sttEngine || null,
      transcriptProcessor: dependencies.resources?.transcriptProcessor || null,
      ui: null,
      diagnostics: null,
      ...(dependencies.resources || {})
    };
    this.events = new EventEmitter();
    this.currentSession = null;
    this.currentState = this.stateMachine.getInitialState();
    this.activeTimers = new Map();
    this.transitionLog = [];
    this.sessionHistory = [];
    this.recognitionCycleSequence = 0;
    this.recognitionCycle = this._createRecognitionCycle('manager-created');
    this.speechPrerollFrames = [];
    this.speechPrerollFrameLimit = 35;
    this.runtimePipelineStats = {
      audioFrames: 0,
      processedFrames: 0,
      sttFrames: 0,
      partialTranscripts: 0,
      finalTranscripts: 0,
      duplicatePartials: 0,
      suppressedPartials: 0,
      staleTranscripts: 0,
      duplicateFinals: 0,
      emptyFinals: 0,
      endpointDetections: 0,
      finalizationRequests: 0,
      speechCandidates: 0,
      acceptedSpeechCandidates: 0,
      rejectedSpeechCandidates: 0,
      rejectedNonSpeech: 0,
      rejectedBackgroundAudio: 0,
      rejectedTransientNoise: 0,
      rejectedElectronicAudio: 0,
      rejectedLowConfidenceSpeech: 0,
      rejectedUnstableSpeech: 0,
      speechPrerollFramesBuffered: 0,
      speechPrerollFramesFlushed: 0,
      audioFramesWhileBusy: 0,
      staleAudioFrames: 0,
      recognitionConsumerPauses: 0,
      recognitionConsumerResumes: 0,
      captureBufferFlushes: 0,
      captureBufferFlushedFrames: 0,
      assistantTurns: 0,
      userTurns: 0,
      ttsStarts: 0,
      ttsCompletions: 0,
      ttsCancellations: 0,
      ttsFailures: 0,
      duplicateConversationResumes: 0,
      listeningCycles: 0,
      lastPartialTranscript: '',
      lastLogAt: 0
    };
    this._audioFrameListener = event => this._processAudioFrameForSession(event.frame);
    this._processedFrameListener = event => this._deliverAudioFrameToSession(event.frame);
    this._partialTranscriptListener = event => this._deliverTranscriptResultToSession(event.result);
    this._finalTranscriptListener = event => this._deliverTranscriptResultToSession(event.result);
    this._normalizedTranscriptListener = event => this._deliverNormalizedTranscriptToSession(event.normalizedTranscript);
    if (this.resources.audioCapture) {
      this._attachAudioCapture(this.resources.audioCapture);
    }
    if (this.resources.audioProcessor) {
      this._attachAudioProcessor(this.resources.audioProcessor);
    }
    if (this.resources.sttEngine) {
      this._attachSTTEngine(this.resources.sttEngine);
    }
    if (this.resources.transcriptProcessor) {
      this._attachTranscriptProcessor(this.resources.transcriptProcessor);
    }
  }

  /**
   * Subscribe to a Voice lifecycle event.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  on(eventName, listener) {
    this.events.on(eventName, listener);
    return this;
  }

  /**
   * Subscribe once to a Voice lifecycle event.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  once(eventName, listener) {
    this.events.once(eventName, listener);
    return this;
  }

  /**
   * Remove a Voice lifecycle event listener.
   * @param {string} eventName Event name from SESSION_EVENTS.
   * @param {Function} listener Event listener.
   * @returns {VoiceSessionManager}
   */
  off(eventName, listener) {
    this.events.off(eventName, listener);
    return this;
  }

  /**
   * Initialize manager-owned resources and move to READY.
   * @returns {{success: boolean, state: string}}
   */
  initialize() {
    if (this.currentState === VoiceStateMachine.STATES.READY) {
      return { success: true, state: this.currentState };
    }
    this._transitionTo(VoiceStateMachine.STATES.INITIALIZING, { reason: 'initialize' });
    this._scheduleLifecycleTimeout('initialization', this.timeouts.initializationMs);
    this._transitionTo(VoiceStateMachine.STATES.READY, { reason: 'initialize-complete' });
    this._publish(SESSION_EVENTS.VOICE_SESSION_INITIALIZED, this._buildEventPayload());
    return { success: true, state: this.currentState };
  }

  /**
   * Warm non-microphone resources so the first Alt+Space press does less work.
   * This never opens the microphone and never creates a Voice session.
   * @param {string} reason Warm-up reason for diagnostics.
   * @returns {{success: boolean, state: string, warmed: string[], failed: object[]}}
   */
  warmUpResources(reason = 'warm-up') {
    if (this.currentSession) {
      return { success: false, state: this.currentState, warmed: [], failed: [{ resource: 'session', error: 'Voice session is active.' }] };
    }
    if (this.currentState === VoiceStateMachine.STATES.IDLE) {
      this.initialize();
    }

    const warmed = [];
    const failed = [];
    const warm = (resource, action) => {
      try {
        action();
        warmed.push(resource);
      } catch (error) {
        failed.push({ resource, error: error.message });
        if (this.currentSession) {
          this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
            error: this._normalizeError(error)
          }));
        }
      }
    };

    warm('audioProcessor', () => this._getAudioProcessor().initialize());
    warm('sttEngine', () => {
      const sttEngine = this._getSTTEngine();
      if (!sttEngine.getStatus?.().initialized) sttEngine.initialize();
    });
    warm('transcriptProcessor', () => this._getTranscriptProcessor().getStatus());

    this._log('Resources Warmed', { reason, warmed, failed });
    return { success: failed.length === 0, state: this.currentState, warmed, failed };
  }

  /**
   * Create a session and immediately begin listening through the validated lifecycle.
   * @param {{id?: string, sessionId?: string, transcript?: string}} options Session options.
   * @returns {{success: boolean, state: string, session: object}}
   */
  startSession(options = {}) {
    this.prepareSession(options);
    return this.beginListening();
  }

  /**
   * Create a single owned session without starting audio capture.
   * @param {{id?: string, sessionId?: string, transcript?: string}} options Session options.
   * @returns {{success: boolean, state: string, session: object}}
   */
  prepareSession(options = {}) {
    this._assertNoActiveSession();
    if (this.currentState === VoiceStateMachine.STATES.IDLE) {
      this.initialize();
    }
    if (this.currentState !== VoiceStateMachine.STATES.READY) {
      throw new Error(`Cannot prepare Voice session from ${this.currentState}.`);
    }

    this._resetRuntimePipelineStats();
    this.currentSession = new this.SessionClass(options);
    this.currentSession.setState(this.currentState, { at: this.clock(), reason: 'prepared' });
    this._scheduleLifecycleTimeout('overall', this.timeouts.overallMs);
    this._publish(SESSION_EVENTS.VOICE_SESSION_CREATED, this._buildEventPayload());
    this._log('Session Created', { state: this.currentState, sessionId: this.currentSession.sessionId });
    return this._result();
  }

  /**
   * Move the current session into LISTENING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginListening() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.LISTENING, { reason: 'begin-listening' });
    this.runtimePipelineStats.userTurns += 1;
    this.currentSession.start(this.clock());
    this._scheduleLifecycleTimeout('listening', this.timeouts.listeningMs);
    this._publish(SESSION_EVENTS.VOICE_SESSION_STARTED, this._buildEventPayload());
    return this._result();
  }

  /**
   * Configure the manager-owned AudioCapture instance.
   * @param {object} settings Audio configuration settings.
   * @returns {{ready: boolean, settings: object}}
   */
  configureAudio(settings = {}) {
    return this._getAudioCapture().configure(settings);
  }

  /**
   * Initialize manager-owned audio capture for the active Voice session.
   * @param {{deviceId?: string}} options Audio initialization options.
   * @returns {{initialized: boolean, device: object, configuration: object}}
   */
  initializeAudio(options = {}) {
    this._assertSession();
    return this._getAudioCapture().initialize(options);
  }

  /**
   * Start manager-owned raw PCM capture for the active Voice session.
   * @param {{deviceId?: string}} options Audio start options.
   * @returns {{started: boolean, device: object, state: string}}
   */
  startAudioCapture(options = {}) {
    this._assertSession();
    return this._getAudioCapture().start(options);
  }

  /**
   * Stop manager-owned audio capture.
   * @returns {{stopped: boolean, state: string}}
   */
  stopAudioCapture() {
    return this._getAudioCapture().stop();
  }

  /**
   * Pause manager-owned audio capture.
   * @returns {{paused: boolean, state: string}}
   */
  pauseAudioCapture() {
    return this._getAudioCapture().pause();
  }

  /**
   * Resume manager-owned audio capture.
   * @returns {{resumed: boolean, state: string}}
   */
  resumeAudioCapture() {
    return this._getAudioCapture().resume();
  }

  /**
   * Close manager-owned audio capture and release device resources.
   * @returns {{closed: boolean, state: string}}
   */
  closeAudioCapture() {
    return this._getAudioCapture().close();
  }

  /**
   * Return manager-owned audio capture status.
   * @returns {object}
   */
  getAudioStatus() {
    return this._getAudioCapture().getStatus();
  }

  /**
   * Initialize manager-owned audio preprocessing.
   * @returns {{initialized: boolean, stages: string[]}}
   */
  initializeAudioProcessing() {
    return this._getAudioProcessor().initialize();
  }

  /**
   * Process one AudioFrame through the manager-owned preprocessing pipeline.
   * @param {object} audioFrame Raw AudioFrame.
   * @returns {object}
   */
  processAudioFrame(audioFrame) {
    this._assertSession();
    return this._getAudioProcessor().processFrame(audioFrame);
  }

  /**
   * Reset manager-owned preprocessing state.
   * @returns {{reset: boolean}}
   */
  resetAudioProcessing() {
    const result = this._getAudioProcessor().reset();
    this._resetSpeechSourceClassifier();
    this.speechPrerollFrames = [];
    return result;
  }

  /**
   * Return manager-owned preprocessing status.
   * @returns {object}
   */
  getAudioProcessingStatus() {
    return this._getAudioProcessor().getStatus();
  }

  /**
   * Initialize manager-owned streaming STT.
   * @returns {{initialized: boolean, engine: string, model: object}}
   */
  initializeSpeechToText() {
    this._assertSession();
    return this._getSTTEngine().initialize();
  }

  /**
   * Start manager-owned streaming STT.
   * @returns {{started: boolean, state: string}}
   */
  startSpeechToText() {
    this._assertSession();
    const sttEngine = this._getSTTEngine();
    if (typeof sttEngine.isRunning === 'function' && sttEngine.isRunning()) {
      return { started: false, alreadyRunning: true, state: this.getSpeechToTextStatus().decoder?.state || 'DECODING' };
    }
    const result = sttEngine.start();
    this._startRecognitionCycle('speech-to-text-started');
    return result;
  }

  /**
   * Feed one ProcessedAudioFrame to manager-owned STT.
   * @param {object} processedFrame Processed frame.
   * @returns {object}
   */
  recognizeProcessedFrame(processedFrame) {
    this._assertSession();
    const speechDecision = this._classifySpeechSourceForSession(processedFrame);
    if (!speechDecision.accepted) {
      this._logRuntimePipeline('Manual processed frame rejected before STT', {
        recognitionCycleId: this.recognitionCycle.id,
        frameIndex: processedFrame?.originalFrame?.frameIndex,
        reason: speechDecision.reason,
        classification: speechDecision.classification
      }, true);
      return { skipped: true, reason: speechDecision.reason, speechDecision };
    }
    return this._getSTTEngine().partial(processedFrame);
  }

  /**
   * Finalize manager-owned STT and record final transcript metadata.
   * @returns {object}
   */
  finalizeSpeechToText() {
    this._assertSession();
    if (!this._markRecognitionFinalizing('manual-finalize')) {
      return { skipped: true, reason: 'recognition-cycle-already-finalizing' };
    }
    return this._getSTTEngine().final();
  }

  /**
   * Stop manager-owned streaming STT.
   * @returns {{stopped: boolean, state: string}}
   */
  stopSpeechToText() {
    this._stopRecognitionCycle('speech-to-text-stopped');
    return this._getSTTEngine().stop();
  }

  /**
   * Cancel manager-owned streaming STT.
   * @returns {{cancelled: boolean, state: string}}
   */
  cancelSpeechToText() {
    this._stopRecognitionCycle('speech-to-text-cancelled');
    return this._getSTTEngine().cancel();
  }

  /**
   * Reset manager-owned STT state.
   * @returns {{reset: boolean, state: string}}
   */
  resetSpeechToText() {
    this._stopRecognitionCycle('speech-to-text-reset');
    return this._getSTTEngine().reset();
  }

  /**
   * Return manager-owned STT status.
   * @returns {object}
   */
  getSpeechToTextStatus() {
    return this._getSTTEngine().getStatus();
  }

  /**
   * Process one TranscriptResult through manager-owned normalization.
   * @param {object|string} transcriptResult STT transcript result or text.
   * @returns {object}
   */
  processTranscript(transcriptResult) {
    this._assertSession();
    return this._getTranscriptProcessor().process(transcriptResult);
  }

  /**
   * Return manager-owned transcript processing status.
   * @returns {object}
   */
  getTranscriptProcessingStatus() {
    return this._getTranscriptProcessor().getStatus();
  }

  /**
   * Move the current session into PROCESSING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginProcessing() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.PROCESSING, { reason: 'begin-processing' });
    this._pauseRecognitionConsumerForTurn('begin-processing');
    this._scheduleLifecycleTimeout('processing', this.timeouts.processingMs);
    return this._result();
  }

  /**
   * Move the current session into EXECUTING.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginExecution() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.EXECUTING, { reason: 'begin-execution' });
    this._scheduleLifecycleTimeout('execution', this.timeouts.executionMs);
    return this._result();
  }

  /**
   * Move the current session into assistant-speaking mode.
   * @param {string} reason Speaking reason.
   * @returns {{success: boolean, state: string, session: object}}
   */
  beginSpeaking(reason = 'assistant-speaking') {
    this._assertSession();
    this.runtimePipelineStats.assistantTurns += 1;
    this.runtimePipelineStats.ttsStarts += 1;
    this._transitionTo(VoiceStateMachine.STATES.SPEAKING, { reason });
    this._log('Conversation Turn Transferred', {
      owner: 'assistant',
      reason,
      assistantTurns: this.runtimePipelineStats.assistantTurns
    });
    return this._result();
  }

  /**
   * Record completion of the assistant speaking turn.
   * @param {'completed'|'cancelled'|'failed'} outcome TTS outcome.
   * @param {object} metadata TTS metadata.
   * @returns {{recorded: boolean, outcome: string}}
   */
  completeSpeakingTurn(outcome = 'completed', metadata = {}) {
    const normalizedOutcome = ['completed', 'cancelled', 'failed'].includes(outcome) ? outcome : 'completed';
    if (normalizedOutcome === 'completed') this.runtimePipelineStats.ttsCompletions += 1;
    if (normalizedOutcome === 'cancelled') this.runtimePipelineStats.ttsCancellations += 1;
    if (normalizedOutcome === 'failed') this.runtimePipelineStats.ttsFailures += 1;
    this._log('Assistant Speaking Turn Completed', {
      outcome: normalizedOutcome,
      ...metadata
    });
    return { recorded: true, outcome: normalizedOutcome };
  }

  /**
   * Resume the same Voice session for another utterance after one assistant turn.
   * @param {string} reason Resume reason for logs and state metadata.
   * @returns {{success: boolean, resumed: boolean, state: string, session: object|null, sttRestarted?: boolean, audioProcessingReset?: boolean}}
   */
  resumeListeningCycle(reason = 'resume-listening-cycle') {
    this._assertSession();
    const states = VoiceStateMachine.STATES;
    this._clearSessionRecognitionTurn();
    if ([states.PROCESSING, states.EXECUTING, states.SPEAKING].includes(this.currentState)) {
      this._transitionTo(states.LISTENING, { reason });
    } else if (this.currentState !== states.LISTENING) {
      return {
        success: true,
        resumed: false,
        state: this.currentState,
        session: this.getSession()
      };
    }

    let audioProcessingReset = false;
    let captureBufferFlushed = false;
    let sttRestarted = false;
    this.runtimePipelineStats.listeningCycles += 1;
    this.runtimePipelineStats.userTurns += 1;
    this.runtimePipelineStats.lastPartialTranscript = '';

    try {
      this.resetAudioProcessing();
      audioProcessingReset = true;
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
    }

    try {
      captureBufferFlushed = this._prepareContinuousCaptureForRecognitionTurn(reason);
      const sttEngine = this._getSTTEngine();
      if (!sttEngine.isRunning || !sttEngine.isRunning()) {
        this.startSpeechToText();
        sttRestarted = true;
      }
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
    }

    this._scheduleLifecycleTimeout('listening', this.timeouts.listeningMs);
    this._log('Listening Cycle Resumed', {
      reason,
      listeningCycles: this.runtimePipelineStats.listeningCycles,
      sttRestarted,
      audioProcessingReset,
      captureBufferFlushed
    });
    return {
      success: true,
      resumed: true,
      state: this.currentState,
      session: this.getSession(),
      sttRestarted,
      audioProcessingReset,
      captureBufferFlushed
    };
  }

  /**
   * Record a suppressed duplicate turn resume attempt.
   * @param {string} reason Suppression reason.
   * @returns {{recorded: boolean}}
   */
  recordDuplicateConversationResume(reason = 'duplicate-resume') {
    this.runtimePipelineStats.duplicateConversationResumes += 1;
    this._log('Duplicate Conversation Resume Suppressed', {
      reason,
      duplicateConversationResumes: this.runtimePipelineStats.duplicateConversationResumes
    });
    return { recorded: true };
  }

  /**
   * Finish the current session and automatically clean up back to IDLE.
   * @returns {{success: boolean, state: string, session: object}}
   */
  finishSession() {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.FINISHED, { reason: 'finish-session' });
    this.currentSession.finish(this.clock());
    const snapshot = this.currentSession.toJSON();
    this._publish(SESSION_EVENTS.VOICE_SESSION_FINISHED, this._buildEventPayload(snapshot));
    this.closeSession('finished');
    return { success: true, state: this.currentState, session: snapshot };
  }

  /**
   * Compatibility alias for finishing a session that is already executing.
   * @returns {{success: boolean, state: string, session: object}}
   */
  stopSession() {
    return this.finishSession();
  }

  /**
   * Cancel the current session and automatically clean up back to IDLE.
   * @param {string} reason Cancellation reason.
   * @returns {{success: boolean, state: string, session: object}}
   */
  cancelSession(reason = 'Session cancelled.') {
    this._assertSession();
    this._transitionTo(VoiceStateMachine.STATES.CANCELLED, { reason });
    this.currentSession.cancel(reason, this.clock());
    const snapshot = this.currentSession.toJSON();
    this._publish(SESSION_EVENTS.VOICE_SESSION_CANCELLED, this._buildEventPayload(snapshot));
    this.closeSession('cancelled');
    return { success: true, state: this.currentState, session: snapshot };
  }

  /**
   * Move the current session through ERROR recovery and automatically clean up back to IDLE.
   * @param {Error|string|object} error Error or placeholder error metadata.
   * @returns {{success: boolean, state: string, session: object|null, error: object}}
   */
  failSession(error) {
    const normalizedError = this._normalizeError(error);
    if (this.currentState !== VoiceStateMachine.STATES.ERROR) {
      this._transitionTo(VoiceStateMachine.STATES.ERROR, { reason: normalizedError.message });
    }
    if (this.currentSession) {
      this.currentSession.fail(normalizedError, this.clock());
    }
    const snapshot = this.currentSession ? this.currentSession.toJSON() : null;
    this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(snapshot, { error: normalizedError }));
    this.closeSession('error');
    return { success: false, state: this.currentState, session: snapshot, error: normalizedError };
  }

  /**
   * Close the current lifecycle state, release placeholders, and return to IDLE.
   * @param {string} reason Cleanup reason.
   * @returns {{success: boolean, state: string}}
   */
  closeSession(reason = 'close-session') {
    if (this.currentState === VoiceStateMachine.STATES.IDLE && !this.currentSession) {
      return { success: true, state: this.currentState };
    }

    if (this.currentState !== VoiceStateMachine.STATES.CLOSING) {
      this._transitionTo(VoiceStateMachine.STATES.CLOSING, { reason });
    }

    this._stopRecognitionCycle(`session-${reason}`);
    const snapshot = this.currentSession ? this.currentSession.toJSON() : null;
    this._clearAllTimeouts();
    this._releaseSessionResources();
    if (snapshot) {
      this.sessionHistory.push(snapshot);
    }
    this.currentSession = null;
    this._transitionTo(VoiceStateMachine.STATES.IDLE, { reason: 'cleanup-complete', sessionSnapshot: snapshot });
    this._publish(SESSION_EVENTS.VOICE_SESSION_CLOSED, this._buildEventPayload(snapshot));
    return { success: true, state: this.currentState };
  }

  /**
   * Force cleanup and restore IDLE without keeping the active session.
   * @returns {{success: boolean, state: string}}
   */
  reset() {
    this._clearAllTimeouts();
    this._releaseSessionResources();
    if (this.currentSession) {
      this.sessionHistory.push(this.currentSession.toJSON());
    }
    this.currentSession = null;
    this.recognitionCycle = this._createRecognitionCycle('manager-reset');
    this._resetSpeechSourceClassifier();
    this.speechPrerollFrames = [];
    this.currentState = this.stateMachine.getInitialState();
    this._log('Reset', { state: this.currentState });
    return { success: true, state: this.currentState };
  }

  /**
   * Return an immutable snapshot of the current session.
   * @returns {object|null}
   */
  getSession() {
    return this.currentSession ? this.currentSession.toJSON() : null;
  }

  /**
   * Get the manager's current state.
   * @returns {string}
   */
  getCurrentState() {
    return this.currentState;
  }

  /**
   * Report whether a session is currently owned by the manager.
   * @returns {boolean}
   */
  isActive() {
    return Boolean(this.currentSession);
  }

  /**
   * Report whether the manager is not IDLE.
   * @returns {boolean}
   */
  isBusy() {
    return this.currentState !== VoiceStateMachine.STATES.IDLE;
  }

  /**
   * Return metadata-only lifecycle metrics.
   * @returns {{state: string, active: boolean, busy: boolean, transitionCount: number, sessionCount: number, currentSession: object|null, transitions: object[]}}
   */
  getMetrics() {
    return {
      state: this.currentState,
      active: this.isActive(),
      busy: this.isBusy(),
      transitionCount: this.transitionLog.length,
      sessionCount: this.sessionHistory.length + (this.currentSession ? 1 : 0),
      currentSession: this.getSession(),
      recognitionCycle: { ...this.recognitionCycle },
      runtimePipeline: { ...this.runtimePipelineStats },
      transitions: this.transitionLog.map(transition => ({ ...transition }))
    };
  }

  /**
   * Validate and apply a state transition.
   * @param {string} nextState Requested next state.
   * @param {{reason?: string, sessionSnapshot?: object}} details Transition details.
   * @returns {string}
   * @private
   */
  _transitionTo(nextState, details = {}) {
    const previousState = this.currentState;
    this.stateMachine.assertTransition(previousState, nextState);
    this.currentState = nextState;
    const now = this.clock();
    const transition = {
      fromState: previousState,
      toState: nextState,
      at: now.toISOString(),
      reason: details.reason || ''
    };
    this.transitionLog.push(transition);
    if (this.currentSession) {
      this.currentSession.setState(nextState, { at: now, reason: details.reason });
    }
    this._clearCompletedTimeouts(nextState);
    this.metricsRecorder.increment('voice.state.transition', 1);
    this._log('State Changed', transition);
    this._publish(SESSION_EVENTS.VOICE_STATE_CHANGED, this._buildEventPayload(details.sessionSnapshot, { transition }));
    return this.currentState;
  }

  /**
   * Schedule a placeholder lifecycle timeout.
   * @param {string} name Timeout name.
   * @param {number} milliseconds Timeout duration.
   * @returns {void}
   * @private
   */
  _scheduleLifecycleTimeout(name, milliseconds) {
    const timeoutMs = Math.max(0, Number(milliseconds) || 0);
    if (!timeoutMs) return;
    this._clearTimeout(name);
    const timer = this.setTimer(() => {
      this._publish(SESSION_EVENTS.VOICE_TIMEOUT, this._buildEventPayload(null, { timeout: name }));
      if (this.currentState !== VoiceStateMachine.STATES.IDLE) {
        if (name === 'listening') {
          this.cancelSession('No speech detected.');
          return;
        }
        this.failSession({
          name: VOICE_ERROR_TYPES.TIMEOUT,
          message: `Voice ${name} timeout expired.`,
          type: VOICE_ERROR_TYPES.TIMEOUT
        });
      }
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    this.activeTimers.set(name, timer);
  }

  /**
   * Clear timeouts that no longer belong to the active lifecycle state.
   * @param {string} nextState State just entered.
   * @returns {void}
   * @private
   */
  _clearCompletedTimeouts(nextState) {
    const states = VoiceStateMachine.STATES;
    const timeoutByState = {
      [states.READY]: ['initialization'],
      [states.PROCESSING]: ['listening'],
      [states.EXECUTING]: ['processing'],
      [states.SPEAKING]: ['execution'],
      [states.FINISHED]: ['execution'],
      [states.CANCELLED]: ['listening', 'processing', 'execution'],
      [states.ERROR]: ['initialization', 'listening', 'processing', 'execution'],
      [states.CLOSING]: ['initialization', 'listening', 'processing', 'execution', 'overall'],
      [states.IDLE]: ['initialization', 'listening', 'processing', 'execution', 'overall']
    };
    for (const name of timeoutByState[nextState] || []) {
      this._clearTimeout(name);
    }
  }

  /**
   * Clear one lifecycle timeout.
   * @param {string} name Timeout name.
   * @returns {void}
   * @private
   */
  _clearTimeout(name) {
    if (!this.activeTimers.has(name)) return;
    this.clearTimer(this.activeTimers.get(name));
    this.activeTimers.delete(name);
  }

  /**
   * Clear all lifecycle timeouts.
   * @returns {void}
   * @private
   */
  _clearAllTimeouts() {
    for (const name of Array.from(this.activeTimers.keys())) {
      this._clearTimeout(name);
    }
  }

  /**
   * Ensure no current session is active before creating a new one.
   * @returns {void}
   * @private
   */
  _assertNoActiveSession() {
    if (this.currentSession) {
      throw new Error(`${VOICE_ERROR_TYPES.SESSION_BUSY}: Voice session already exists.`);
    }
  }

  /**
   * Ensure a session exists before a lifecycle action.
   * @returns {void}
   * @private
   */
  _assertSession() {
    if (!this.currentSession) {
      throw new Error('Voice session does not exist.');
    }
  }

  /**
   * Release active session resource handles without discarding injected desktop resources.
   * @returns {void}
   * @private
   */
  _releaseSessionResources() {
    for (const key of Object.keys(this.resources)) {
      const resource = this.resources[key];
      if (!resource) continue;
      try {
        if (key === 'audioCapture' && typeof resource.close === 'function') {
          resource.close();
        } else if (key === 'audioProcessor' && typeof resource.reset === 'function') {
          resource.reset();
        } else if (key === 'speechSourceClassifier' && typeof resource.reset === 'function') {
          resource.reset();
        } else if (key === 'sttEngine' && typeof resource.cancel === 'function') {
          resource.cancel();
        } else if (key === 'transcriptProcessor' && typeof resource.reset === 'function') {
          resource.reset();
        } else if (typeof resource.close === 'function') {
          resource.close();
        }
      } catch (error) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`[Voice] Resource cleanup failed: ${key}`, { error: error.message });
        } else {
          this._log(`Resource cleanup failed: ${key}`, { error: error.message });
        }
      }
    }
  }

  /**
   * Return or create the manager-owned AudioCapture instance.
   * @returns {AudioCapture}
   * @private
   */
  _getAudioCapture() {
    if (!this.resources.audioCapture) {
      this.resources.audioCapture = new this.AudioCaptureClass({
        logger: this.logger,
        metrics: this.metricsRecorder
      });
      this._attachAudioCapture(this.resources.audioCapture);
    }
    return this.resources.audioCapture;
  }

  /**
   * Attach manager delivery hooks to an AudioCapture instance.
   * @param {AudioCapture} audioCapture Capture instance.
   * @returns {void}
   * @private
   */
  _attachAudioCapture(audioCapture) {
    if (!audioCapture || typeof audioCapture.on !== 'function') return;
    audioCapture.on(AUDIO_EVENTS.AUDIO_FRAME, this._audioFrameListener);
  }

  /**
   * Return or create the manager-owned AudioProcessor instance.
   * @returns {AudioProcessor}
   * @private
   */
  _getAudioProcessor() {
    if (!this.resources.audioProcessor) {
      this.resources.audioProcessor = new this.AudioProcessorClass({
        logger: this.logger,
        metrics: this.metricsRecorder
      });
      this._attachAudioProcessor(this.resources.audioProcessor);
    }
    return this.resources.audioProcessor;
  }

  /**
   * Attach manager delivery hooks to an AudioProcessor instance.
   * @param {AudioProcessor} audioProcessor Processing instance.
   * @returns {void}
   * @private
   */
  _attachAudioProcessor(audioProcessor) {
    if (!audioProcessor || typeof audioProcessor.on !== 'function') return;
    audioProcessor.on(AUDIO_PROCESSING_EVENTS.FRAME_PROCESSED, this._processedFrameListener);
  }

  /**
   * Return or create the manager-owned speech source classifier.
   * @returns {SpeechSourceClassifier}
   * @private
   */
  _getSpeechSourceClassifier() {
    if (!this.resources.speechSourceClassifier) {
      this.resources.speechSourceClassifier = new this.SpeechSourceClassifierClass({
        logger: this.logger,
        metrics: this.metricsRecorder,
        clock: this.clock
      });
    }
    return this.resources.speechSourceClassifier;
  }

  /**
   * Reset the manager-owned speech source classifier if available.
   * @returns {boolean}
   * @private
   */
  _resetSpeechSourceClassifier() {
    const classifier = this._getSpeechSourceClassifier();
    if (!classifier || typeof classifier.reset !== 'function') return false;
    classifier.reset();
    return true;
  }

  /**
   * Return or create the manager-owned STTEngine facade.
   * @returns {STTEngine}
   * @private
   */
  _getSTTEngine() {
    if (!this.resources.sttEngine) {
      this.resources.sttEngine = new this.STTEngineClass({
        logger: this.logger,
        metrics: this.metricsRecorder,
        clock: this.clock
      });
      this._attachSTTEngine(this.resources.sttEngine);
    }
    return this.resources.sttEngine;
  }

  /**
   * Attach transcript delivery hooks to an STTEngine instance.
   * @param {STTEngine} sttEngine STT facade.
   * @returns {void}
   * @private
   */
  _attachSTTEngine(sttEngine) {
    if (!sttEngine || typeof sttEngine.on !== 'function') return;
    sttEngine.on(STT_EVENTS.PARTIAL_RESULT, this._partialTranscriptListener);
    sttEngine.on(STT_EVENTS.FINAL_RESULT, this._finalTranscriptListener);
  }

  /**
   * Return or create manager-owned TranscriptProcessor.
   * @returns {TranscriptProcessor}
   * @private
   */
  _getTranscriptProcessor() {
    if (!this.resources.transcriptProcessor) {
      this.resources.transcriptProcessor = new this.TranscriptProcessorClass({
        logger: this.logger,
        metrics: this.metricsRecorder,
        clock: this.clock
      });
      this._attachTranscriptProcessor(this.resources.transcriptProcessor);
    }
    return this.resources.transcriptProcessor;
  }

  /**
   * Attach normalized transcript delivery hooks.
   * @param {TranscriptProcessor} transcriptProcessor Transcript processor.
   * @returns {void}
   * @private
   */
  _attachTranscriptProcessor(transcriptProcessor) {
    if (!transcriptProcessor || typeof transcriptProcessor.on !== 'function') return;
    transcriptProcessor.on(NORMALIZATION_EVENTS.NORMALIZED_TRANSCRIPT_READY, this._normalizedTranscriptListener);
  }

  /**
   * Process a captured frame before delivering metadata to the active VoiceSession.
   * @param {object} frame Raw AudioFrame.
   * @returns {void}
   * @private
   */
  _processAudioFrameForSession(frame) {
    if (!this.currentSession) return;
    try {
      this.runtimePipelineStats.audioFrames += 1;
      if (this.currentState !== VoiceStateMachine.STATES.LISTENING) {
        this.runtimePipelineStats.audioFramesWhileBusy += 1;
        this._logRuntimePipeline('Audio frame ignored while recognition is paused', {
          state: this.currentState,
          audioFramesWhileBusy: this.runtimePipelineStats.audioFramesWhileBusy
        });
        return;
      }
      if (!this._isFrameFreshForRecognitionCycle(frame)) {
        this.runtimePipelineStats.staleAudioFrames += 1;
        this._logRuntimePipeline('Stale audio frame ignored before recognition cycle boundary', {
          recognitionCycleId: this.recognitionCycle.id,
          frameIndex: frame?.frameIndex,
          frameTimestamp: frame?.timestamp,
          recognitionStartedAt: this.recognitionCycle.startedAt,
          staleAudioFrames: this.runtimePipelineStats.staleAudioFrames
        });
        return;
      }
      this._logRuntimePipeline('AudioCapture frame received', {
        audioFrames: this.runtimePipelineStats.audioFrames,
        frame: typeof frame?.toMetadata === 'function' ? frame.toMetadata() : undefined
      });
      this._getAudioProcessor().processFrame(frame);
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
    }
  }

  /**
   * Deliver captured AudioFrame metadata to the active VoiceSession.
   * @param {object} frame AudioFrame object.
   * @returns {void}
   * @private
   */
  _deliverAudioFrameToSession(frame) {
    if (this.currentState !== VoiceStateMachine.STATES.LISTENING) {
      this.runtimePipelineStats.audioFramesWhileBusy += 1;
      this._logRuntimePipeline('Processed audio frame ignored while recognition is paused', {
        state: this.currentState,
        frameIndex: frame?.originalFrame?.frameIndex,
        audioFramesWhileBusy: this.runtimePipelineStats.audioFramesWhileBusy
      });
      return;
    }
    this.runtimePipelineStats.processedFrames += 1;
    this._recordRecognitionFrame(frame);
    const speechDecision = this._classifySpeechSourceForSession(frame);
    if (!speechDecision.accepted) {
      this._trackSpeechPrerollFrame(frame, speechDecision);
      this._logRuntimePipeline('Processed audio rejected before STT', {
        recognitionCycleId: this.recognitionCycle.id,
        frameIndex: frame?.originalFrame?.frameIndex,
        reason: speechDecision.reason,
        classification: speechDecision.classification,
        confidence: speechDecision.confidence
      });
      return;
    }
    const framesForRecognition = this._consumeSpeechPrerollFrames(frame);
    this._logRuntimePipeline('Processed audio frame ready for STT', {
      processedFrames: this.runtimePipelineStats.processedFrames,
      speechDecision,
      prerollFrames: framesForRecognition.length - 1,
      frame: typeof frame?.toMetadata === 'function' ? frame.toMetadata() : undefined
    });
    for (const recognitionFrame of framesForRecognition) {
      if (!this._deliverAcceptedFrameToRecognition(recognitionFrame)) return;
    }
  }

  /**
   * Deliver TranscriptResult metadata to the active VoiceSession.
   * @param {object} result TranscriptResult object.
   * @returns {void}
   * @private
   */
  _deliverTranscriptResultToSession(result) {
    if (!this.currentSession) return;
    const payload = result && typeof result.toJSON === 'function' ? result.toJSON() : { ...(result || {}) };
    const transcriptText = String(payload.transcript || payload.finalTranscript || payload.text || '').trim();
    if (payload.partial) {
      this.runtimePipelineStats.partialTranscripts += 1;
    } else {
      this.runtimePipelineStats.finalTranscripts += 1;
    }

    if (!transcriptText) {
      this._logRuntimePipeline(payload.partial ? 'Empty partial transcript ignored' : 'Empty final transcript ignored', {
        partialTranscripts: this.runtimePipelineStats.partialTranscripts,
        finalTranscripts: this.runtimePipelineStats.finalTranscripts,
        recognitionCycleId: this.recognitionCycle.id,
        confidence: payload.confidence
      }, !payload.partial);
      if (!payload.partial && this.currentSession) {
        this._handleEmptyFinalTranscript();
      }
      return;
    }

    if (payload.partial) {
      const partialDecision = this._shouldPublishPartialTranscript(transcriptText, payload);
      if (!partialDecision.publish) {
        this._logRuntimePipeline(partialDecision.message, {
          recognitionCycleId: this.recognitionCycle.id,
          duplicatePartials: this.runtimePipelineStats.duplicatePartials,
          suppressedPartials: this.runtimePipelineStats.suppressedPartials,
          transcriptLength: transcriptText.length,
          confidence: payload.confidence
        });
        return;
      }
      this.runtimePipelineStats.lastPartialTranscript = transcriptText;
    } else {
      if (this.recognitionCycle.finalDelivered) {
        this.runtimePipelineStats.duplicateFinals += 1;
        this._logRuntimePipeline('Duplicate final transcript suppressed', {
          recognitionCycleId: this.recognitionCycle.id,
          duplicateFinals: this.runtimePipelineStats.duplicateFinals,
          transcriptLength: transcriptText.length,
          confidence: payload.confidence
        }, true);
        return;
      }
      this._completeRecognitionCycle(payload);
      this.runtimePipelineStats.lastPartialTranscript = '';
      if (this.currentState === VoiceStateMachine.STATES.LISTENING) {
        this.beginProcessing();
      }
    }

    if (typeof this.currentSession.receiveTranscriptResult === 'function') {
      this.currentSession.receiveTranscriptResult(result);
    }
    this._logRuntimePipeline(payload.partial ? 'Partial transcript produced' : 'Final transcript produced', {
      recognitionCycleId: this.recognitionCycle.id,
      partialTranscripts: this.runtimePipelineStats.partialTranscripts,
      finalTranscripts: this.runtimePipelineStats.finalTranscripts,
      transcriptLength: transcriptText.length,
      confidence: payload.confidence
    }, !payload.partial);
    this._publish(
      payload.partial ? SESSION_EVENTS.VOICE_PARTIAL_TRANSCRIPT : SESSION_EVENTS.VOICE_FINAL_TRANSCRIPT,
      this._buildEventPayload(this.currentSession, { transcriptResult: payload })
    );
    if (payload.partial) return;
    try {
      this._getTranscriptProcessor().process(result);
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
    }
  }

  /**
   * Deliver NormalizedTranscript metadata to the active VoiceSession.
   * @param {object} normalizedTranscript Normalized transcript.
   * @returns {void}
   * @private
   */
  _deliverNormalizedTranscriptToSession(normalizedTranscript) {
    if (this.currentSession && typeof this.currentSession.receiveNormalizedTranscript === 'function') {
      this.currentSession.receiveNormalizedTranscript(normalizedTranscript);
    }
    if (!this.currentSession) return;
    const payload = normalizedTranscript && typeof normalizedTranscript.toJSON === 'function'
      ? normalizedTranscript.toJSON()
      : { ...(normalizedTranscript || {}) };
    this._publish(
      SESSION_EVENTS.VOICE_NORMALIZED_TRANSCRIPT,
      this._buildEventPayload(this.currentSession, { normalizedTranscript: payload })
    );
  }

  /**
   * Create metadata for one recognition stream inside the active voice session.
   * @param {string} reason Creation reason.
   * @returns {object}
   * @private
   */
  _createRecognitionCycle(reason = '') {
    return {
      id: this.recognitionCycleSequence,
      active: false,
      finalizing: false,
      finalDelivered: false,
      startedAt: null,
      startedAtMs: 0,
      endedAt: null,
      reason,
      speechFrames: 0,
      silenceFrames: 0,
      endpointFrameIndex: null,
      lastFrameIndex: -1,
      lastPublishedPartial: '',
      lastPartialCandidate: '',
      partialCandidateRepeats: 0,
      lastPartialPublishedAt: 0,
      finalTranscriptLength: 0,
      confidence: 0
    };
  }

  /**
   * Start a new recognition stream without replacing the voice session.
   * @param {string} reason Start reason.
   * @returns {object}
   * @private
   */
  _startRecognitionCycle(reason = 'recognition-started') {
    this.recognitionCycleSequence += 1;
    this.recognitionCycle = this._createRecognitionCycle(reason);
    this.recognitionCycle.id = this.recognitionCycleSequence;
    this.recognitionCycle.active = true;
    this.recognitionCycle.startedAt = this.clock().toISOString();
    this.recognitionCycle.startedAtMs = Date.parse(this.recognitionCycle.startedAt);
    this.runtimePipelineStats.lastPartialTranscript = '';
    this._resetSpeechSourceClassifier();
    this.speechPrerollFrames = [];
    this._publishRecognitionCycle('started', { reason });
    this._log('Recognition Cycle Started', {
      recognitionCycleId: this.recognitionCycle.id,
      reason
    });
    return this.recognitionCycle;
  }

  /**
   * Stop the current recognition stream metadata without ending the voice session.
   * @param {string} reason Stop reason.
   * @returns {object}
   * @private
   */
  _stopRecognitionCycle(reason = 'recognition-stopped') {
    if (!this.recognitionCycle.active && !this.recognitionCycle.finalizing) return this.recognitionCycle;
    this.recognitionCycle.active = false;
    this.recognitionCycle.finalizing = false;
    this.recognitionCycle.endedAt = this.clock().toISOString();
    this.recognitionCycle.reason = reason;
    this._publishRecognitionCycle('stopped', { reason });
    return this.recognitionCycle;
  }

  /**
   * Mark the active recognition stream as finalizing exactly once.
   * @param {string} reason Finalization reason.
   * @param {object} frame Endpoint frame.
   * @returns {boolean}
   * @private
   */
  _markRecognitionFinalizing(reason = 'recognition-finalizing', frame = null) {
    if (this.recognitionCycle.finalizing || this.recognitionCycle.finalDelivered) {
      this.runtimePipelineStats.finalizationRequests += 1;
      this._logRuntimePipeline('Duplicate finalization request suppressed', {
        recognitionCycleId: this.recognitionCycle.id,
        reason,
        finalizing: this.recognitionCycle.finalizing,
        finalDelivered: this.recognitionCycle.finalDelivered
      }, true);
      return false;
    }
    this.runtimePipelineStats.finalizationRequests += 1;
    this.recognitionCycle.active = false;
    this.recognitionCycle.finalizing = true;
    this.recognitionCycle.reason = reason;
    if (frame?.originalFrame) this.recognitionCycle.endpointFrameIndex = frame.originalFrame.frameIndex;
    this._publishRecognitionCycle('finalizing', {
      reason,
      endpointFrameIndex: this.recognitionCycle.endpointFrameIndex
    });
    return true;
  }

  /**
   * Complete a recognition stream after a non-empty final transcript.
   * @param {object} payload Final transcript payload.
   * @returns {object}
   * @private
   */
  _completeRecognitionCycle(payload = {}) {
    const finalText = String(payload.finalTranscript || payload.transcript || payload.text || '').trim();
    this.recognitionCycle.active = false;
    this.recognitionCycle.finalizing = false;
    this.recognitionCycle.finalDelivered = true;
    this.recognitionCycle.endedAt = this.clock().toISOString();
    this.recognitionCycle.finalTranscriptLength = finalText.length;
    this.recognitionCycle.confidence = Number(payload.confidence) || 0;
    this._publishRecognitionCycle('completed', {
      transcriptLength: finalText.length,
      confidence: this.recognitionCycle.confidence
    });
    return this.recognitionCycle;
  }

  /**
   * Validate one processed frame as a speech source before STT delivery.
   * @param {object} frame Processed audio frame.
   * @returns {object}
   * @private
   */
  _classifySpeechSourceForSession(frame) {
    let decision;
    try {
      decision = this._getSpeechSourceClassifier().classify(frame);
    } catch (error) {
      decision = {
        accepted: false,
        reason: 'speech-source-classifier-error',
        classification: 'classifier-error',
        confidence: 0,
        error: this._normalizeError(error),
        frameIndex: Number.isInteger(frame?.originalFrame?.frameIndex) ? frame.originalFrame.frameIndex : null,
        speechActivityState: String(frame?.speechActivityState || 'UNKNOWN'),
        endpointCandidate: Boolean(frame?.endpointCandidate),
        at: this.clock().toISOString()
      };
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: decision.error
      }));
    }
    this._recordSpeechSourceDecision(decision);
    return decision;
  }

  /**
   * Record and publish one pre-STT speech-source decision.
   * @param {object} decision Classifier decision.
   * @returns {void}
   * @private
   */
  _recordSpeechSourceDecision(decision = {}) {
    this.runtimePipelineStats.speechCandidates += 1;
    if (decision.accepted) {
      this.runtimePipelineStats.acceptedSpeechCandidates += 1;
    } else {
      this.runtimePipelineStats.rejectedSpeechCandidates += 1;
      const classification = String(decision.classification || '');
      if (classification === 'non-speech') this.runtimePipelineStats.rejectedNonSpeech += 1;
      if (classification === 'background-audio') this.runtimePipelineStats.rejectedBackgroundAudio += 1;
      if (classification === 'transient-noise') this.runtimePipelineStats.rejectedTransientNoise += 1;
      if (classification === 'electronic-audio') this.runtimePipelineStats.rejectedElectronicAudio += 1;
      if (classification === 'low-confidence') this.runtimePipelineStats.rejectedLowConfidenceSpeech += 1;
      if (classification === 'unstable-candidate') this.runtimePipelineStats.rejectedUnstableSpeech += 1;
    }
    this._publish(SESSION_EVENTS.VOICE_SPEECH_DECISION, this._buildEventPayload(this.currentSession, {
      speechDecision: {
        ...decision,
        metrics: decision.metrics ? { ...decision.metrics } : undefined,
        segment: decision.segment ? { ...decision.segment } : undefined
      },
      recognitionCycle: { ...this.recognitionCycle }
    }));
  }

  /**
   * Buffer early speech-like frames until the speech segment is validated.
   * @param {object} frame Processed audio frame.
   * @param {object} decision Speech source decision.
   * @returns {void}
   * @private
   */
  _trackSpeechPrerollFrame(frame, decision = {}) {
    if (!this._isSpeechPrerollCandidate(frame, decision)) {
      const state = String(frame?.speechActivityState || '').toUpperCase();
      if (state.includes('SILENCE') || state === 'UNKNOWN') this.speechPrerollFrames = [];
      return;
    }
    this.speechPrerollFrames.push(frame);
    if (this.speechPrerollFrames.length > this.speechPrerollFrameLimit) {
      this.speechPrerollFrames.splice(0, this.speechPrerollFrames.length - this.speechPrerollFrameLimit);
    }
    this.runtimePipelineStats.speechPrerollFramesBuffered += 1;
  }

  /**
   * Return buffered lead-in frames plus the current accepted frame.
   * @param {object} currentFrame Current accepted processed frame.
   * @returns {object[]}
   * @private
   */
  _consumeSpeechPrerollFrames(currentFrame) {
    const frames = this.speechPrerollFrames.filter(frame => frame !== currentFrame);
    this.speechPrerollFrames = [];
    if (frames.length) {
      this.runtimePipelineStats.speechPrerollFramesFlushed += frames.length;
      this._logRuntimePipeline('Speech pre-roll frames released to STT', {
        recognitionCycleId: this.recognitionCycle.id,
        framesReleased: frames.length
      });
    }
    return [...frames, currentFrame];
  }

  /**
   * Check whether a rejected frame should be held as speech pre-roll.
   * @param {object} frame Processed audio frame.
   * @param {object} decision Speech source decision.
   * @returns {boolean}
   * @private
   */
  _isSpeechPrerollCandidate(frame, decision = {}) {
    const state = String(frame?.speechActivityState || '').toUpperCase();
    const confidence = Number(decision.confidence ?? frame?.speechConfidence) || 0;
    if (state.includes('POSSIBLE') || state.includes('SPEECH')) return true;
    if (decision.classification === 'unstable-candidate') return true;
    return confidence >= 0.04 && decision.classification !== 'background-audio' && decision.classification !== 'electronic-audio';
  }

  /**
   * Deliver one accepted frame to the session and STT consumer.
   * @param {object} frame Processed audio frame.
   * @returns {boolean}
   * @private
   */
  _deliverAcceptedFrameToRecognition(frame) {
    if (this.currentSession && typeof this.currentSession.receiveAudioFrame === 'function') {
      this.currentSession.receiveAudioFrame(frame);
    }
    if (!(this.resources.sttEngine && typeof this.resources.sttEngine.isRunning === 'function' && this.resources.sttEngine.isRunning())) {
      return true;
    }
    try {
      this.runtimePipelineStats.sttFrames += 1;
      this.resources.sttEngine.partial(frame);
      this._logRuntimePipeline('Processed audio frame delivered to STT', {
        sttFrames: this.runtimePipelineStats.sttFrames,
        frameIndex: frame?.originalFrame?.frameIndex
      });
      if (frame?.endpointCandidate && typeof this.resources.sttEngine.final === 'function') {
        if (!this._markRecognitionFinalizing('vad-endpoint', frame)) return false;
        this._logRuntimePipeline('VAD endpoint detected; finalizing STT stream', {
          recognitionCycleId: this.recognitionCycle.id,
          frameIndex: frame?.originalFrame?.frameIndex,
          speechActivityState: frame?.speechActivityState
        }, true);
        this.resources.sttEngine.final();
      }
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
      return false;
    }
    return true;
  }

  /**
   * Record audio/VAD information for the current recognition stream.
   * @param {object} frame Processed audio frame.
   * @returns {void}
   * @private
   */
  _recordRecognitionFrame(frame) {
    if (!frame) return;
    const state = String(frame.speechActivityState || '').toUpperCase();
    this.recognitionCycle.lastFrameIndex = Number.isInteger(frame?.originalFrame?.frameIndex)
      ? frame.originalFrame.frameIndex
      : this.recognitionCycle.lastFrameIndex;
    if (state.includes('SPEECH')) this.recognitionCycle.speechFrames += 1;
    if (state.includes('SILENCE') || state.includes('END')) this.recognitionCycle.silenceFrames += 1;
    if (frame.endpointCandidate) {
      this.runtimePipelineStats.endpointDetections += 1;
      this.recognitionCycle.endpointFrameIndex = this.recognitionCycle.lastFrameIndex;
      this._publishRecognitionCycle('endpoint', {
        endpointFrameIndex: this.recognitionCycle.endpointFrameIndex,
        speechFrames: this.recognitionCycle.speechFrames,
        silenceFrames: this.recognitionCycle.silenceFrames
      });
    }
  }

  /**
   * Decide whether a partial transcript is stable enough for UI publication.
   * @param {string} transcriptText Partial transcript text.
   * @param {object} payload Transcript payload.
   * @returns {{publish: boolean, message: string}}
   * @private
   */
  _shouldPublishPartialTranscript(transcriptText, payload = {}) {
    if (this.recognitionCycle.finalizing || this.recognitionCycle.finalDelivered) {
      this.runtimePipelineStats.staleTranscripts += 1;
      return { publish: false, message: 'Stale partial transcript suppressed' };
    }
    if (transcriptText === this.recognitionCycle.lastPublishedPartial) {
      this.runtimePipelineStats.duplicatePartials += 1;
      return { publish: false, message: 'Duplicate partial transcript suppressed' };
    }

    if (transcriptText === this.recognitionCycle.lastPartialCandidate) {
      this.recognitionCycle.partialCandidateRepeats += 1;
    } else {
      this.recognitionCycle.lastPartialCandidate = transcriptText;
      this.recognitionCycle.partialCandidateRepeats = 1;
    }

    const previous = this.recognitionCycle.lastPublishedPartial;
    const now = this.clock().getTime();
    const progressive = !previous || transcriptText.toLowerCase().startsWith(previous.toLowerCase());
    const stableRepeat = this.recognitionCycle.partialCandidateRepeats >= 2;
    const oldEnough = now - this.recognitionCycle.lastPartialPublishedAt >= 700;
    if (!progressive && !stableRepeat && !oldEnough) {
      this.runtimePipelineStats.suppressedPartials += 1;
      return { publish: false, message: 'Unstable partial transcript suppressed' };
    }

    this.recognitionCycle.lastPublishedPartial = transcriptText;
    this.recognitionCycle.lastPartialPublishedAt = now;
    this.recognitionCycle.confidence = Number(payload.confidence) || this.recognitionCycle.confidence;
    return { publish: true, message: 'Partial transcript accepted' };
  }

  /**
   * Recover from an empty final transcript without closing the long-running session.
   * @returns {void}
   * @private
   */
  _handleEmptyFinalTranscript() {
    this.runtimePipelineStats.emptyFinals += 1;
    this._stopRecognitionCycle('empty-final-transcript');
    try {
      this.resetAudioProcessing();
      const sttEngine = this._getSTTEngine();
      if (!sttEngine.isRunning || !sttEngine.isRunning()) {
        this.startSpeechToText();
      }
      this._publishRecognitionCycle('empty-final-recovered', {
        emptyFinals: this.runtimePipelineStats.emptyFinals
      });
    } catch (error) {
      this._publish(SESSION_EVENTS.VOICE_ERROR, this._buildEventPayload(null, {
        error: this._normalizeError(error)
      }));
    }
  }

  /**
   * Pause only the recognition consumer while microphone capture remains alive.
   * @param {string} reason Pause reason.
   * @returns {boolean}
   * @private
   */
  _pauseRecognitionConsumerForTurn(reason = 'recognition-turn-processing') {
    this.runtimePipelineStats.recognitionConsumerPauses += 1;
    this._log('Recognition Consumer Paused For Turn', {
      reason,
      recognitionCycleId: this.recognitionCycle.id
    });
    return true;
  }

  /**
   * Prepare the continuously running microphone pipeline for a fresh recognition cycle.
   * @param {string} reason Resume reason.
   * @returns {boolean}
   * @private
   */
  _prepareContinuousCaptureForRecognitionTurn(reason = 'recognition-turn-resume') {
    this.runtimePipelineStats.recognitionConsumerResumes += 1;
    const flushed = this._flushAudioCaptureBuffer(reason);
    this._log('Recognition Consumer Resumed For Turn', {
      reason,
      recognitionCycleId: this.recognitionCycle.id,
      captureBufferFlushed: flushed
    });
    return flushed;
  }

  /**
   * Flush queued microphone frames that arrived while recognition was paused.
   * @param {string} reason Flush reason.
   * @returns {boolean}
   * @private
   */
  _flushAudioCaptureBuffer(reason = 'recognition-cycle-boundary') {
    const audioCapture = this.resources.audioCapture;
    if (!audioCapture || typeof audioCapture.getBuffer !== 'function') return false;
    try {
      const buffer = audioCapture.getBuffer();
      if (!buffer || typeof buffer.flush !== 'function') return false;
      const result = buffer.flush();
      this.runtimePipelineStats.captureBufferFlushes += 1;
      this.runtimePipelineStats.captureBufferFlushedFrames += Number(result?.droppedFrames) || 0;
      this._log('Audio Capture Buffer Flushed For Recognition Boundary', {
        reason,
        recognitionCycleId: this.recognitionCycle.id,
        droppedFrames: Number(result?.droppedFrames) || 0
      });
      return true;
    } catch (error) {
      this._log('Audio Capture Buffer Flush Skipped', {
        reason,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Reject frames captured before the active recognition cycle started.
   * @param {object} frame AudioFrame-like object.
   * @returns {boolean}
   * @private
   */
  _isFrameFreshForRecognitionCycle(frame) {
    if (!this.recognitionCycle.active || !this.recognitionCycle.startedAt) return true;
    const startedAtMs = Number(this.recognitionCycle.startedAtMs) || Date.parse(this.recognitionCycle.startedAt);
    const frameTimestampMs = Date.parse(frame?.timestamp || '');
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(frameTimestampMs)) return true;
    return frameTimestampMs >= startedAtMs - 120;
  }

  /**
   * Clear per-turn transcript display state while preserving session history.
   * @returns {void}
   * @private
   */
  _clearSessionRecognitionTurn() {
    const recognition = this.currentSession?.context?.recognition;
    if (!recognition) return;
    recognition.partialTranscript = '';
    recognition.finalTranscript = '';
    recognition.normalizedTranscript = '';
    recognition.normalizedResult = null;
    recognition.latestResult = null;
  }

  /**
   * Publish recognition-cycle diagnostics metadata.
   * @param {string} phase Cycle phase.
   * @param {object} extra Extra metadata.
   * @returns {void}
   * @private
   */
  _publishRecognitionCycle(phase, extra = {}) {
    if (!this.currentSession) return;
    this._publish(SESSION_EVENTS.VOICE_RECOGNITION_CYCLE, this._buildEventPayload(this.currentSession, {
      phase,
      recognitionCycle: { ...this.recognitionCycle },
      ...extra
    }));
  }

  /**
   * Publish a lifecycle event internally.
   * @param {string} eventName Event name.
   * @param {object} payload Event payload.
   * @returns {void}
   * @private
   */
  _publish(eventName, payload) {
    const eventPayload = Object.freeze({ ...payload, eventName });
    const listeners = this.events.rawListeners(eventName);
    for (const listener of listeners) {
      try {
        listener.call(this.events, eventPayload);
      } catch (error) {
        this.logger?.warn?.(`[Voice] Event listener failed: ${eventName}`, {
          error: error.message,
          eventName
        });
      }
    }
  }

  /**
   * Build a serializable event payload.
   * @param {object|null} sessionSnapshot Optional session snapshot.
   * @param {object} extra Extra event fields.
   * @returns {object}
   * @private
   */
  _buildEventPayload(sessionSnapshot = null, extra = {}) {
    return {
      state: this.currentState,
      session: sessionSnapshot || this.getSession(),
      at: this.clock().toISOString(),
      ...extra
    };
  }

  /**
   * Build a standard success result.
   * @returns {{success: boolean, state: string, session: object|null}}
   * @private
   */
  _result() {
    return {
      success: true,
      state: this.currentState,
      session: this.getSession()
    };
  }

  /**
   * Normalize error metadata without leaking native error objects.
   * @param {Error|string|object} error Error input.
   * @returns {{name: string, message: string, type: string}}
   * @private
   */
  _normalizeError(error) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        type: error.type || 'VoiceSessionError'
      };
    }
    if (error && typeof error === 'object') {
      return {
        name: String(error.name || 'VoiceSessionError'),
        message: String(error.message || 'Voice session failed.'),
        type: String(error.type || 'VoiceSessionError')
      };
    }
    return {
      name: 'VoiceSessionError',
      message: String(error || 'Voice session failed.'),
      type: 'VoiceSessionError'
    };
  }

  /**
   * Reset per-session runtime audio pipeline counters.
   * @returns {void}
   * @private
   */
  _resetRuntimePipelineStats() {
    this.runtimePipelineStats = {
      audioFrames: 0,
      processedFrames: 0,
      sttFrames: 0,
      partialTranscripts: 0,
      finalTranscripts: 0,
      duplicatePartials: 0,
      suppressedPartials: 0,
      staleTranscripts: 0,
      duplicateFinals: 0,
      emptyFinals: 0,
      endpointDetections: 0,
      finalizationRequests: 0,
      speechCandidates: 0,
      acceptedSpeechCandidates: 0,
      rejectedSpeechCandidates: 0,
      rejectedNonSpeech: 0,
      rejectedBackgroundAudio: 0,
      rejectedTransientNoise: 0,
      rejectedElectronicAudio: 0,
      rejectedLowConfidenceSpeech: 0,
      rejectedUnstableSpeech: 0,
      speechPrerollFramesBuffered: 0,
      speechPrerollFramesFlushed: 0,
      audioFramesWhileBusy: 0,
      staleAudioFrames: 0,
      recognitionConsumerPauses: 0,
      recognitionConsumerResumes: 0,
      captureBufferFlushes: 0,
      captureBufferFlushedFrames: 0,
      assistantTurns: 0,
      userTurns: 0,
      ttsStarts: 0,
      ttsCompletions: 0,
      ttsCancellations: 0,
      ttsFailures: 0,
      duplicateConversationResumes: 0,
      listeningCycles: 0,
      lastPartialTranscript: '',
      lastLogAt: 0
    };
  }

  /**
   * Log runtime audio pipeline progress without flooding logs.
   * @param {string} message Log message.
   * @param {object} metadata Progress metadata.
   * @param {boolean} force Whether to log immediately.
   * @returns {void}
   * @private
   */
  _logRuntimePipeline(message, metadata = {}, force = false) {
    const count = Math.max(
      this.runtimePipelineStats.audioFrames,
      this.runtimePipelineStats.processedFrames,
      this.runtimePipelineStats.sttFrames,
      this.runtimePipelineStats.partialTranscripts,
      this.runtimePipelineStats.finalTranscripts
    );
    const now = Date.now();
    if (!force && count > 1 && count % 50 !== 0 && now - this.runtimePipelineStats.lastLogAt < 2500) {
      return;
    }
    this.runtimePipelineStats.lastLogAt = now;
    this._log(`Runtime pipeline: ${message}`, {
      ...metadata,
      counters: { ...this.runtimePipelineStats }
    });
  }

  /**
   * Write a centralized structured Voice log entry.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    this.logger.info(`[Voice] ${message}`, metadata);
  }
}

module.exports = VoiceSessionManager;
