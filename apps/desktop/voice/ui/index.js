'use strict';

const VoiceOverlay = require('./VoiceOverlay');
const VoiceWindowController = require('./VoiceWindowController');
const TranscriptPublisher = require('./TranscriptPublisher');
const VoiceStateRenderer = require('./VoiceStateRenderer');
const VoiceAnimationController = require('./VoiceAnimationController');
const VoiceStatusIndicator = require('./VoiceStatusIndicator');
const VoiceTheme = require('./VoiceTheme');
const VoiceConfiguration = require('./VoiceConfiguration');
const VOICE_UI_EVENTS = require('./VoiceUIEvents');
const VoiceUIErrors = require('./VoiceUIErrors');
const VoiceOverlayIPC = require('./VoiceOverlayIPC');
const VoiceAccessibility = require('./VoiceAccessibility');

module.exports = {
  VoiceOverlay,
  VoiceWindowController,
  TranscriptPublisher,
  VoiceStateRenderer,
  VoiceAnimationController,
  VoiceStatusIndicator,
  VoiceTheme,
  VoiceConfiguration,
  VOICE_UI_EVENTS,
  ...VoiceUIErrors,
  VoiceOverlayIPC,
  VoiceAccessibility
};
