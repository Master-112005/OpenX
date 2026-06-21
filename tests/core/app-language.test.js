const assert = require('assert');
const AppCommandLanguage = require('../../core/assistant/app-language');

describe('App Command Language', function() {
  const language = new AppCommandLanguage();

  it('should distinguish ordinary open from explicit new-window requests', function() {
    const ordinary = language.parse('open chrome');
    const newWindow = language.parse('open a new chrome window');
    const another = language.parse('please launch another notepad app');

    assert.equal(ordinary.requestedOperation, 'open-or-focus');
    assert.equal(ordinary.forceNewWindow, false);
    assert.equal(newWindow.targetText, 'chrome');
    assert.equal(newWindow.forceNewWindow, true);
    assert.equal(another.targetText, 'notepad');
    assert.equal(another.requestedOperation, 'open-new-window');
  });

  it('should understand corrected app-command speech', function() {
    const corrected = language.parse('opne anther notpad', 'open another notepad');

    assert.equal(corrected.targetText, 'notepad');
    assert.equal(corrected.forceNewWindow, true);
    assert.equal(corrected.validation.status, 'passed');
  });

  it('should reject browser tabs and local file commands', function() {
    assert.equal(language.parse('open new tab').validation.status, 'rejected');
    assert.equal(language.parse('open report.pdf').validation.status, 'rejected');
  });

  it('should route a new tab to the named application instead of a browser', function() {
    const command = language.parse('open new tab in notepad');

    assert.equal(command.action, 'new-tab');
    assert.equal(command.targetText, 'notepad');
    assert.equal(command.requestedOperation, 'open-new-tab');
    assert.equal(command.validation.status, 'passed');
  });
});
