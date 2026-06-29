const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Timer Widget Renderer', function() {
  const rendererRoot = path.join(__dirname, '..', '..', 'apps', 'desktop', 'renderer', 'timer-widget');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'index.css'), 'utf8');
  const script = fs.readFileSync(path.join(rendererRoot, 'index.js'), 'utf8');

  it('should render a compact independent timer and stopwatch widget', function() {
    assert.match(html, /id="close-btn"/);
    assert.match(html, /id="reset-btn"/);
    assert.match(html, />↻<\/button>/);
    assert.match(html, /id="timer-progress"/);
    assert.match(html, /<button class="stopwatch-face" id="stopwatch-face" type="button"/);
    assert.match(html, /id="stopwatch-value"/);
    assert.match(css, /\.widget\s*\{[^}]*width:\s*138px;/s);
    assert.match(css, /border-radius:\s*24px/);
    assert.match(script, /getTimerWidgetState/);
    assert.match(script, /closeTimerWidget/);
    assert.match(script, /stopStopwatchFromWidget/);
    assert.match(script, /resumeStopwatchFromWidget/);
    assert.match(script, /resetStopwatchFromWidget/);
    assert.match(script, /Start stopwatch/);
    assert.match(script, /dataset\.state = state\.status/);
    assert.match(script, /dataset\.mode = 'stopwatch'/);
    assert.match(script, /strokeDashoffset/);
    assert.match(script, /AudioContext/);
    assert.match(script, /playWidgetTone\(state\.mode\)/);
    assert.match(css, /\.stopwatch-face:active\s*\{/);
    assert.match(css, /\.widget\[data-mode="stopwatch"\] \.reset-btn/);
    assert.match(css, /-webkit-app-region:\s*no-drag/);
  });
});
