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

  it('should escalate from graceful close to forced termination when the process stays alive', function() {
    const controller = new AppController({});
    let state = 'running';

    controller._resolveStartApp = () => null;
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
    controller._closeProcessesGracefully = () => true;
    controller._forceTerminateProcesses = () => {
      state = 'closed';
      return true;
    };
    controller._sleep = () => {};

    const result = controller.close('chrome');
    assert.equal(result.success, true);
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
});
