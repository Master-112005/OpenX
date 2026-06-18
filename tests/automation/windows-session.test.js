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

  it('should exclude protected title tokens from window matching', function() {
    const controller = new WindowsSessionController({});
    controller.listWindows = () => ([
      { handle: 100, title: 'New Tab - Google Chrome', processName: 'chrome', id: 1 },
      { handle: 200, title: 'Playdate - YouTube', processName: 'chrome', id: 2 }
    ]);
    controller._getForegroundWindowHandle = () => 200;

    const result = controller.findWindow('chrome', {
      preferredProcessNames: ['chrome'],
      excludeTitleTokens: ['youtube']
    });

    assert.equal(result.handle, 100);
    assert.equal(result.title, 'New Tab - Google Chrome');
  });

  it('should require title token matches for targeted browser tabs', function() {
    const controller = new WindowsSessionController({});
    controller.listWindows = () => ([
      { handle: 100, title: 'New Tab - Google Chrome', processName: 'chrome', id: 1 },
      { handle: 200, title: 'Google Photos - Google Chrome', processName: 'chrome', id: 2 }
    ]);
    controller._getForegroundWindowHandle = () => 100;

    const missing = controller.findWindow('google photos', {
      preferredProcessNames: ['chrome'],
      preferredTitleTokens: ['google', 'photos', 'classmates'],
      requireTitleTokenMatch: true
    });
    const found = controller.findWindow('google photos', {
      preferredProcessNames: ['chrome'],
      preferredTitleTokens: ['google', 'photos'],
      requireTitleTokenMatch: true
    });

    assert.equal(missing, null);
    assert.equal(found.handle, 200);
  });

  it('should minimize all windows without requiring a title match', function() {
    const controller = new WindowsSessionController({});
    let script = '';
    controller._runScript = value => {
      script = value;
    };

    const result = controller.minimizeAllWindows();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'minimizeAll');
    assert.match(script, /MinimizeAll/);
  });
});
