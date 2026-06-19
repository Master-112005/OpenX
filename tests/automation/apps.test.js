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
    controller.findVisibleApp = () => null;

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
    controller.findVisibleApp = () => null;

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
    controller.findVisibleApp = () => null;

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
    controller.windowSession.closeWindow = () => ({ success: false, error: 'No matching window' });
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

  it('should not report browser close success while the visible window remains', function() {
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

    assert.equal(result.success, false);
    assert.match(result.error, /Could not close every chrome browser window/);
    assert.equal(forcedTerminationUsed, false);
  });

  it('should close all matching browser windows after confirmation', function() {
    const controller = new AppController({});
    let closeAttempted = false;
    let closed = false;

    controller._getRunningProcessDetails = () => closed ? [] : ([
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
      closed = true;
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');

    assert.equal(result.success, true);
    assert.equal(result.data.closedCount, 2);
    assert.equal(closeAttempted, true);
  });

  it('should focus an existing app instead of asking to open a duplicate', function() {
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
    controller.windowSession.focusWindow = () => ({
      success: true,
      data: { matchedWindow: 'Sample App', processName: 'SampleApp' }
    });

    const result = controller.open('sample app');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'focus-existing');
    assert.equal(result.data.verified, true);
  });

  it('should prefer known command launchers before Start menu entries for known apps', function() {
    const childProcess = require('child_process');
    const fs = require('fs');
    const originalExecFileSync = childProcess.execFileSync;
    const originalExistsSync = fs.existsSync;
    const appsPath = require.resolve('../../core/automation/apps/index');
    const launcherPath = require.resolve('../../core/automation/common/launcher');
    const previousApps = require.cache[appsPath];
    const previousLauncher = require.cache[launcherPath];
    let launchedCommand = '';

    try {
      delete require.cache[appsPath];
      delete require.cache[launcherPath];
      fs.existsSync = (target) => {
        if (String(target).toLowerCase().includes('google\\chrome\\application\\chrome.exe')) {
          return false;
        }
        return originalExistsSync(target);
      };
      childProcess.execFileSync = (command, args) => {
        if (command === 'where.exe') {
          return '';
        }
        const serialized = Array.isArray(args) ? args.join(' ') : '';
        if (command === 'powershell.exe' && serialized.includes("Start-Process -FilePath 'chrome'")) {
          launchedCommand = 'chrome';
          return '';
        }
        if (command === 'powershell.exe' && serialized.includes('Get-StartApps')) {
          return JSON.stringify([{ Name: 'Google Chrome', AppID: 'C:\\Users\\rakes\\AppData\\Chrome' }]);
        }
        return originalExecFileSync(command, args);
      };

      const FreshAppController = require('../../core/automation/apps/index');
      const controller = new FreshAppController({});
      controller._getRunningProcessDetails = () => [];
      let startMenuUsed = false;
      controller._launchStartApp = () => {
        startMenuUsed = true;
      };

      const result = controller.open('chrome');

      assert.equal(result.success, true);
      assert.equal(result.data.launchMethod, 'command');
      assert.equal(launchedCommand, 'chrome');
      assert.equal(startMenuUsed, false);
    } finally {
      childProcess.execFileSync = originalExecFileSync;
      fs.existsSync = originalExistsSync;
      delete require.cache[appsPath];
      delete require.cache[launcherPath];
      if (previousApps) require.cache[appsPath] = previousApps;
      if (previousLauncher) require.cache[launcherPath] = previousLauncher;
    }
  });

  it('should close WhatsApp by visible window before process fallback', function() {
    const controller = new AppController({});
    let windowCloseAttempted = false;
    let processCloseAttempted = false;

    controller._closeAppWindow = (name) => {
      windowCloseAttempted = name === 'whatsapp';
      return { success: true, data: { app: name, closeMethod: 'window' } };
    };
    controller._closeProcessesGracefully = () => {
      processCloseAttempted = true;
      return true;
    };

    const result = controller.close('whatsapp');

    assert.equal(result.success, true);
    assert.equal(result.data.closeMethod, 'window');
    assert.equal(windowCloseAttempted, true);
    assert.equal(processCloseAttempted, false);
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

  it('should not treat a YouTube Chrome PWA as an open Chrome browser', function() {
    const controller = new AppController({});
    let fallbackOptions = null;

    controller._getRunningProcessDetails = () => ([{
      Id: 901,
      ProcessName: 'chrome',
      MainWindowTitle: 'Music - YouTube',
      MainWindowHandle: 456,
      Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    }]);
    controller.windowSession.findWindow = (_query, options) => {
      fallbackOptions = options;
      return null;
    };

    assert.equal(controller.findVisibleApp('google chrome'), null);
    assert.equal(fallbackOptions.requireTitleTokenMatch, true);
    assert.deepEqual(fallbackOptions.preferredTitleTokens, ['chrome']);
  });

  it('should resolve and launch installed Store apps such as Instagram', function() {
    const controller = new AppController({});
    let launched = null;

    controller.findVisibleApp = () => null;
    controller._launchSpecialApp = () => ({ success: false });
    controller._resolveStartApp = name => {
      assert.equal(name, 'instagram');
      return { name: 'Instagram', appId: 'Facebook.InstagramBeta_8xx8rvfyw5nnt!App' };
    };
    controller._launchStartApp = startApp => {
      launched = startApp;
    };

    const result = controller.open('instgram');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'start-menu');
    assert.equal(launched.name, 'Instagram');
  });

  it('should never force terminate shared Windows host processes', function() {
    const controller = new AppController({});
    const terminated = controller._forceTerminateProcesses([{
      Id: 400,
      ProcessName: 'ApplicationFrameHost',
      MainWindowTitle: 'Instagram'
    }]);

    assert.equal(terminated, false);
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
    assert.equal(fallbackOptions.requireTitleTokenMatch, true);
    assert.deepEqual(fallbackOptions.preferredTitleTokens, ['chrome']);
  });

  it('should treat a regular YouTube tab as part of Chrome, not as a PWA', function() {
    const controller = new AppController({});
    controller._getRunningProcessDetails = () => ([{
      Id: 902,
      ProcessName: 'chrome',
      MainWindowTitle: 'YouTube - Google Chrome',
      MainWindowHandle: 457,
      Path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    }]);

    const target = controller.findVisibleApp('chrome', { allowWindowFallback: false });
    assert.equal(target.Id, 902);
  });
});
