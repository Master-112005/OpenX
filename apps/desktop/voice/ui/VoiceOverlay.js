'use strict';

const EventEmitter = require('events');
const { SESSION_EVENTS } = require('../session/SessionEvents');
const VoiceConfiguration = require('./VoiceConfiguration');
const VoiceStateRenderer = require('./VoiceStateRenderer');
const VoiceAnimationController = require('./VoiceAnimationController');
const VoiceStatusIndicator = require('./VoiceStatusIndicator');
const VoiceTheme = require('./VoiceTheme');
const VoiceAccessibility = require('./VoiceAccessibility');
const TranscriptPublisher = require('./TranscriptPublisher');
const VOICE_UI_EVENTS = require('./VoiceUIEvents');

/**
 * Purpose: Represents the floating Voice assistant overlay.
 * Responsibility: React to VoiceSessionManager events, render state metadata, update transcripts, and coordinate presentation-only UI helpers.
 * Dependencies: Voice UI renderer, animation, theme, accessibility, transcript publisher, and optional window controller.
 * Lifecycle: Hidden until manager events arrive, visible through listening/processing/executing/finished/error, then hidden by close events.
 * Future extension notes: Never import STT, microphone, NLP, router, automation, or assistant execution logic here.
 */
class VoiceOverlay extends EventEmitter {
  /**
   * Create a Voice overlay.
   * @param {{configuration?: object|VoiceConfiguration, windowController?: object, stateRenderer?: VoiceStateRenderer, animationController?: VoiceAnimationController, statusIndicator?: VoiceStatusIndicator, theme?: VoiceTheme, accessibility?: VoiceAccessibility, transcriptPublisher?: TranscriptPublisher, logger?: object, clock?: Function}} dependencies Overlay dependencies.
   */
  constructor(dependencies = {}) {
    super();
    this.configuration = dependencies.configuration instanceof VoiceConfiguration
      ? dependencies.configuration
      : new VoiceConfiguration(dependencies.configuration || {});
    this.windowController = dependencies.windowController || null;
    this.stateRenderer = dependencies.stateRenderer || new VoiceStateRenderer();
    this.animationController = dependencies.animationController || new VoiceAnimationController({
      reducedMotion: this.configuration.accessibility.reducedMotion,
      logger: dependencies.logger,
      clock: dependencies.clock
    });
    this.statusIndicator = dependencies.statusIndicator || new VoiceStatusIndicator();
    this.theme = dependencies.theme || new VoiceTheme({ defaults: this.configuration.theme });
    this.accessibility = dependencies.accessibility || new VoiceAccessibility(this.configuration.accessibility);
    this.transcriptPublisher = dependencies.transcriptPublisher || new TranscriptPublisher({ target: this, logger: dependencies.logger });
    this.logger = dependencies.logger || null;
    this.clock = dependencies.clock || (() => new Date());
    this.visible = false;
    this.currentView = this.stateRenderer.render('HIDDEN');
    this.metrics = {
      overlayOpenDurationMs: 0,
      openedAt: null,
      stateChanges: 0,
      transcriptUpdates: 0,
      errorCount: 0,
      cancelCount: 0,
      completionCount: 0
    };
    this._manager = null;
    this._subscriptions = [];
  }

