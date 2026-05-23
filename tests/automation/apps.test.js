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
});
