const { execFileSync, execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;
const { launchTarget } = require('../common/launcher');

const KNOWN_APPS = {
  'code': { path: null, cmd: 'code', processName: 'Code' },
  'chrome': { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', cmd: 'chrome' },
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
  'outlook': { cmd: 'outlook' },
  'spotify': { cmd: 'spotify' },
  'discord': { cmd: 'discord', processName: 'Discord' },
  'whatsapp': { processName: 'WhatsApp' },
  'slack': { cmd: 'slack' },
  'zoom': { cmd: 'zoom' },
  'teams': { cmd: 'teams', processName: 'Teams' },
  'apple music': { processName: 'AppleMusic' },
  'apple tv': { processName: 'AppleTV' },
  'calendar': { processName: 'HxCalendarAppImm' },
  'clock': { processName: 'WindowsAlarms' },
  'antigravity': { processName: 'Antigravity IDE' }
};

class AppController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this._startAppsCache = null;
    this._startAppsCacheExpiresAt = 0;
  }

  open(appName) {
    if (!appName) {
      return { success: false, error: 'No application name provided' };
    }

    const name = appName.toLowerCase().trim();
    const app = KNOWN_APPS[name];

    try {
      if (app && app.path) {
        if (require('fs').existsSync(app.path)) {
          launchTarget(app.path);
          return { success: true, data: { app: name } };
        }
      }

      if (app && app.cmd) {
        launchTarget(app.cmd);
        return { success: true, data: { app: name } };
      }

      const startApp = this._resolveStartApp(name);
      if (startApp) {
        this._launchStartApp(startApp);
        return {
          success: true,
          data: {
            app: name,
            resolvedName: startApp.name,
            appId: startApp.appId
          }
        };
      }

      launchTarget(name);
      return { success: true, data: { app: name } };
    } catch (err) {
      this.logger.error(`Failed to open app: ${name}`, err);
      return { success: false, error: `Could not find or open: ${name}` };
    }
  }

  close(appName) {
    if (!appName) {
      return { success: false, error: 'No application name provided' };
    }

    const name = appName.toLowerCase().trim();
    try {
      const processNames = this._resolveProcessCandidates(name);
      const runningProcesses = this._findRunningProcesses(name, processNames);

      if (runningProcesses.length > 0) {
        const closed = this._closeProcesses(runningProcesses);
        if (closed) {
          return {
            success: true,
            data: {
              app: name,
              processName: runningProcesses[0].ProcessName
            }
          };
        }
      }

      return { success: false, error: `Could not close: ${name}` };
    } catch (err) {
      return { success: false, error: `Could not close: ${name}` };
    }
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

  _resolveProcessCandidates(name) {
    const candidates = new Set();
    const app = KNOWN_APPS[name];

    if (app?.processName) {
      candidates.add(app.processName);
    }
    if (app?.cmd) {
      candidates.add(app.cmd);
    }
    candidates.add(name);

    const startApp = this._resolveStartApp(name);
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

      tokens
        .filter(token => token.length >= 4 && !/^\d+$/.test(token) && !['app', 'application'].includes(token.toLowerCase()))
        .forEach(token => candidates.add(token));
    }

    return Array.from(candidates);
  }

  _findRunningProcesses(name, processCandidates = []) {
    const processes = this._getRunningProcessDetails();
    if (!Array.isArray(processes) || processes.length === 0) {
      return [];
    }

    const searchTerms = new Set(
      [name, ...processCandidates]
        .map(candidate => String(candidate || '').trim().toLowerCase())
        .filter(candidate => candidate && !['app', 'application'].includes(candidate))
    );

    return processes.filter(process => {
      const processName = String(process.ProcessName || '').toLowerCase();
      const windowTitle = String(process.MainWindowTitle || '').toLowerCase();
      const processPath = String(process.Path || '').toLowerCase();

      return Array.from(searchTerms).some(term => (
        processName === term ||
        processName.startsWith(`${term}.`) ||
        processName.includes(term) ||
        windowTitle === term ||
        windowTitle.includes(term) ||
        processPath.includes(`\\${term}`) ||
        processPath.includes(term)
      ));
    });
  }

  _getRunningProcessDetails() {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-Process | Select-Object ProcessName,MainWindowTitle,Path | ConvertTo-Json -Compress'
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
    for (const process of processes) {
      const processName = String(process?.ProcessName || '').trim();
      if (!processName) continue;

      const gracefulScript = [
        '$target = Get-Process | Where-Object { $_.ProcessName -eq \'' + processName.replace(/'/g, "''") + '\' }',
        'if (-not $target) { exit 1 }',
        '$target | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }',
        'Start-Sleep -Milliseconds 800',
        '$target = Get-Process | Where-Object { $_.ProcessName -eq \'' + processName.replace(/'/g, "''") + '\' }',
        'if ($target) { $target | Stop-Process -Force }'
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
      } catch (err) {
        continue;
      }

      return true;
    }

    return false;
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