  /**
   * Attach the overlay to a VoiceSessionManager event stream.
   * @param {{on: Function, off?: Function}} manager VoiceSessionManager-like event source.
   * @returns {VoiceOverlay}
   */
  attachToSessionManager(manager) {
    if (!manager || typeof manager.on !== 'function') return this;
    this.detach();
    this._manager = manager;
    this._subscribe(manager, SESSION_EVENTS.VOICE_SESSION_CREATED, event => this.show(event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_SESSION_STARTED, event => this.updateState(event.state, event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_STATE_CHANGED, event => this.updateState(event.state, event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_PARTIAL_TRANSCRIPT, event => this.transcriptPublisher.publishPartial(event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_FINAL_TRANSCRIPT, event => this.transcriptPublisher.publishFinal(event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_SESSION_FINISHED, event => {
      this.updateState(event.state, event);
      this.metrics.completionCount += 1;
      this.emit(VOICE_UI_EVENTS.EXECUTION_COMPLETED, Object.freeze({ state: event.state }));
    });
    this._subscribe(manager, SESSION_EVENTS.VOICE_SESSION_CANCELLED, event => this.updateState(event.state, event));
    this._subscribe(manager, SESSION_EVENTS.VOICE_SESSION_CLOSED, () => this.hide());
    this._subscribe(manager, SESSION_EVENTS.VOICE_ERROR, event => this.displayError(event.error || event));
    return this;
  }

  /**
   * Detach all manager event subscriptions.
   * @returns {VoiceOverlay}
   */
  detach() {
    for (const subscription of this._subscriptions) {
      const remove = subscription.manager.off || subscription.manager.removeListener;
      if (typeof remove === 'function') {
        remove.call(subscription.manager, subscription.eventName, subscription.listener);
      }
    }
    this._subscriptions = [];
    this._manager = null;
    return this;
  }

  /**
   * Show the overlay.
   * @param {object} context Render context.
   * @returns {{visible: boolean, view: object}}
   */
  show(context = {}) {
    this.visible = true;
    this.metrics.openedAt = this.metrics.openedAt || this.clock();
    const view = this._composeView(context.state || 'INITIALIZING', context);
    if (this.windowController && typeof this.windowController.show === 'function') {
      this.windowController.show(view);
    }
    this.emit(VOICE_UI_EVENTS.OVERLAY_OPENED, Object.freeze({ view }));
    this._log('Overlay Opened', { state: view.state });
    return { visible: true, view };
  }

  /**
   * Hide the overlay.
   * @returns {{visible: boolean}}
   */
  hide() {
    if (this.metrics.openedAt) {
      this.metrics.overlayOpenDurationMs += Math.max(0, this.clock().getTime() - this.metrics.openedAt.getTime());
      this.metrics.openedAt = null;
    }
    this.visible = false;
    if (this.windowController && typeof this.windowController.hide === 'function') {
      this.windowController.hide();
    }
    this.emit(VOICE_UI_EVENTS.OVERLAY_CLOSED, Object.freeze({ visible: false }));
    this._log('Overlay Closed');
    return { visible: false };
  }

  /**
   * Update overlay lifecycle state.
   * @param {string} state Voice lifecycle state.
   * @param {object} context Render context.
   * @returns {{updated: boolean, state: string, view: object}}
   */
  updateState(state, context = {}) {
    const view = this._composeView(state, this._contextFromSession(context));
    this.visible = view.visible !== false;
    this.metrics.stateChanges += 1;
    if (view.state === 'EXECUTING') this.emit(VOICE_UI_EVENTS.EXECUTION_STARTED, Object.freeze({ view }));
    if (this.windowController && typeof this.windowController.updateState === 'function') {
      this.windowController.updateState(view);
    }
    this.emit(VOICE_UI_EVENTS.VOICE_STATE_CHANGED, Object.freeze({ state: view.state, view }));
    this._log(view.statusText, { state: view.state });
    return { updated: true, state: view.state, view };
  }

  /**
   * Update transcript display.
   * @param {{transcript?: string, partial?: boolean}|string} transcript Transcript payload.
   * @returns {{updated: boolean, transcript: string, partial: boolean}}
   */
  updateTranscript(transcript) {
    const payload = typeof transcript === 'string'
      ? { transcript, partial: true }
      : { transcript: String(transcript?.transcript || ''), partial: transcript?.partial === true };
    this.metrics.transcriptUpdates += 1;
    if (this.windowController && typeof this.windowController.updateTranscript === 'function') {
      this.windowController.updateTranscript(payload);
    }
    this.emit(VOICE_UI_EVENTS.TRANSCRIPT_UPDATED, Object.freeze(payload));
    return { updated: true, ...payload };
  }

  /**
   * Display a user-safe error state.
   * @param {object|string|Error} error Error payload.
   * @returns {{displayed: boolean, view: object}}
   */
  displayError(error) {
    this.metrics.errorCount += 1;
    const view = this._composeView('ERROR', { error });
    this.visible = true;
    if (this.windowController && typeof this.windowController.displayError === 'function') {
      this.windowController.displayError(view);
    }
    this.emit(VOICE_UI_EVENTS.ERROR_DISPLAYED, Object.freeze({ view }));
    this._log('Error Displayed', { message: view.errorMessage });
    return { displayed: true, view };
  }

  /**
   * Request cancellation through the injected manager or cancellation handler.
   * @param {string} reason Cancellation reason.
   * @returns {{requested: boolean, reason: string}}
   */
  requestCancellation(reason = 'Voice overlay cancellation requested.') {
    this.metrics.cancelCount += 1;
    if (this._manager && typeof this._manager.cancelSession === 'function') {
      this._manager.cancelSession(reason);
    }
    this.emit(VOICE_UI_EVENTS.CANCELLATION_REQUESTED, Object.freeze({ reason }));
    return { requested: true, reason };
  }

  /**
   * Return overlay metrics.
   * @returns {object}
   */
  getMetrics() {
    return {
      ...this.metrics,
      animation: this.animationController.getMetrics()
    };
  }

  /**
   * Subscribe to a manager event and remember the listener.
   * @param {object} manager Event source.
   * @param {string} eventName Event name.
   * @param {Function} listener Listener.
   * @returns {void}
   * @private
   */
  _subscribe(manager, eventName, listener) {
    if (!eventName) return;
    manager.on(eventName, listener);
    this._subscriptions.push({ manager, eventName, listener });
  }

  /**
   * Build a renderer-ready view.
   * @param {string} state Voice state.
   * @param {object} context Render context.
   * @returns {object}
   * @private
   */
  _composeView(state, context = {}) {
    const viewModel = this.stateRenderer.render(state, context);
    const animation = this.animationController.trigger(viewModel.animation, { state: viewModel.state });
    const view = Object.freeze({
      ...viewModel,
      status: this.statusIndicator.render(viewModel),
      theme: this.theme.currentTheme,
      cssVariables: this.theme.toCssVariables(),
      accessibility: this.accessibility.apply(viewModel),
      animation
    });
    this.currentView = view;
    return view;
  }

  /**
   * Extract transcript context from a manager event.
   * @param {object} event Manager event.
   * @returns {object}
   * @private
   */
  _contextFromSession(event = {}) {
    const recognition = event.session?.context?.recognition || {};
    return {
      partialTranscript: recognition.partialTranscript || '',
      finalTranscript: recognition.normalizedTranscript || recognition.finalTranscript || '',
      commandText: event.commandText || event.command || '',
      error: event.error || null
    };
  }

  /**
   * Write structured Voice UI logs.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Voice UI] ${message}`, metadata);
    }
  }
}

module.exports = VoiceOverlay;
