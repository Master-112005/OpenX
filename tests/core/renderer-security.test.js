const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('Renderer Content Security', function() {
  const rendererRoot = path.resolve(__dirname, '..', '..', 'apps', 'desktop', 'renderer');

  for (const view of ['chat', 'settings', 'planner']) {
    it(`should keep the ${view} view on local scripts and styles`, function() {
      const viewRoot = path.join(rendererRoot, view);
      const html = fs.readFileSync(path.join(viewRoot, 'index.html'), 'utf8');
      const script = fs.readFileSync(path.join(viewRoot, 'index.js'), 'utf8');
      const css = fs.readFileSync(path.join(viewRoot, 'index.css'), 'utf8');
      const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

      assert.match(html, /<script src="\.\/index\.js"><\/script>/);
      assert.match(html, /<link rel="stylesheet" href="\.\/index\.css">/);
      assert.doesNotMatch(html, /<script>(?:.|\n)*?<\/script>/);
      assert.doesNotMatch(html, /<style>(?:.|\n)*?<\/style>/);
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /connect-src 'none'/);
      assert.doesNotMatch(script, /\.(?:innerHTML|outerHTML)\s*=/);
      assert.ok(css.length > 100);
    });
  }
});
