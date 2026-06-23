const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Dedicated Schedule Alert UI', function() {
  const rendererRoot = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'alert');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'index.css'), 'utf8');
  const script = fs.readFileSync(path.join(rendererRoot, 'index.js'), 'utf8');

  it('should render timers and reminders without the assistant shell', function() {
    assert.doesNotMatch(html, /chat-shell|conversation-view|settings-overlay/);
    assert.match(html, /id="alert-symbol"/);
    assert.match(html, /id="snooze-btn"/);
    assert.match(html, /id="stop-btn"/);
    assert.match(script, /⏱️/);
    assert.match(script, /📝/);
    assert.match(script, /education: \{ symbol: '🎓'/);
    assert.match(script, /water: \{ symbol: '💧'/);
    assert.match(script, /exercise: \{ symbol: '🏃'/);
    assert.match(script, /handleScheduleAlert/);
    assert.match(css, /border-radius:\s*36px/);
  });
});
