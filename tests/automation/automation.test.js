const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Automation Engine', function() {
  let AutomationEngine;

  before(function() {
    AutomationEngine = require('../../core/automation/index');
  });

  it('should register all default actions', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('volume.set'));
    assert.ok(actions.includes('app.open'));
    assert.ok(actions.includes('mode.start'));
    assert.ok(actions.includes('file.create'));
    assert.ok(actions.includes('file.open'));
    assert.ok(actions.includes('file.list'));
    assert.ok(actions.includes('folder.create'));
    assert.ok(actions.includes('folder.move'));
    assert.ok(actions.includes('browser.open'));
    assert.ok(actions.includes('browser.search'));
    assert.ok(actions.includes('browser.closeTab'));
    assert.ok(actions.includes('browser.listTabs'));
    assert.ok(actions.includes('form.fill'));
    assert.ok(actions.includes('message.compose'));
    assert.ok(actions.includes('email.compose'));
    assert.ok(actions.includes('call.start'));
    assert.ok(actions.includes('timer.set'));
    assert.ok(actions.includes('alarm.set'));
    assert.ok(actions.includes('reminder.set'));
    assert.ok(actions.includes('system.status'));
    assert.ok(actions.includes('system.time'));
    assert.ok(actions.includes('system.date'));
    assert.ok(actions.includes('system.calculate'));
    assert.ok(actions.includes('system.screenshot'));
    assert.ok(actions.includes('system.shutdown'));
    assert.ok(actions.includes('window.minimize'));
    assert.ok(actions.includes('help'));
    assert.ok(actions.includes('greeting'));
    assert.ok(actions.includes('thanks'));
  });

  it('should fill extracted form fields from saved personal context', async function() {
    const engine = new AutomationEngine({});
    const result = await engine.execute('form.fill', {
      userFacts: {
        name: 'Rakesh',
        email: 'rakesh@example.com',
        phone: '+919876543210'
      },
      fields: [
        { name: 'Name', required: true },
        { name: 'Gmail', required: true },
        { name: 'Phone Number', required: true }
      ]
    });

    assert.equal(result.success, true);
    assert.equal(result.data.filledData.Name, 'Rakesh');
    assert.equal(result.data.filledData.Gmail, 'rakesh@example.com');
    assert.equal(result.data.filledData['Phone Number'], '+919876543210');
    assert.equal(result.data.skippedFields.length, 0);
    assert.equal(result.data.canSubmit, true);
  });

  it('should fill blank text form templates from saved personal context', async function() {
    const FormAutomation = require('../../core/automation/forms/index');
    const forms = new FormAutomation({});
    const result = await forms.fill({
      userFacts: {
        name: 'Rakesh',
        email: 'rakesh@example.com',
        phone: '+919876543210'
      },
      formText: 'Name:\nGmail:\nPhone Number:'
    });

    assert.equal(result.success, true);
    assert.equal(result.data.filledText, 'Name: Rakesh\nGmail: rakesh@example.com\nPhone Number: +919876543210');
    assert.equal(result.data.filledFields.length, 3);
    assert.equal(result.data.skippedFields.length, 0);
  });

  it('should inspect a Google Form and open a prefilled URL', async function() {
    const FormAutomation = require('../../core/automation/forms/index');
    const opened = [];
    const forms = new FormAutomation({}, {
      browser: {
        open(url) {
          opened.push(url);
          return { success: true, data: { url } };
        }
      }
    });
    forms._resolveUrl = async url => url;
    forms._fetchTextResponse = async url => ({
      finalUrl: url,
      body: '<script>var FB_PUBLIC_LOAD_DATA_ = [null,[null,[[null,"Name",null,0,[[123,null,1]]],[null,"Gmail",null,0,[[456,null,1]]],[null,"Phone Number",null,0,[[789,null,1]]]]]];</script>'
    });

    const result = await forms.fill({
      url: 'https://docs.google.com/forms/d/e/sample/viewform',
      userFacts: {
        name: 'Rakesh',
        email: 'rakesh@example.com',
        phone: '+919876543210'
      }
    });

    assert.equal(result.success, true);
    assert.equal(result.data.mode, 'google-form-prefill');
    assert.equal(result.data.filledFields.length, 3);
    assert.ok(opened[0].includes('usp=pp_url'));
    assert.ok(opened[0].includes('entry.123=Rakesh'));
    assert.ok(opened[0].includes('entry.456=rakesh%40example.com'));
    assert.ok(opened[0].includes('entry.789=%2B919876543210'));
  });

  it('should allow registering custom actions', async function() {
    const engine = new AutomationEngine({});
    engine.registerAction('test.action', () => ({ success: true, data: { value: 42 } }));
    const result = await engine.execute('test.action', {});
    assert.ok(result.success);
    assert.equal(result.data.value, 42);
    assert.equal(result.verification.status, 'unknown');
  });

  it('should return error for unknown action', async function() {
    const engine = new AutomationEngine({});
    const result = await engine.execute('nonexistent.action', {});
    assert.equal(result.success, false);
    assert.equal(result.validation.status, 'unknown');
    assert.equal(result.verification.status, 'unknown');
  });

  it('should start configured app modes', async function() {
    const engine = new AutomationEngine({
      modes: [
        {
          name: 'gaming',
          apps: [
            { name: 'chrome', instructions: ['search for chatgpt'] },
            { name: 'discord', instructions: [] }
          ],
          commands: ['set volume to 45']
        }
      ]
    });
    const opened = [];
    engine.apps.open = async (appName) => {
      opened.push(appName);
      return { success: true, data: { appName } };
    };

    const result = await engine.execute('mode.start', { modeName: 'gaming' });

    assert.equal(result.success, true);
    assert.deepEqual(opened, ['chrome', 'discord']);
    assert.deepEqual(result.data.opened, ['chrome', 'discord']);
    assert.deepEqual(result.data.commands, ['search for chatgpt in chrome', 'set volume to 45']);
  });

  it('should run separate app instructions for a saved mode', async function() {
    const engine = new AutomationEngine({
      modes: [
        {
          name: 'development',
          apps: [
            { name: 'youtube', instructions: ['set volume to 100', 'play liked songs'] },
            { name: 'chrome', instructions: ['open chatgpt'] },
            { name: 'terminal', instructions: [] }
          ]
        }
      ]
    });
    const opened = [];
    engine.apps.open = async (appName) => {
      opened.push(appName);
      return { success: true, data: { appName } };
    };

    const result = await engine.execute('mode.start', { modeName: 'development' });

    assert.equal(result.success, true);
    assert.deepEqual(opened, ['youtube', 'chrome', 'terminal']);
    assert.deepEqual(result.data.commands, [
      'set volume to 100',
      'play liked songs',
      'search for chatgpt in chrome',
      'open first result for chatgpt'
    ]);
  });

  it('should match heavily misspelled development mode names', async function() {
    const engine = new AutomationEngine({
      modes: [
        { name: 'developement', apps: [], commands: ['set volume to 50'] }
      ]
    });

    const result = await engine.execute('mode.start', { modeName: 'deveopemt' });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.commands, ['set volume to 50']);
  });

  it('should allow command-only modes', async function() {
    const engine = new AutomationEngine({
      modes: [
        { name: 'media', apps: [], commands: ['play liked songs'] }
      ]
    });
    const result = await engine.execute('mode.start', { modeName: 'media' });

    assert.equal(result.success, true);
    assert.deepEqual(result.data.opened, []);
    assert.deepEqual(result.data.commands, ['play liked songs']);
  });

  it('should fail clearly when a configured mode is missing', async function() {
    const engine = new AutomationEngine({ modes: [] });
    const result = await engine.execute('mode.start', { modeName: 'gaming' });

    assert.equal(result.success, false);
    assert.match(result.error, /Mode not found/);
  });

  it('should route volume actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('volume.set'));
    assert.ok(actions.includes('volume.mute'));
    assert.ok(actions.includes('volume.unmute'));
  });

  it('should route system actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('system.cpu'));
    assert.ok(actions.includes('system.memory'));
    assert.ok(actions.includes('system.battery'));
    assert.ok(actions.includes('system.disk'));
    assert.ok(actions.includes('system.processes'));
    assert.ok(actions.includes('system.bluetooth'));
    assert.ok(actions.includes('system.time'));
    assert.ok(actions.includes('system.date'));
    assert.ok(actions.includes('system.calculate'));
  });

  it('should execute local calculations', async function() {
    const engine = new AutomationEngine({});
    const result = await engine.execute('system.calculate', { expression: '20*30 + 5' });

    assert.equal(result.success, true);
    assert.equal(result.data.result, 605);
    assert.equal(result.validation.status, 'passed');
  });

  it('should attach validation and verification evidence to file actions', async function() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-verify-'));
    const engine = new AutomationEngine({});

    const result = await engine.execute('file.create', {
      filename: 'verified.txt',
      path: tmpDir
    });

    assert.equal(result.success, true);
    assert.equal(result.validation.status, 'passed');
    assert.equal(result.verification.status, 'passed');
    assert.equal(result.verification.check, 'file-exists');
    assert.equal(fs.existsSync(path.join(tmpDir, 'verified.txt')), true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should execute smart file discovery by type, recency, and size', async function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-smart-find-'));
    const oldFile = path.join(tempDir, 'old-notes.txt');
    const pdfFile = path.join(tempDir, 'resume.pdf');
    const largeFile = path.join(tempDir, 'large.bin');
    fs.writeFileSync(oldFile, 'old', 'utf8');
    fs.writeFileSync(pdfFile, 'resume', 'utf8');
    fs.writeFileSync(largeFile, Buffer.alloc(1024 * 16));
    const oldDate = new Date(Date.now() - 220 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldDate, oldDate);

    const engine = new AutomationEngine({});
    const pdf = await engine.execute('file.smartFind', {
      location: tempDir,
      fileType: 'pdf',
      sortBy: 'modifiedDesc'
    });
    const large = await engine.execute('file.smartFind', {
      location: tempDir,
      sortBy: 'sizeDesc'
    });
    const stale = await engine.execute('file.smartFind', {
      location: tempDir,
      timeFilter: 'olderThan6MonthsAccess',
      sortBy: 'accessedAsc'
    });

    assert.equal(pdf.success, true);
    assert.equal(pdf.data.entries[0].name, 'resume.pdf');
    assert.equal(large.success, true);
    assert.equal(large.data.entries[0].name, 'large.bin');
    assert.equal(stale.success, true);
    assert.equal(stale.data.entries[0].name, 'old-notes.txt');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should fail a successful action result when postcondition verification fails', async function() {
    const engine = new AutomationEngine({});
    engine.registerAction('file.create', () => ({
      success: true,
      data: {
        path: path.join(os.tmpdir(), `missing-${Date.now()}.txt`),
        filename: 'missing.txt'
      }
    }));

    const result = await engine.execute('file.create', {
      filename: 'missing.txt'
    });

    assert.equal(result.success, false);
    assert.equal(result.verification.status, 'failed');
    assert.match(result.error, /Expected file was not found/);
  });

  it('should verify app close results against visible windows', async function() {
    const engine = new AutomationEngine({});
    engine.windows.listWindows = () => [];
    engine.apps._resolveProcessCandidates = () => ['chrome'];
    engine.apps._findRunningProcesses = () => [];

    const result = await engine.verifier.verify('app.close', { appName: 'chrome' }, {
      success: true,
      data: { app: 'chrome', closeMethod: 'window' }
    });

    assert.equal(result.success, true);
    assert.equal(result.verification.status, 'passed');
    assert.equal(result.verification.check, 'app-closed');
  });

  it('should execute expanded local calculation forms', async function() {
    const engine = new AutomationEngine({});
    const cases = [
      ['ehat is teh value of 999+959*9', 9630],
      ['2 to the power of 8', 256],
      ['square root of 144', 12],
      ['25% of 200', 50],
      ['30 percent of 20', 6],
      ['1,000 + 2.5', 1002.5],
      ['absolute value of -15', 15]
    ];

    for (const [expression, expected] of cases) {
      const result = await engine.execute('system.calculate', { expression });
      assert.equal(result.success, true, expression);
      assert.equal(result.data.result, expected, expression);
    }
  });

  it('should execute visible app listing separately from process count', async function() {
    const SystemController = require('../../core/automation/system/index');
    const system = new SystemController({});
    system.getRunningApps = (entities) => ({
      success: true,
      data: {
        target: 'apps',
        count: 2,
        names: ['chrome', 'spotify'],
        queryApp: entities?.queryApp,
        isOpen: entities?.queryApp === 'chrome'
      }
    });

    const engine = new AutomationEngine({});
    engine.system = system;
    engine._actionMap['system.processes'] = (entities) => entities?.target === 'apps'
      ? engine.system.getRunningApps(entities)
      : engine.system.getProcessCount();

    const result = await engine.execute('system.processes', { target: 'apps', queryApp: 'chrome' });

    assert.equal(result.success, true);
    assert.equal(result.data.target, 'apps');
    assert.equal(result.data.count, 2);
    assert.deepEqual(result.data.names, ['chrome', 'spotify']);
    assert.equal(result.data.queryApp, 'chrome');
    assert.equal(result.data.isOpen, true);
  });

  it('should close targeted browser tabs by title query', async function() {
    const engine = new AutomationEngine({});
    let captured = null;
    engine.windows.sendKeys = (windowName, keys, options) => {
      captured = { windowName, keys, options };
      return {
        success: true,
        data: { matchedWindow: 'Google Photos - Google Chrome', matchedHandle: 200 }
      };
    };
    engine.windows.findWindow = () => null;

    const result = await engine.execute('browser.closeTab', {
      browserName: 'chrome',
      tabQuery: 'google photos'
    });

    assert.equal(result.success, true);
    assert.equal(captured.windowName, 'google photos');
    assert.equal(captured.keys, '^w');
    assert.deepEqual(captured.options.preferredProcessNames, ['chrome']);
    assert.deepEqual(captured.options.preferredTitleTokens, ['google', 'photos']);
    assert.equal(captured.options.requireTitleTokenMatch, true);
    assert.equal(result.data.action, 'closeTab');
    assert.equal(result.data.browserName, 'chrome');
    assert.equal(result.data.tabQuery, 'google photos');
    assert.equal(result.data.closedCount, 1);
    assert.equal(result.data.verified, true);
  });

  it('should fail targeted browser tab close without closing a fallback tab', async function() {
    const engine = new AutomationEngine({});
    engine.windows.sendKeys = () => ({ success: false, error: 'Window not found' });

    const result = await engine.execute('browser.closeTab', {
      browserName: 'chrome',
      tabQuery: 'google photos'
    });

    assert.equal(result.success, false);
    assert.match(result.error, /Could not find a google photos tab in chrome/);
  });

  it('should not report targeted browser tab close success when verification fails', async function() {
    const engine = new AutomationEngine({});
    engine._sleep = () => {};
    engine.windows.sendKeys = () => ({
      success: true,
      data: {
        matchedWindow: 'Google Photos - Google Chrome',
        matchedHandle: 200
      }
    });
    engine.windows.findWindow = () => ({
      handle: 200,
      title: 'Google Photos - Google Chrome',
      processName: 'chrome'
    });

    const result = await engine.execute('browser.closeTab', {
      browserName: 'chrome',
      tabQuery: 'google photos'
    });

    assert.equal(result.success, false);
    assert.equal(result.data.verified, false);
    assert.match(result.error, /still appears to be active/);
  });

  it('should list visible browser tabs from browser windows', async function() {
    const engine = new AutomationEngine({});
    engine.windows.listWindows = () => ([
      { handle: 100, title: 'ChatGPT - Google Chrome', processName: 'chrome' },
      { handle: 200, title: 'Google Photos - Google Chrome', processName: 'chrome' },
      { handle: 300, title: 'Inbox - Microsoft Edge', processName: 'msedge' }
    ]);

    const result = await engine.execute('browser.listTabs', { browserName: 'chrome' });

    assert.equal(result.success, true);
    assert.equal(result.data.count, 2);
    assert.deepEqual(result.data.tabs.map(tab => tab.title), ['ChatGPT', 'Google Photos']);
  });

  it('should parse human reminder day phrases', function() {
    const SchedulerController = require('../../core/automation/scheduler/index');
    const scheduler = new SchedulerController({});

    const tomorrow = scheduler._parseTimeExpression('tomorrow 10pm');
    const nextSunday = scheduler._parseTimeExpression('next sunday');

    assert.ok(tomorrow instanceof Date);
    assert.ok(nextSunday instanceof Date);
    assert.ok(tomorrow.getTime() > Date.now());
    assert.ok(nextSunday.getTime() > Date.now());
  });

  it('should route media actions correctly', function() {
    const engine = new AutomationEngine({});
    const actions = engine.getActions();
    assert.ok(actions.includes('media.play'));
    assert.ok(actions.includes('media.next'));
    assert.ok(actions.includes('media.previous'));
    assert.ok(actions.includes('media.pause'));
    assert.ok(actions.includes('media.resume'));
  });
});
