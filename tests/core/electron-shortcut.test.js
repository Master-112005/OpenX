const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Electron Chat Shortcut', function() {
  const mainPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'electron', 'main.js');
  const script = fs.readFileSync(mainPath, 'utf8');

  it('should route the hidden activation shortcut to voice listening', function() {
    assert.match(script, /function getChatShortcuts\(\)/);
    assert.match(script, /runtimeConfig\?\.chat\?\.activationShortcut/);
    assert.match(script, /function startVoiceListeningFromShortcut\(shortcut = ''\)/);
    assert.match(script, /globalShortcut\.register\(shortcut/);
    assert.match(script, /startVoiceListeningFromShortcut\(shortcut\)/);
    assert.match(script, /voiceSessionManager\.startSession/);
    assert.doesNotMatch(script, /global chat shortcuts are disabled/i);
  });

  it('should open chat from tray double click instead of the voice hotkey', function() {
    assert.match(script, /tray\.setIgnoreDoubleClickEvents\(false\)/);
    assert.match(script, /tray\.on\('double-click', \(\) => createChatWindow\(\)\)/);
  });

  it('should not show stale stopwatch widgets during startup restore', function() {
    assert.match(script, /let timerWidgetMode = null/);
    assert.match(script, /includeStopwatch = options\.includeStopwatch === true \|\| timerWidgetMode === 'stopwatch'/);
    assert.match(script, /if \(!includeStopwatch && state\?\.mode === 'stopwatch'\) return \{ visible: false \}/);
    assert.match(script, /timerWidgetMode = nextState\?\.visible \? nextState\.mode : null/);
    assert.match(script, /showTimerWidget\(preferredId, \{ includeStopwatch: intent\.startsWith\('stopwatch\.'\) \}\)/);
  });

  it('should recover renderer failures without tight restart loops', function() {
    assert.match(script, /const MAX_RENDERER_RECOVERY_DELAY_MS = 5000/);
    assert.match(script, /const RENDERER_RECOVERABLE_REASONS = new Set/);
    assert.match(script, /function isRendererExitRecoverable\(reason\)/);
    assert.match(script, /function clearUnresponsiveTimeout\(browserWindow\)/);
    assert.match(script, /RENDERER_RESTART_DELAY_MS \* Math\.max\(1, budget\.crashCount\)/);
    assert.match(script, /reloadIgnoringCache\(\)/);
    assert.match(script, /renderer-unresponsive/);
  });
});
