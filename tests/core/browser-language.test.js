const assert = require('assert');
const BrowserCommandLanguage = require('../../core/assistant/browser-language');

describe('Browser Command Language', function() {
  const language = new BrowserCommandLanguage();

  it('should parse list and count tab questions separately', function() {
    const count = language.parse('how many tabs are in chrome');
    const list = language.parse('what tabs are open in chrome');

    assert.equal(count.operation, 'list-tabs');
    assert.equal(count.entities.responseMode, 'count');
    assert.equal(list.entities.responseMode, 'list');
  });

  it('should parse new and another-new tab commands as forced new tabs', function() {
    const first = language.parse('open new tab in chrome');
    const another = language.parse('open another new tab');

    assert.equal(first.operation, 'new-tab');
    assert.equal(first.entities.forceNewTab, true);
    assert.equal(another.operation, 'new-tab');
  });

  it('should parse named tabs and repair joined in-browser speech', function() {
    const named = language.parse('open jio hotstar tab in chrome');
    const joined = language.parse('open jiohotstarin chrome');

    assert.equal(named.operation, 'open-named-tab');
    assert.equal(named.entities.tabQuery, 'jio hotstar');
    assert.equal(joined.operation, 'open-browser-target');
    assert.equal(joined.entities.query, 'jiohotstar');
  });
});
