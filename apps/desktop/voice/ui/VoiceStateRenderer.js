'use strict';

const VoiceStateMachine = require('../session/VoiceStateMachine');

const STATES = VoiceStateMachine.STATES;
const STATE_VIEW_MODELS = Object.freeze({
  HIDDEN: Object.freeze({
    state: 'HIDDEN',
    visible: false,
    icon: 'dot',
    title: 'Hidden',
    statusText: 'Voice overlay hidden',
    description: 'Voice overlay is hidden.',
    animation: 'none'
  }),
  [STATES.INITIALIZING]: Object.freeze({
    visible: true,
    icon: 'spark',
    title: 'Starting',
    statusText: 'Initializing voice...',
    description: 'Voice session is starting.',
    animation: 'fade-in'
  }),
  [STATES.READY]: Object.freeze({
    visible: true,
    icon: 'ready',
    title: 'Ready',
    statusText: 'Ready',
    description: 'Voice session is ready.',
    animation: 'fade-in'
  }),
  [STATES.LISTENING]: Object.freeze({
    visible: true,
    icon: 'microphone',
    title: 'Listening',
    statusText: 'Listening',
    description: 'Microphone is active and waiting for speech.',
    animation: 'listening-pulse'
  }),
  [STATES.PROCESSING]: Object.freeze({
    visible: true,
    icon: 'thinking',
    title: 'Thinking',
    statusText: 'Thinking...',
    description: 'Speech has ended and the assistant is processing the transcript.',
    animation: 'thinking-pulse'
  }),
  [STATES.EXECUTING]: Object.freeze({
    visible: true,
    icon: 'bolt',
    title: 'Executing',
    statusText: 'Executing command...',
    description: 'The assistant is executing the command.',
    animation: 'executing-transition'
  }),
  [STATES.SPEAKING]: Object.freeze({
    visible: true,
    icon: 'voice',
    title: 'Speaking',
    statusText: 'Speaking...',
    description: 'The assistant is speaking and recognition is paused.',
    animation: 'speaking-pulse'
  }),
  [STATES.FINISHED]: Object.freeze({
    visible: true,
    icon: 'check',
    title: 'Done',
    statusText: 'Command completed.',
    description: 'The voice command completed successfully.',
    animation: 'completion'
  }),
  [STATES.CANCELLED]: Object.freeze({
    visible: true,
    icon: 'close',
    title: 'Cancelled',
    statusText: 'Voice cancelled.',
    description: 'The voice session was cancelled.',
    animation: 'fade-out'
  }),
  [STATES.CLOSING]: Object.freeze({
    visible: true,
    icon: 'close',
    title: 'Closing',
    statusText: 'Closing...',
    description: 'Voice overlay is closing.',
    animation: 'fade-out'
  }),
  [STATES.ERROR]: Object.freeze({
    visible: true,
    icon: 'warning',
    title: 'Problem',
    statusText: 'Voice unavailable.',
    description: 'The voice session has an error.',
    animation: 'error'
  }),
  [STATES.IDLE]: Object.freeze({
    state: 'HIDDEN',
    visible: false,
    icon: 'dot',
    title: 'Hidden',
    statusText: 'Voice overlay hidden',
    description: 'Voice overlay is hidden.',
    animation: 'fade-out'
  })
});

/**
 * Purpose: Maps VoiceSessionManager lifecycle states to UI view models.
 * Responsibility: Keep state rendering centralized and free of speech logic.
 * Dependencies: VoiceStateMachine state vocabulary only.
 * Lifecycle: Used whenever the overlay receives a manager state event.
 * Future extension notes: Add visual states here, not in Electron or renderer code.
 */
class VoiceStateRenderer {
  /**
   * Render a UI view model for a voice state.
   * @param {string} state Voice lifecycle state.
   * @param {{partialTranscript?: string, finalTranscript?: string, commandText?: string, error?: object|string}} context UI context.
   * @returns {object}
   */
  render(state, context = {}) {
    const key = String(state || 'HIDDEN').toUpperCase();
    const base = STATE_VIEW_MODELS[key] || STATE_VIEW_MODELS[STATES.ERROR];
    const transcript = context.partialTranscript || context.finalTranscript || context.commandText || '';
    const errorMessage = this._formatError(context.error);
    return Object.freeze({
      ...base,
      state: base.state || key,
      transcript,
      partialTranscript: context.partialTranscript || '',
      finalTranscript: context.finalTranscript || '',
      commandText: context.commandText || '',
      errorMessage,
      statusText: errorMessage && key === STATES.ERROR ? errorMessage : base.statusText,
      ariaLabel: this._buildAriaLabel(base, transcript, errorMessage)
    });
  }

  /**
   * Convert an error object into a concise UI message.
   * @param {object|string} error Error payload.
   * @returns {string}
   * @private
   */
  _formatError(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    return String(error.message || error.type || 'Voice session failed.');
  }

  /**
   * Build a screen-reader label.
   * @param {object} viewModel Base view model.
   * @param {string} transcript Transcript text.
   * @param {string} errorMessage Error text.
   * @returns {string}
   * @private
   */
  _buildAriaLabel(viewModel, transcript, errorMessage) {
    const parts = [viewModel.description || viewModel.statusText];
    if (transcript) parts.push(`Transcript: ${transcript}`);
    if (errorMessage) parts.push(`Error: ${errorMessage}`);
    return parts.filter(Boolean).join(' ');
  }
}

VoiceStateRenderer.STATE_VIEW_MODELS = STATE_VIEW_MODELS;

module.exports = VoiceStateRenderer;
