const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Chat Renderer UI', function() {
  const rendererRoot = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'chat');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'index.css'), 'utf8');
  const glassCss = fs.readFileSync(path.join(rendererRoot, 'index.css'), 'utf8');
  const script = fs.readFileSync(path.join(rendererRoot, 'index.js'), 'utf8');

  it('should provide dedicated chat, activity, notification, and alarm surfaces', function() {
    ['conversation-view', 'activity-view', 'toast-region', 'alarm-overlay', 'schedule-list', 'notification-list']
      .forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  });

  it('should keep assistant messages inside their bubbles at narrow widths', function() {
    assert.match(css, /\.message-bubble\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    assert.match(css, /\.message-stack\s*\{[^}]*min-width:\s*0;/s);
    assert.match(css, /@media\s*\(max-width:\s*460px\)/);
  });

  it('should render and persist alarms, reminders, and notifications', function() {
    assert.match(script, /function addScheduleFromResult\(/);
    assert.match(script, /function triggerSchedule\(/);
    assert.match(script, /function showToast\(/);
    assert.match(script, /SCHEDULE_STORAGE_KEY/);
    assert.match(script, /NOTIFICATION_STORAGE_KEY/);
    assert.match(html, /id="alarm-symbol"/);
    assert.match(script, /handleScheduleAlert/);
    assert.match(glassCss, /Dedicated timer and reminder alert/);
  });

  it('should provide a dedicated assistant-only voice mute control', function() {
    assert.match(html, /id="assistant-mute-btn"/);
    assert.match(script, /ASSISTANT_MUTED_STORAGE_KEY/);
    assert.match(script, /window\.jarvis\?\.stopSpeaking/);
    assert.match(script, /if \(!isAssistantMuted && spokenText/);
  });

  it('should keep settings compact and move contacts into active learning', function() {
    assert.doesNotMatch(html, /id="minimize-btn"/);
    assert.doesNotMatch(html, /data-section-target="contacts"/);
    assert.match(script, /initializeCompactSettingsLayout/);
    assert.match(script, /Active learning contacts/);
    assert.match(glassCss, /Compact in-window settings/);
    assert.match(glassCss, /#settings-overlay\.open/);
  });

  it('should expose adaptive glass, bounded access, and horizontal mode controls', function() {
    assert.match(html, /id="glass-tint"/);
    assert.match(html, /data-permission="critical"/);
    assert.match(script, /function applyGlassTint/);
    assert.match(script, /mode-tabs/);
    assert.match(script, /mode-app-tabs/);
    assert.match(glassCss, /Adaptive glass themes and controls/);
    assert.match(script, /glassContrast/);
    assert.match(glassCss, /Tint-aware foreground contrast/);
  });

  it('should bound long-session rendering and coalesce glass tint updates', function() {
    assert.match(script, /MAX_RENDERED_MESSAGES\s*=\s*100/);
    assert.match(script, /renderedMessages\[index\]\.remove\(\)/);
    assert.match(script, /function scheduleGlassTintUpdate\(/);
    assert.match(script, /requestAnimationFrame\(/);
    assert.match(glassCss, /GPU and long-session performance/);
    assert.match(glassCss, /content-visibility:\s*auto/);
  });
});
