const assert = require('assert');

describe('Windows Session Controller', function() {
  let WindowsSessionController;

  before(function() {
    WindowsSessionController = require('../../core/automation/common/windows-session');
  });

  it('should resolve the best matching window by title', function() {
    const controller = new WindowsSessionController({});
    controller.listWindows = () => ([
      { handle: 100, title: 'Untitled - Notepad', processName: 'notepad', id: 1 },
      { handle: 200, title: 'Playdate - YouTube', processName: 'chrome', id: 2 }
    ]);
    controller._getForegroundWindowHandle = () => 100;

    const result = controller.findWindow('youtube', {
      preferredTitleTokens: ['youtube'],
      preferredProcessNames: ['chrome']
    });

    assert.equal(result.handle, 200);
    assert.equal(result.processName, 'chrome');
  });

  it('should fall back to the active window when no name is provided', function() {
    const controller = new WindowsSessionController({});
    controller.listWindows = () => ([
      { handle: 100, title: 'Untitled - Notepad', processName: 'notepad', id: 1 },
      { handle: 200, title: 'Playdate - YouTube', processName: 'chrome', id: 2 }
    ]);
    controller._getForegroundWindowHandle = () => 100;

    const result = controller.findWindow();

    assert.equal(result.handle, 100);
    assert.equal(result.processName, 'notepad');
  });
});
