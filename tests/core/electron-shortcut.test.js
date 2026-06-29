const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Electron Chat Shortcut', function() {
  const mainPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'electron', 'main.js');
  const script = fs.readFileSync(mainPath, 'utf8');

  it('should keep the hidden activation shortcut functional', function() {
    assert.match(script, /function getChatShortcuts\(\)/);
    assert.match(script, /runtimeConfig\?\.chat\?\.activationShortcut/);
    assert.match(script, /globalShortcut\.register\(shortcut/);
    assert.match(script, /createChatWindow\(\)/);
    assert.doesNotMatch(script, /global chat shortcuts are disabled/i);
  });

  it('should not show stale stopwatch widgets during startup restore', function() {
    assert.match(script, /includeStopwatch = options\.includeStopwatch === true/);
    assert.match(script, /if \(!includeStopwatch && state\?\.mode === 'stopwatch'\) return \{ visible: false \}/);
    assert.match(script, /showTimerWidget\(preferredId, \{ includeStopwatch: intent\.startsWith\('stopwatch\.'\) \}\)/);
  });
});
