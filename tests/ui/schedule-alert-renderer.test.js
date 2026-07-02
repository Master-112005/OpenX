const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Dynamic Island Schedule Alerts', function() {
  const root = path.join(__dirname, '..', '..');
  const preload = fs.readFileSync(path.join(root, 'apps', 'desktop', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'apps', 'desktop', 'electron', 'main.js'), 'utf8');
  const voiceWindow = fs.readFileSync(path.join(root, 'apps', 'desktop', 'voice', 'ui', 'VoiceWindowController.js'), 'utf8');
  const voiceOverlay = fs.readFileSync(path.join(root, 'apps', 'desktop', 'voice', 'ui', 'VoiceOverlay.js'), 'utf8');

  it('should render schedule alerts inside the Dynamic Island with inline actions', function() {
    assert.equal(fs.existsSync(path.join(root, 'apps', 'desktop', 'renderer', 'alert')), false);
    assert.match(main, /function presentScheduleInDynamicIsland\(schedule = \{\}\)/);
    assert.match(main, /function buildScheduleDynamicIslandActions\(schedule = \{\}\)/);
    assert.match(main, /function scheduleActionId\(schedule = \{\}\)/);
    assert.match(main, /intent: 'schedule\.due'/);
    assert.match(main, /label: 'Snooze 5 min'/);
    assert.match(main, /label: 'Stop'/);
    assert.match(main, /actions: buildScheduleDynamicIslandActions\(schedule\)/);
    assert.match(main, /scheduleId,\s*\n\s*primary: true/s);
    assert.doesNotMatch(main, /new BrowserWindow\(\{\s*width:\s*420,\s*height:\s*440/s);
    assert.doesNotMatch(main, /windowType: 'schedule-alert'/);
    assert.doesNotMatch(main, /alertWindow/);

    assert.match(voiceOverlay, /actions: this\._normalizeActions\(result\)/);
    assert.match(voiceOverlay, /\['snooze', 'stop'\]\.includes\(action\.kind \|\| action\.id\)/);
    assert.match(preload, /function appendVoiceActions\(fragment, payload = \{\}\)/);
    assert.match(preload, /ipcRenderer\.invoke\('schedule:alertAction'/);
    assert.match(preload, /button\.setAttribute\('aria-label', button\.textContent\)/);
    assert.match(preload, /function playVoiceScheduleSound\(kind\)/);
    assert.match(preload, /function stopVoiceAlertSound\(\)/);
    assert.match(voiceWindow, /\.voice-action-row/);
    assert.match(voiceWindow, /scrollbar-width: none/);
  });
});
