const { execFileSync, execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;
const { launchTarget } = require('../common/launcher');
const WindowsSessionController = require('../common/windows-session');

const KNOWN_APPS = {
  'code': { path: null, cmd: 'code', processName: 'Code' },
  'chrome': {
    path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cmd: 'chrome',
    closeStrategy: 'window',
    windowQuery: 'chrome',
    preferredTitleTokens: ['chrome', 'new tab', '- google chrome'],
    preferredProcessNames: ['chrome', 'ApplicationFrameHost']
  },
  'msedge': { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', cmd: 'msedge' },
  'edge': { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', cmd: 'msedge' },
  'firefox': { path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', cmd: 'firefox' },
  'notepad': { path: 'C:\\Windows\\System32\\notepad.exe', cmd: 'notepad' },
  'calc': { path: 'C:\\Windows\\System32\\calc.exe', cmd: 'calc' },
  'mspaint': { path: 'C:\\Windows\\System32\\mspaint.exe', cmd: 'mspaint' },
  'cmd': { path: 'C:\\Windows\\System32\\cmd.exe', cmd: 'cmd' },
  'powershell': { path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', cmd: 'powershell' },
  'explorer': { path: 'C:\\Windows\\explorer.exe', cmd: 'explorer' },
  'taskmgr': { path: 'C:\\Windows\\System32\\Taskmgr.exe', cmd: 'taskmgr' },
  'control': { path: 'C:\\Windows\\System32\\control.exe', cmd: 'control' },
  'snippingtool': { path: 'C:\\Windows\\System32\\SnippingTool.exe', cmd: 'SnippingTool' },
  'winword': { cmd: 'winword' },
  'excel': { cmd: 'excel' },
  'powerpoint': { cmd: 'powerpnt', processName: 'POWERPNT' },
  'outlook': { cmd: 'outlook' },
  'spotify': { cmd: 'spotify' },
  'discord': { cmd: 'discord', processName: 'Discord' },
  'whatsapp': {
    processName: 'WhatsApp',
    closeStrategy: 'window',
    windowQuery: 'whatsapp',
    preferredTitleTokens: ['whatsapp'],
    preferredProcessNames: ['WhatsApp', 'ApplicationFrameHost']
  },
  'slack': { cmd: 'slack' },
  'zoom': { cmd: 'zoom' },
  'teams': { cmd: 'teams', processName: 'Teams' },
  'apple music': { processName: 'AppleMusic' },
  'apple tv': { processName: 'AppleTV' },
  'calendar': { processName: 'HxCalendarAppImm' },
  'clock': { processName: 'WindowsAlarms' },
  'youtube': {
    closeStrategy: 'window',
    windowQuery: 'youtube',
    preferredProcessNames: ['chrome', 'msedge', 'firefox'],
    preferredTitleTokens: ['youtube']
  },
  'antigravity': { processName: 'Antigravity IDE' }
};

const SPECIAL_LAUNCHERS = {
  'ms-settings': { target: 'ms-settings:' },
  'ms-settings:': { target: 'ms-settings:' },
  'windows settings': { target: 'ms-settings:' },
  'system settings': { target: 'ms-settings:' },
  'recycle bin': { target: 'C:\\Windows\\explorer.exe', args: ['shell:RecycleBinFolder'] },
  'microsoft store': { target: 'ms-windows-store:' },
  'photos': { target: 'ms-photos:' },
  'google chat': { target: 'https://chat.google.com' },
  'youtube': { target: 'https://www.youtube.com' }
};

const BROWSER_APP_NAMES = new Set(['chrome', 'msedge', 'edge', 'firefox']);
const COMMAND_FIRST_APPS = new Set(['chrome', 'msedge', 'edge', 'firefox']);

const APP_ALIASES = new Map([
  ['google chrome', 'chrome'],
  ['chrome browser', 'chrome'],
  ['microsoft edge', 'edge'],
  ['edge browser', 'edge'],
  ['mozilla firefox', 'firefox'],
  ['firefox browser', 'firefox'],
  ['visual studio code', 'code'],
  ['vs code', 'code'],
  ['vscode', 'code'],
  ['calculator', 'calc'],
  ['paint', 'mspaint'],
  ['instagram app', 'instagram'],
  ['instgram', 'instagram']
]);

const PROTECTED_HOST_PROCESSES = new Set([
  'applicationframehost',
  'dwm',
  'explorer',
  'shellexperiencehost',
  'startmenuexperiencehost'
]);

class AppController {
  constructor(config) {
    this.config = config || {};
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.windowSession = new WindowsSessionController(config);
    this._startAppsCache = null;
    this._startAppsCacheExpiresAt = 0;
  }

  open(appName, options = {}) {
    if (!appName) {
      return { success: false, error: 'No application name provided' };
    }

    const name = this._normalizeAppName(appName);
    const app = KNOWN_APPS[name];

    try {
      if (!options.forceNewWindow && !options.skipAlreadyOpenCheck) {
        const existingTarget = this.findVisibleApp(name, { allowWindowFallback: false });
        if (existingTarget) {
          const focused = this._focusExistingApp(name, existingTarget);
          if (focused) {
            return focused;
          }
        }
      }

      if (app && app.path) {
        if (require('fs').existsSync(app.path)) {
          launchTarget(app.path);
          return {
            success: true,
            data: { app: name, launchMethod: 'executable', target: app.path }
          };
        }
      }

      const specialLaunch = this._launchSpecialApp(name);
      if (specialLaunch.success) {
        return specialLaunch;
      }

      if (COMMAND_FIRST_APPS.has(name) && app?.cmd && this._commandExists(app.cmd)) {
        launchTarget(app.cmd);
        return { success: true, data: { app: name, launchMethod: 'command' } };
      }

      const startApp = this._resolveStartApp(name);
      if (startApp) {
        this._launchStartApp(startApp);
        return {
          success: true,
          data: {
            app: name,
            resolvedName: startApp.name,
            appId: startApp.appId,
            launchMethod: 'start-menu'
          }
        };
      }

      if (app?.cmd && this._commandExists(app.cmd)) {
        launchTarget(app.cmd);
        return { success: true, data: { app: name, launchMethod: 'command' } };
      }

      return { success: false, error: `Could not find app: ${name}` };
    } catch (err) {
      this.logger.error(`Failed to open app: ${name}`, err);
      return { success: false, error: `Could not find or open: ${name}` };
    }
  }

  close(appName, options = {}) {
    if (!appName) {
      return { success: false, error: 'No application name provided' };
    }

    const name = this._normalizeAppName(appName);
    const app = KNOWN_APPS[name];
    try {
      const selectedClose = this._closeSelectedProcess(name, options);
      if (selectedClose) {
        return selectedClose;
      }

      const browserClose = this._isBrowserAppName(name);
      if (app?.closeStrategy === 'window' && !browserClose) {
        const windowClose = this._closeAppWindow(name, app);
        if (windowClose.success) {
          return windowClose;
        }
      }

      const processNames = this._resolveProcessCandidates(name);
      let runningProcesses = this._filterCloseTargets(
        name,
        this._findRunningProcesses(name, processNames)
      );

      if (runningProcesses.length > 0) {
        const requestedCloseCount = runningProcesses.length;
        this._closeProcessesGracefully(runningProcesses);
        this._sleep(900);
        runningProcesses = this._filterCloseTargets(
          name,
          this._findRunningProcesses(name, processNames)
        );

        if (browserClose) {
          if (runningProcesses.length > 0 && this.waitForAppClosed(name, {
            attempts: 3,
            intervalMs: 300
          })) {
            runningProcesses = [];
          }
          if (runningProcesses.length === 0) {
            return {
              success: true,
              data: {
                app: name,
                closedCount: requestedCloseCount,
                closeMethod: 'window'
              }
            };
          }
          return { success: false, error: `Could not close every ${name} browser window` };
        }

        if (!browserClose && runningProcesses.length > 0) {
          this._forceTerminateProcesses(runningProcesses);
          this._sleep(700);
          runningProcesses = this._filterCloseTargets(
            name,
            this._findRunningProcesses(name, processNames)
          );
        }

        if (runningProcesses.length === 0) {
          return {
            success: true,
            data: {
              app: name,
              closedCount: processNames.length,
              closeMethod: 'process'
            }
          };
        }
      }

      const windowClose = this._closeAppWindow(name, app, {
        requireBrowserIdentity: browserClose
      });
      if (windowClose.success) {
        return windowClose;
      }

      return { success: false, error: `Could not close: ${name}` };
    } catch (err) {
      return { success: false, error: `Could not close: ${name}` };
    }
  }

  _closeAppWindow(name, app = KNOWN_APPS[name], options = {}) {
    const windowQuery = app?.windowQuery || name;
    const matchOptions = this._windowMatchOptions(name, app);

    const closeResult = this.windowSession.closeWindow(windowQuery, {
      ...matchOptions,
      requireTitleTokenMatch: Boolean(options.requireBrowserIdentity) || matchOptions.requireTitleTokenMatch
    });

    if (!closeResult.success) {
      return { success: false, error: closeResult.error };
    }

    return {
      success: true,
      data: {
        app: name,
        closeMethod: 'window',
        matchedWindow: closeResult.data?.matchedWindow || null,
        processName: closeResult.data?.processName || null
      }
    };
  }

  _getStartApps() {
    const now = Date.now();
    if (this._startAppsCache && now < this._startAppsCacheExpiresAt) {
      return this._startAppsCache;
    }

    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress'
      ], {
        encoding: 'utf8',
        timeout: 15000
      });

      const parsed = JSON.parse(output || '[]');
      const apps = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      this._startAppsCache = apps
        .filter(candidate => candidate && candidate.Name && candidate.AppID)
        .map(candidate => ({
          name: String(candidate.Name).trim(),
          appId: String(candidate.AppID).trim(),
          normalizedName: Normalizer.normalizeText(candidate.Name)
        }));
      this._startAppsCacheExpiresAt = now + 60_000;
      return this._startAppsCache;
    } catch (err) {
      this.logger.warn('Failed to load Start menu apps', err.message);
      this._startAppsCache = [];
      this._startAppsCacheExpiresAt = now + 15_000;
      return this._startAppsCache;
    }
  }

  _resolveStartApp(name) {
    const normalizedName = Normalizer.normalizeText(name);
    if (!normalizedName) return null;

    const apps = this._getStartApps();
    const exact = apps.find(candidate => candidate.normalizedName === normalizedName);
    if (exact) {
      return exact;
    }

    const containsMatch = apps.find(candidate => candidate.normalizedName.includes(normalizedName));
    if (containsMatch) {
      return containsMatch;
    }

    const closest = Normalizer.findClosestOption(
      normalizedName,
      apps.map(candidate => candidate.name),
      { minSimilarity: 0.58, maxDistance: 4 }
    );

    if (!closest) {
      return null;
    }

    return apps.find(candidate => candidate.normalizedName === closest.normalizedMatch) || null;
  }

  _launchStartApp(startApp) {
    const appId = startApp.appId;
    if (!appId) {
      throw new Error('Missing Start menu app identifier');
    }

    if (/^[A-Za-z]:\\/.test(appId) || /\\[^\\]+\.exe$/i.test(appId)) {
      launchTarget(appId);
      return;
    }

    launchTarget('C:\\Windows\\explorer.exe', [`shell:AppsFolder\\${appId}`]);
  }

  _launchSpecialApp(name) {
    if (/^ms-settings:/i.test(String(name || ''))) {
      launchTarget(name);
      return {
        success: true,
        data: {
          app: name,
          launchMethod: 'settings-protocol',
          target: name
        }
      };
    }

    const launcher = SPECIAL_LAUNCHERS[name];
    if (!launcher) {
      return { success: false };
    }

    try {
      launchTarget(launcher.target, launcher.args || []);
      return {
        success: true,
        data: {
          app: name,
          launchMethod: 'special',
          target: launcher.target
        }
      };
    } catch (err) {
      this.logger.error(`Failed to launch special app: ${name}`, err);
      return { success: false, error: `Could not open: ${name}` };
    }
  }

  _commandExists(command) {
    const safeCommand = String(command || '').trim();
    if (!safeCommand) {
      return false;
    }

    try {
      execFileSync('where.exe', [safeCommand], {
        timeout: 3000,
        stdio: 'ignore'
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  _resolveProcessCandidates(name) {
    name = this._normalizeAppName(name);
    const candidates = new Set();
    const app = KNOWN_APPS[name];

    if (app?.processName) {
      candidates.add(app.processName);
    }
    if (app?.cmd) {
      candidates.add(app.cmd);
    }
    candidates.add(name);

    const needsStartMenuResolution = !app?.processName && !app?.cmd && !app?.path && !app?.closeStrategy;
    const startApp = needsStartMenuResolution ? this._resolveStartApp(name) : null;
    if (startApp?.name) {
      candidates.add(startApp.name);
    }
    if (startApp?.appId) {
      const tokens = startApp.appId.split(/[\\.!]/).filter(Boolean);
      const tail = tokens[tokens.length - 1];
      if (tail && !['app', 'application'].includes(tail.toLowerCase())) {
        candidates.add(tail);
      }

      const exeMatch = startApp.appId.match(/([^\\]+)\.exe$/i);
      if (exeMatch && exeMatch[1]) {
        candidates.add(exeMatch[1]);
      }
    }

    return Array.from(candidates);
  }

  _findRunningProcesses(name, processCandidates = []) {
    name = this._normalizeAppName(name);
    const processes = this._getRunningProcessDetails();
    if (!Array.isArray(processes) || processes.length === 0) {
      return [];
    }

    const searchTerms = new Set(
      [name, ...processCandidates]
        .map(candidate => String(candidate || '').trim().toLowerCase())
        .filter(candidate => candidate && !['app', 'application'].includes(candidate))
    );

    const rankedMatches = processes.map(process => {
      const processName = String(process.ProcessName || '').toLowerCase();
      const windowTitle = String(process.MainWindowTitle || '').toLowerCase();
      const processPath = String(process.Path || '').toLowerCase();
      const processBaseName = processPath
        ? processPath.split(/[\\/]/).pop().replace(/\.exe$/i, '')
        : '';
      let score = 0;

      Array.from(searchTerms).forEach(term => {
        if (processName === term) score += 160;
        else if (processName.startsWith(`${term}.`)) score += 135;
        else if (processName.includes(term) && term.length >= 4) score += 90;

        if (windowTitle === term) score += 120;
        else if (windowTitle.includes(term)) score += 70;

        if (processBaseName === term) score += 120;
        else if (processBaseName.includes(term) && term.length >= 4) score += 90;
      });

      return { process, score };
    });

    return rankedMatches
      .filter(item => item.score >= 100)
      .sort((left, right) => right.score - left.score)
      .map(item => item.process);
  }

  _filterCloseTargets(name, processes) {
    if (!this._isBrowserAppName(name)) {
      return processes;
    }

    return processes.filter(process => {
      const windowTitle = String(process?.MainWindowTitle || '').trim().toLowerCase();
      const mainWindowHandle = Number(process?.MainWindowHandle || 0);
      const browserIdentity = name === 'firefox'
        ? 'firefox'
        : (name === 'edge' || name === 'msedge' ? 'edge' : 'chrome');
      return (mainWindowHandle !== 0 || windowTitle.length > 0) &&
        windowTitle.includes(browserIdentity);
    });
  }

  _buildCloseAmbiguity(name, processes) {
    const visibleTargets = this._visibleCloseTargets(processes);
    if (visibleTargets.length <= 1) {
      return null;
    }

    const choices = visibleTargets.slice(0, 8).map((process, index) => ({
      index: index + 1,
      id: Number(process?.Id) || null,
      title: String(process?.MainWindowTitle || '').trim() || String(process?.ProcessName || name),
      processName: String(process?.ProcessName || '').trim()
    }));

    return {
      success: false,
      needsClarification: true,
      error: this._buildAmbiguousCloseMessage(name, choices),
      data: {
        app: name,
        matchCount: visibleTargets.length,
        choices
      }
    };
  }

  _closeSelectedProcess(name, options = {}) {
    const processId = Number(options.processId || options.targetProcessId);
    const title = String(options.windowTitle || options.targetWindowTitle || '').trim().toLowerCase();
    if ((!Number.isFinite(processId) || processId <= 0) && !title) {
      return null;
    }

    const processNames = this._resolveProcessCandidates(name);
    const candidates = this._filterCloseTargets(
      name,
      this._findRunningProcesses(name, processNames)
    );
    const target = candidates.find(process => {
      if (Number.isFinite(processId) && processId > 0 && Number(process?.Id) === processId) {
        return true;
      }
      return title && String(process?.MainWindowTitle || '').trim().toLowerCase().includes(title);
    });

    if (!target) {
      return { success: false, error: `Could not find the selected ${name} window` };
    }

    this._closeProcessesGracefully([target]);
    this._sleep(900);

    const stillRunning = this._findRunningProcesses(name, processNames)
      .some(process => Number(process?.Id) === Number(target.Id));
    if (stillRunning && !this._isBrowserAppName(name)) {
      this._forceTerminateProcesses([target]);
      this._sleep(700);
    }

    return {
      success: true,
      data: {
        app: name,
        closedCount: 1,
        closeMethod: 'window',
        matchedWindow: String(target.MainWindowTitle || '').trim() || null,
        processName: String(target.ProcessName || '').trim() || null
      }
    };
  }

  _visibleCloseTargets(processes) {
    const unique = new Map();
    (Array.isArray(processes) ? processes : []).forEach(process => {
      const id = Number(process?.Id);
      const title = String(process?.MainWindowTitle || '').trim();
      const handle = Number(process?.MainWindowHandle || 0);
      if (!title && handle === 0) {
        return;
      }
      const key = Number.isFinite(id) && id > 0 ? `id:${id}` : `${process?.ProcessName || ''}:${title}`;
      if (!unique.has(key)) {
        unique.set(key, process);
      }
    });
    return Array.from(unique.values());
  }

  _buildAmbiguousCloseMessage(name, choices) {
    const labels = choices.map(choice => `${choice.index}. ${choice.title}`).join('; ');
    return `Multiple ${name} windows are open. Please say which one to close: ${labels}`;
  }

  _buildAlreadyOpenClarification(name) {
    name = this._normalizeAppName(name);
    const app = KNOWN_APPS[name];
    const processNames = this._resolveProcessCandidates(name);
    const visibleTargets = this._visibleCloseTargets(
      this._filterCloseTargets(name, this._findRunningProcesses(name, processNames))
    );

    if (visibleTargets.length === 0 && app?.closeStrategy === 'window') {
      const existingWindow = this.windowSession.findWindow(app.windowQuery || name, {
        ...this._windowMatchOptions(name, app)
      });
      if (existingWindow) {
        visibleTargets.push({
          Id: existingWindow.id,
          ProcessName: existingWindow.processName,
          MainWindowTitle: existingWindow.title,
          MainWindowHandle: existingWindow.handle
        });
      }
    }

    if (visibleTargets.length === 0) {
      return null;
    }

    const choices = visibleTargets.slice(0, 4).map((process, index) => ({
      index: index + 1,
      id: Number(process?.Id) || null,
      title: String(process?.MainWindowTitle || '').trim() || String(process?.ProcessName || name),
      processName: String(process?.ProcessName || '').trim()
    }));

    return {
      success: false,
      needsClarification: true,
      error: `${name} is already open. Do you want me to open another window?`,
      data: {
        clarificationType: 'app.open.alreadyOpen',
        app: name,
        matchCount: visibleTargets.length,
        choices,
        confirmEntities: { forceNewWindow: true, skipAlreadyOpenCheck: true }
      }
    };
  }

  _isBrowserAppName(name) {
    return BROWSER_APP_NAMES.has(this._normalizeAppName(name));
  }

  _normalizeAppName(appName) {
    const normalized = Normalizer.normalizeText(appName);
    return APP_ALIASES.get(normalized) || normalized;
  }

  _windowMatchOptions(name, app = KNOWN_APPS[name]) {
    const browserApp = this._isBrowserAppName(name);
    return {
      preferredTitleTokens: browserApp
        ? [name === 'msedge' ? 'edge' : name]
        : (app?.preferredTitleTokens || [name]),
      preferredProcessNames: app?.preferredProcessNames || [app?.processName, app?.cmd]
        .filter(Boolean),
      excludeTitleTokens: [],
      requireTitleTokenMatch: browserApp
    };
  }

  findVisibleApp(appName, options = {}) {
    const name = this._normalizeAppName(appName);
    if (!name) return null;
    const processNames = this._resolveProcessCandidates(name);
    const processTarget = this._visibleCloseTargets(
      this._filterCloseTargets(name, this._findRunningProcesses(name, processNames))
    )[0];
    if (processTarget) {
      return processTarget;
    }

    if (options.allowWindowFallback === false) return null;

    const app = KNOWN_APPS[name];
    const windowTarget = this.windowSession.findWindow(app?.windowQuery || name, {
      ...this._windowMatchOptions(name, app)
    });
    if (!windowTarget) return null;
    return {
      Id: windowTarget.id,
      ProcessName: windowTarget.processName,
      MainWindowTitle: windowTarget.title,
      MainWindowHandle: windowTarget.handle
    };
  }

  waitForVisibleApp(appName, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 4);
    const intervalMs = Math.max(0, Number(options.intervalMs) || 300);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const target = this.findVisibleApp(appName, {
        allowWindowFallback: attempt === attempts - 1
      });
      if (target) return target;
      if (attempt < attempts - 1) this._sleep(intervalMs);
    }
    return null;
  }

  waitForAppClosed(appName, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 4);
    const intervalMs = Math.max(0, Number(options.intervalMs) || 250);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!this.findVisibleApp(appName)) return true;
      if (attempt < attempts - 1) this._sleep(intervalMs);
    }
    return false;
  }

  _focusExistingApp(name, target) {
    const app = KNOWN_APPS[name];
    const title = String(target?.MainWindowTitle || '').trim();
    const focusResult = this.windowSession.focusWindow(title || app?.windowQuery || name, {
      ...this._windowMatchOptions(name, app)
    });
    if (!focusResult.success) return null;
    return {
      success: true,
      data: {
        app: name,
        launchMethod: 'focus-existing',
        matchedWindow: focusResult.data?.matchedWindow || title || null,
        processName: focusResult.data?.processName || target?.ProcessName || null,
        verified: true
      }
    };
  }

  _getRunningProcessDetails() {
    try {
      const output = execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          'Get-Process | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle,Path | ConvertTo-Json -Compress'
        ], {
          encoding: 'utf8',
          timeout: 10000
        });

      const parsed = JSON.parse(output || '[]');
      return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (err) {
      this.logger.warn('Failed to list running processes', err.message);
      return [];
    }
  }

  _closeProcesses(processes) {
    return this._closeProcessesGracefully(processes);
  }

  _closeProcessesGracefully(processes) {
    const ids = Array.from(new Set(
      processes
        .map(process => Number(process?.Id))
        .filter(id => Number.isFinite(id) && id > 0)
    ));

    if (ids.length === 0) {
      return false;
    }

    const gracefulScript = [
      '$ids = @(' + ids.join(',') + ')',
      'foreach ($id in $ids) {',
      '  $target = Get-Process -Id $id -ErrorAction SilentlyContinue | Select-Object -First 1',
      '  if (-not $target) { continue }',
      '  try { if ($target.MainWindowHandle -ne 0) { $target.CloseMainWindow() | Out-Null } } catch {}',
      '}'
    ].join('; ');

    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        gracefulScript
      ], {
        timeout: 8000,
        stdio: 'ignore'
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  _forceTerminateProcesses(processes) {
    const terminableProcesses = processes.filter(process => !PROTECTED_HOST_PROCESSES.has(
      Normalizer.normalizeText(process?.ProcessName).replace(/\s+/g, '')
    ));
    const ids = Array.from(new Set(
      terminableProcesses
        .map(process => Number(process?.Id))
        .filter(id => Number.isFinite(id) && id > 0)
    ));
    let terminated = false;

    if (ids.length > 0) {
      try {
        execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `Stop-Process -Id ${ids.join(',')} -Force -ErrorAction SilentlyContinue`
        ], {
          timeout: 8000,
          stdio: 'ignore'
        });
        terminated = true;
      } catch (err) {}
    }

    for (const process of terminableProcesses) {
      const processId = Number(process?.Id);
      try {
        if (Number.isFinite(processId) && processId > 0) {
          execFileSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
            timeout: 8000,
            stdio: 'ignore'
          });
          terminated = true;
          continue;
        }
      } catch (err) {}
    }

    return terminated;
  }

  _sleep(milliseconds) {
    const duration = Math.max(0, Number(milliseconds) || 0);
    if (duration === 0) {
      return;
    }

    try {
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Start-Sleep -Milliseconds ${duration}`
      ], {
        timeout: duration + 1000,
        stdio: 'ignore'
      });
    } catch (err) {}
  }

  switchTo(appName) {
    if (!appName) {
      return { success: false, error: 'No application name provided' };
    }

    const name = appName.toLowerCase().trim();
    const app = KNOWN_APPS[name];
    const processName = app?.cmd || name;

    try {
      execSync(`powershell -Command "(New-Object -ComObject WScript.Shell).AppActivate('${processName}')"`, { timeout: 5000 });
      return { success: true, data: { app: name } };
    } catch (err) {
      return { success: false, error: `Could not switch to: ${name}` };
    }
  }

  getRunningApps() {
    try {
      const result = execSync('powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne \"\" } | Select-Object -ExpandProperty ProcessName"', {
        encoding: 'utf8',
        timeout: 5000
      });
      const processes = result.trim().split('\n').filter(p => p.trim());
      return { success: true, data: { processes, count: processes.length } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = AppController;
