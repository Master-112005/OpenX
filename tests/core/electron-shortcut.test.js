const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Electron Chat Shortcut', function() {
  const mainPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'electron', 'main.js');
  const captureHtmlPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'voice-capture', 'index.html');
  const captureScriptPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'voice-capture', 'index.js');
  const preloadPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'preload.js');
  const script = fs.readFileSync(mainPath, 'utf8');
  const captureHtml = fs.readFileSync(captureHtmlPath, 'utf8');
  const captureScript = fs.readFileSync(captureScriptPath, 'utf8');
  const preloadScript = fs.readFileSync(preloadPath, 'utf8');

  it('should route Alt+Space to voice listening and Ctrl+Space to chat', function() {
    assert.match(script, /function getChatShortcuts\(\)/);
    assert.match(script, /function getVoiceShortcuts\(\)/);
    assert.match(script, /Control\+Space/);
    assert.match(script, /Alt\+Space/);
    assert.match(script, /function openChatFromShortcut\(shortcut = ''\)/);
    assert.match(script, /function startVoiceListeningFromShortcut\(shortcut = ''\)/);
    assert.match(script, /function createDesktopVoiceResources\(\)/);
    assert.match(script, /globalShortcut\.register\(shortcut/);
    assert.match(script, /openChatFromShortcut\(shortcut\)/);
    assert.match(script, /startVoiceListeningFromShortcut\(shortcut\)/);
    assert.match(script, /chatWindow\.hide\(\)/);
    assert.match(script, /voiceSessionManager\.startSession/);
    assert.match(script, /voiceSessionManager\.startAudioCapture\(\)/);
    assert.match(script, /voiceSessionManager\.startSpeechToText\(\)/);
    assert.match(script, /Registered voice shortcut/);
    assert.match(script, /Registered chat shortcut/);
    assert.doesNotMatch(script, /global chat shortcuts are disabled/i);
  });

  it('should attach the voice orb overlay to the voice session manager', function() {
    assert.match(script, /function createVoiceOverlayForManager\(manager\)/);
    assert.match(script, /new VoiceWindowController/);
    assert.match(script, /new VoiceOverlay/);
    assert.match(script, /overlay\.attachToSessionManager\(manager\)/);
    assert.match(script, /voiceOverlay = createVoiceOverlayForManager\(voiceSessionManager\)/);
    assert.match(script, /new VoiceTheme\(\{ settings: settingsService\?\.getSnapshot\?\.\(\) \|\| \{\} \}\)/);
  });

  it('should use local desktop voice providers instead of empty audio placeholders', function() {
    assert.match(script, /new AudioPermissions\(\{ provider: permissionProvider/);
    assert.match(script, /new AudioDeviceManager\(\{ provider: deviceProvider/);
    assert.match(script, /new AudioCapture\(/);
    assert.match(script, /new STTEngine\(/);
    assert.match(script, /path\.resolve\(process\.cwd\(\), 'models', 'parakeet'\)/);
  });

  it('should open a real microphone stream for the OS privacy indicator only from the trusted capture renderer', function() {
    assert.match(script, /const VOICE_CAPTURE_FILE = path\.join\(RENDERER_ROOT, 'voice-capture', 'index\.html'\)/);
    assert.match(script, /function isVoiceCaptureRendererUrl\(url\)/);
    assert.match(script, /canGrantVoiceCapturePermission\(webContents, permission, requestingUrl\)/);
    assert.match(script, /function createVoiceCaptureWindow\(\)/);
    assert.match(script, /function createDesktopMicrophoneBackend\(\)/);
    assert.match(script, /voiceCapture:start/);
    assert.match(script, /voiceCapture:stop/);
    assert.match(script, /ipcMain\.on\('voiceCapture:frame'/);
    assert.match(script, /receiveVoiceCaptureFrame\(payload\)/);
    assert.match(script, /voiceCaptureFrameReceiver\(frame\)/);
    assert.match(script, /let voiceCaptureRunId = 0/);
    assert.match(script, /frame\.runId !== voiceCaptureRunId/);
    assert.doesNotMatch(script, /Voice PCM frame dropped because capture run is stale/);
    assert.match(preloadScript, /contextBridge\.exposeInMainWorld\('openxVoiceCapture'/);
    assert.match(preloadScript, /sendFrame: \(frame\) =>/);
    assert.match(captureHtml, /Content-Security-Policy/);
    assert.match(captureScript, /navigator\.mediaDevices\.getUserMedia/);
    assert.match(captureScript, /createAnalyser/);
    assert.match(captureScript, /setInterval\(sendCurrentFrame, FRAME_DURATION_MS\)/);
    assert.match(captureScript, /currentRunId !== requestedRunId/);
    assert.match(captureScript, /stale-start-ignored/);
    assert.match(captureScript, /runId: activeRunId/);
    assert.match(captureScript, /framesSent, bytesSent, rms: encoded\.rms, runId: activeRunId/);
    assert.match(captureScript, /downsample/);
    assert.match(captureScript, /pcmFromSamples/);
    assert.match(captureScript, /sendFrame\(\{/);
    assert.match(captureScript, /track\.stop\(\)/);
  });

  it('should open chat from tray double click instead of the voice hotkey', function() {
    assert.match(script, /tray\.setIgnoreDoubleClickEvents\(false\)/);
    assert.match(script, /tray\.on\('double-click', \(\) => createChatWindow\(\)\)/);
  });

  it('should expose a chat header voice launcher without changing command routing', function() {
    const chatHtmlPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'chat', 'index.html');
    const chatScriptPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'chat', 'index.js');
    const chatHtml = fs.readFileSync(chatHtmlPath, 'utf8');
    const chatScript = fs.readFileSync(chatScriptPath, 'utf8');

    assert.match(preloadScript, /startVoice: \(\) =>\s*ipcRenderer\.invoke\('voice:start'\)/);
    assert.match(script, /registerIpcHandler\('voice:start'/);
    assert.match(chatHtml, /id="voice-start-btn"/);
    assert.match(chatScript, /const voiceStartBtn = document\.getElementById\('voice-start-btn'\)/);
    assert.match(chatScript, /window\.jarvis\.startVoice\(\)/);
    assert.match(chatScript, /voiceStartBtn\.addEventListener\('click', startVoiceFromChat\)/);
    assert.match(chatScript, /processCommand\(text, 'chat'\)/);
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
