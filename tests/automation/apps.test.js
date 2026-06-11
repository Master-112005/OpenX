const assert = require('assert');

describe('App Controller', function() {
  let AppController;

  before(function() {
    AppController = require('../../core/automation/apps/index');
  });

  it('should match packaged WhatsApp process names when closing apps', function() {
    const controller = new AppController({});
    const processes = [
      {
        ProcessName: 'WhatsApp.Root',
        MainWindowTitle: 'WhatsApp',
        Path: 'C:\\Program Files\\WindowsApps\\5319275A.WhatsAppDesktop_2.2616.100.0_x64__cv1g1gvanyjgm\\WhatsApp.exe'
      },
      {
        ProcessName: 'chrome',
        MainWindowTitle: 'Google Chrome',
        Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      }
    ];

    controller._getRunningProcessDetails = () => processes;
    const resolvedMatches = controller._findRunningProcesses('whatsapp', ['WhatsApp', 'whatsapp']);
    assert.equal(resolvedMatches.length, 1);
    assert.equal(resolvedMatches[0].ProcessName, 'WhatsApp.Root');
  });

  it('should prefer Start menu apps over command fallback when opening apps', function() {
    const controller = new AppController({});
    let launched = null;

    controller._resolveStartApp = (name) => {
      assert.equal(name, 'discord');
      return { name: 'Discord', appId: 'Discord.Discord' };
    };
    controller._launchStartApp = (startApp) => {
      launched = startApp;
    };
    controller._commandExists = () => {
      throw new Error('command fallback should not be checked when Start menu resolves');
    };

    const result = controller.open('discord');

    assert.equal(result.success, true);
    assert.equal(launched.appId, 'Discord.Discord');
  });

  it('should open special Windows shell apps', function() {
    const controller = new AppController({});
    let launched = null;

    controller._resolveStartApp = () => null;
    controller._launchSpecialApp = (name) => {
      launched = name;
      return { success: true, data: { app: name, launchMethod: 'special' } };
    };

    const result = controller.open('recycle bin');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'special');
    assert.equal(launched, 'recycle bin');
  });

  it('should fail clearly when an app cannot be found', function() {
    const controller = new AppController({});

    controller._resolveStartApp = () => null;
    controller._launchSpecialApp = () => ({ success: false });
    controller._commandExists = () => false;

    const result = controller.open('missing app');

    assert.equal(result.success, false);
    assert.equal(result.error, 'Could not find app: missing app');
  });

  it('should escalate from graceful close to forced termination when a non-browser process stays alive', function() {
    const controller = new AppController({});
    let state = 'running';

    controller._resolveStartApp = () => null;
    controller._getRunningProcessDetails = () => (
      state === 'closed'
        ? []
        : [{
            Id: 42,
            ProcessName: 'notepad',
            MainWindowTitle: 'Untitled - Notepad',
            MainWindowHandle: 123,
            Path: 'C:\\Windows\\System32\\notepad.exe'
          }]
    );
    controller._closeProcessesGracefully = () => true;
    controller._forceTerminateProcesses = () => {
      state = 'closed';
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('notepad');
    assert.equal(result.success, true);
  });

  it('should not query Start menu metadata when closing known apps', function() {
    const controller = new AppController({});
    let startMenuQueried = false;
    let state = 'running';

    controller._resolveStartApp = () => {
      startMenuQueried = true;
      return null;
    };
    controller._getRunningProcessDetails = () => (
      state === 'closed'
        ? []
        : [{
            Id: 42,
            ProcessName: 'chrome',
            MainWindowTitle: 'Google Chrome',
            Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          }]
    );
    controller._closeProcessesGracefully = () => {
      state = 'closed';
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, true);
    assert.equal(startMenuQueried, false);
  });

  it('should not close unrelated apps from broad Start menu publisher tokens', function() {
    const controller = new AppController({});
    const processes = [
      {
        Id: 100,
        ProcessName: 'Code',
        MainWindowTitle: 'Visual Studio Code',
        Path: 'C:\\Users\\user\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'
      },
      {
        Id: 101,
        ProcessName: 'notepad',
        MainWindowTitle: 'Untitled - Notepad',
        Path: 'C:\\Windows\\System32\\notepad.exe'
      }
    ];

    controller._getRunningProcessDetails = () => processes;

    const matches = controller._findRunningProcesses('notepad', [
      'notepad',
      'Microsoft',
      'WindowsNotepad'
    ]);

    assert.equal(matches.length, 1);
    assert.equal(matches[0].ProcessName, 'notepad');
  });

  it('should close browser-hosted apps by window title when process matching is not usable', function() {
    const controller = new AppController({});

    controller.windowSession.closeWindow = (windowQuery, options) => {
      assert.equal(windowQuery, 'youtube');
      assert.ok(options.preferredTitleTokens.includes('youtube'));
      return {
        success: true,
        data: {
          matchedWindow: 'Playdate - YouTube',
          processName: 'chrome'
        }
      };
    };
    controller._getRunningProcessDetails = () => [];

    const result = controller.close('youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.closeMethod, 'window');
    assert.equal(result.data.processName, 'chrome');
  });

  it('should not close YouTube app windows when closing Chrome', function() {
    const controller = new AppController({});
    let normalChromeClosed = false;
    let forcedTerminationUsed = false;

    controller._getRunningProcessDetails = () => {
      const processes = [
        {
          Id: 101,
          ProcessName: 'chrome',
          MainWindowTitle: 'Music - YouTube',
          MainWindowHandle: 456,
          Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        }
      ];

      if (!normalChromeClosed) {
        processes.push({
          Id: 100,
          ProcessName: 'chrome',
          MainWindowTitle: 'Google Chrome',
          MainWindowHandle: 123,
          Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        });
      }

      return processes;
    };
    controller._closeProcessesGracefully = (processes) => {
      assert.equal(processes.length, 1);
      assert.equal(processes[0].Id, 100);
      normalChromeClosed = true;
      return true;
    };
    controller._forceTerminateProcesses = () => {
      forcedTerminationUsed = true;
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, true);
    assert.equal(forcedTerminationUsed, false);
  });

  it('should not force terminate browser child processes after visible windows close', function() {
    const controller = new AppController({});
    let visibleWindowClosed = false;
    let forcedTerminationUsed = false;

    controller._getRunningProcessDetails = () => {
      const processes = [
        {
          Id: 201,
          ProcessName: 'chrome',
          MainWindowTitle: '',
          MainWindowHandle: 0,
          Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        }
      ];

      if (!visibleWindowClosed) {
        processes.push({
          Id: 200,
          ProcessName: 'chrome',
          MainWindowTitle: 'Google Chrome',
          MainWindowHandle: 789,
          Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        });
      }

      return processes;
    };
    controller._closeProcessesGracefully = (processes) => {
      assert.equal(processes.length, 1);
      assert.equal(processes[0].Id, 200);
      visibleWindowClosed = true;
      return true;
    };
    controller._forceTerminateProcesses = () => {
      forcedTerminationUsed = true;
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, true);
    assert.equal(forcedTerminationUsed, false);
  });

  it('should report browser close success after sending a visible-window close request', function() {
    const controller = new AppController({});
    let forcedTerminationUsed = false;

    controller._getRunningProcessDetails = () => ([
      {
        Id: 200,
        ProcessName: 'chrome',
        MainWindowTitle: 'New Tab - Google Chrome',
        MainWindowHandle: 789,
        Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      }
    ]);
    controller._closeProcessesGracefully = (processes) => {
      assert.equal(processes.length, 1);
      assert.equal(processes[0].Id, 200);
      return true;
    };
    controller._forceTerminateProcesses = () => {
      forcedTerminationUsed = true;
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, true);
    assert.equal(result.data.closeMethod, 'window');
    assert.equal(forcedTerminationUsed, false);
  });

  it('should ask before closing when multiple matching app windows are open', function() {
    const controller = new AppController({});
    let closeAttempted = false;

    controller._getRunningProcessDetails = () => ([
      {
        Id: 200,
        ProcessName: 'chrome',
        MainWindowTitle: 'Project A - Google Chrome',
        MainWindowHandle: 789,
        Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      },
      {
        Id: 201,
        ProcessName: 'chrome',
        MainWindowTitle: 'Project B - Google Chrome',
        MainWindowHandle: 790,
        Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      }
    ]);
    controller._closeProcessesGracefully = () => {
      closeAttempted = true;
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, false);
    assert.equal(result.needsClarification, true);
    assert.equal(result.data.matchCount, 2);
    assert.equal(closeAttempted, false);
  });

  it('should ask before opening another window when the app is already open', function() {
    const controller = new AppController({});

    controller._getRunningProcessDetails = () => ([{
      Id: 300,
      ProcessName: 'SampleApp',
      MainWindowTitle: 'Sample App',
      MainWindowHandle: 123,
      Path: 'C:\\Program Files\\SampleApp\\SampleApp.exe'
    }]);
    controller._launchSpecialApp = () => ({ success: false });
    controller._resolveStartApp = () => null;
    controller._commandExists = () => true;
    controller._sleep = () => {};

    const result = controller.open('sample app');

    assert.equal(result.success, false);
    assert.equal(result.needsClarification, true);
    assert.equal(result.data.confirmEntities.forceNewWindow, true);
  });

  it('should open when the user confirms a new app window', function() {
    const controller = new AppController({});
    let launched = null;

    controller._getRunningProcessDetails = () => ([{
      Id: 300,
      ProcessName: 'SampleApp',
      MainWindowTitle: 'Sample App',
      MainWindowHandle: 123,
      Path: 'C:\\Program Files\\SampleApp\\SampleApp.exe'
    }]);
    controller._launchSpecialApp = () => ({ success: false });
    controller._resolveStartApp = () => ({ name: 'Sample App', appId: 'Sample.App' });
    controller._launchStartApp = (startApp) => {
      launched = startApp;
    };

    const result = controller.open('sample app', { forceNewWindow: true });

    assert.equal(result.success, true);
    assert.equal(launched.appId, 'Sample.App');
  });

  it('should exclude YouTube windows from Chrome window fallback', function() {
    const controller = new AppController({});
    let fallbackOptions = null;

    controller._getRunningProcessDetails = () => [];
    controller.windowSession.closeWindow = (windowQuery, options) => {
      fallbackOptions = options;
      assert.equal(windowQuery, 'chrome');
      return { success: false, error: 'Window not found: chrome' };
    };

    const result = controller.close('chrome');

    assert.equal(result.success, false);
    assert.ok(fallbackOptions.excludeTitleTokens.includes('youtube'));
  });
});
