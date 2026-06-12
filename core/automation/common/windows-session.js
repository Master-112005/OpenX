const { execFileSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;

function escapePowerShell(value) {
  return String(value ?? '').replace(/'/g, "''");
}

const USER32_BOOTSTRAP = `
Add-Type -AssemblyName Microsoft.VisualBasic
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class Win32WindowApi {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
`;

class WindowsSessionController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
  }

  listWindows() {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        [
          'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |',
          'Select-Object @{Name=\'handle\';Expression={[int64]$_.MainWindowHandle}},',
          '@{Name=\'title\';Expression={$_.MainWindowTitle}},',
          '@{Name=\'processName\';Expression={$_.ProcessName}},',
          '@{Name=\'id\';Expression={$_.Id}}',
          '| ConvertTo-Json -Compress'
        ].join(' ')
      ], {
        encoding: 'utf8',
        timeout: 10000
      });

      const parsed = JSON.parse(output || '[]');
      return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    } catch (err) {
      this.logger.warn('Failed to enumerate desktop windows', err.message);
      return [];
    }
  }

  minimizeWindow(windowName, options = {}) {
    return this._applyWindowAction('minimize', windowName, options);
  }

  maximizeWindow(windowName, options = {}) {
    return this._applyWindowAction('maximize', windowName, options);
  }

  focusWindow(windowName, options = {}) {
    return this._applyWindowAction('focus', windowName, options);
  }

  closeWindow(windowName, options = {}) {
    return this._applyWindowAction('close', windowName, options);
  }

  navigateWindowToUrl(windowName, url, options = {}) {
    const target = this.findWindow(windowName, options);
    if (!target) {
      return { success: false, error: this._missingWindowMessage(windowName, options) };
    }

    if (!url) {
      return { success: false, error: 'No URL provided for window navigation' };
    }

    const script = `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
$hwnd = [IntPtr]${target.handle}
$url = '${escapePowerShell(url)}'
if ([Win32WindowApi]::IsIconic($hwnd)) {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
} else {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 5) | Out-Null
}
[Win32WindowApi]::SetForegroundWindow($hwnd) | Out-Null
$wshell = New-Object -ComObject WScript.Shell
$null = $wshell.AppActivate(${target.id})
Start-Sleep -Milliseconds 250
Set-Clipboard -Value $url
Start-Sleep -Milliseconds 80
$wshell.SendKeys('^l')
Start-Sleep -Milliseconds 120
$wshell.SendKeys('^a')
Start-Sleep -Milliseconds 80
$wshell.SendKeys('^v')
Start-Sleep -Milliseconds 80
$wshell.SendKeys('{ENTER}')
`;

    try {
      this._runScript(script, 8000);
      return {
        success: true,
        data: {
          action: 'navigate',
          url,
          matchedWindow: target.title,
          processName: target.processName
        }
      };
    } catch (err) {
      return { success: false, error: `Unable to reuse the ${target.title} window` };
    }
  }

  sendKeys(windowName, keys, options = {}) {
    const target = this.findWindow(windowName, options);
    if (!target) {
      return { success: false, error: this._missingWindowMessage(windowName, options) };
    }

    const script = `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
$hwnd = [IntPtr]${target.handle}
if ([Win32WindowApi]::IsIconic($hwnd)) {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
} else {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 5) | Out-Null
}
[Win32WindowApi]::SetForegroundWindow($hwnd) | Out-Null
$wshell = New-Object -ComObject WScript.Shell
$null = $wshell.AppActivate(${target.id})
Start-Sleep -Milliseconds 220
$wshell.SendKeys('${escapePowerShell(keys)}')
`;

    try {
      this._runScript(script, 6000);
      return {
        success: true,
        data: {
          action: 'sendKeys',
          keys,
          matchedWindow: target.title,
          matchedHandle: target.handle,
          processName: target.processName
        }
      };
    } catch (err) {
      return { success: false, error: `Unable to control the ${target.title} window` };
    }
  }

  findWindow(windowName, options = {}) {
    const windows = this.listWindows();
    if (windows.length === 0) {
      return null;
    }

    const activeHandle = options.activeHandle ?? this._getForegroundWindowHandle();
    const normalizedQuery = Normalizer.normalizeText(windowName || '');
    const preferredProcesses = Array.isArray(options.preferredProcessNames)
      ? options.preferredProcessNames.map(value => Normalizer.normalizeText(value))
      : [];
    const preferredTitleTokens = Array.isArray(options.preferredTitleTokens)
      ? options.preferredTitleTokens.map(value => Normalizer.normalizeText(value)).filter(Boolean)
      : [];
    const requireTitleTokenMatch = Boolean(options.requireTitleTokenMatch);
    const excludedTitleTokens = Array.isArray(options.excludeTitleTokens)
      ? options.excludeTitleTokens.map(value => Normalizer.normalizeText(value)).filter(Boolean)
      : [];

    let best = null;

    windows.forEach(candidate => {
      const title = Normalizer.normalizeText(candidate.title);
      const processName = Normalizer.normalizeText(candidate.processName);
      let score = 0;

      if (excludedTitleTokens.some(token => token && title.includes(token))) {
        return;
      }

      if (requireTitleTokenMatch && preferredTitleTokens.length > 0) {
        const titleTokens = new Set(Normalizer.tokenize(title));
        const titleMatches = preferredTitleTokens.every(token => (
          title.includes(token) || titleTokens.has(token)
        ));
        if (!titleMatches) {
          return;
        }
      }

      if (normalizedQuery) {
        const titleSimilarity = title ? Normalizer.similarity(normalizedQuery, title) : 0;
        const processSimilarity = processName ? Normalizer.similarity(normalizedQuery, processName) : 0;

        if (title === normalizedQuery) score += 160;
        if (processName === normalizedQuery) score += 130;
        if (title.includes(normalizedQuery)) score += 120;
        if (processName.includes(normalizedQuery)) score += 90;

        if (titleSimilarity >= 0.6) score += Math.round(titleSimilarity * 80);
        if (processSimilarity >= 0.7) score += Math.round(processSimilarity * 50);

        const queryTokens = Normalizer.tokenize(normalizedQuery);
        if (queryTokens.length > 0) {
          const titleTokens = new Set(Normalizer.tokenize(title));
          const processTokens = new Set(Normalizer.tokenize(processName));
          const overlap = queryTokens.filter(token => titleTokens.has(token) || processTokens.has(token)).length;
          score += overlap * 18;
        }
      } else {
        score += candidate.handle === activeHandle ? 120 : 20;
      }

      preferredProcesses.forEach(process => {
        if (!process) return;
        if (processName === process) score += 60;
        else if (processName.includes(process)) score += 35;
      });

      preferredTitleTokens.forEach(token => {
        if (token && title.includes(token)) score += 28;
      });

      if (candidate.handle === activeHandle) {
        score += 35;
      }

      if (!best || score > best.score) {
        best = { score, candidate };
      }
    });

    if (!best || best.score < 40) {
      return null;
    }

    return best.candidate;
  }

  _applyWindowAction(action, windowName, options = {}) {
    const target = this.findWindow(windowName, options);
    if (!target) {
      return { success: false, error: this._missingWindowMessage(windowName, options) };
    }

    const actionScripts = {
      minimize: `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
[Win32WindowApi]::ShowWindowAsync([IntPtr]${target.handle}, 6) | Out-Null
`,
      maximize: `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
$hwnd = [IntPtr]${target.handle}
if ([Win32WindowApi]::IsIconic($hwnd)) {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
}
[Win32WindowApi]::ShowWindowAsync($hwnd, 3) | Out-Null
[Win32WindowApi]::SetForegroundWindow($hwnd) | Out-Null
`,
      focus: `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
$hwnd = [IntPtr]${target.handle}
if ([Win32WindowApi]::IsIconic($hwnd)) {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
} else {
  [Win32WindowApi]::ShowWindowAsync($hwnd, 5) | Out-Null
}
[Win32WindowApi]::SetForegroundWindow($hwnd) | Out-Null
$wshell = New-Object -ComObject WScript.Shell
$null = $wshell.AppActivate(${target.id})
`,
      close: `
$ErrorActionPreference = 'Stop'
${USER32_BOOTSTRAP}
$process = Get-Process -Id ${target.id} -ErrorAction SilentlyContinue | Select-Object -First 1
if ($process) {
  $closed = $process.CloseMainWindow()
  if ($closed) {
    Start-Sleep -Milliseconds 250
    exit 0
  }
}
[Win32WindowApi]::PostMessage([IntPtr]${target.handle}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
`
    };

    try {
      this._runScript(actionScripts[action], 6000);
      return {
        success: true,
        data: {
          action,
          matchedWindow: target.title,
          matchedHandle: target.handle,
          processName: target.processName
        }
      };
    } catch (err) {
      return {
        success: false,
        error: `Unable to ${action} the ${target.title} window`
      };
    }
  }

  _getForegroundWindowHandle() {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `${USER32_BOOTSTRAP}; [int64][Win32WindowApi]::GetForegroundWindow()`
      ], {
        encoding: 'utf8',
        timeout: 5000
      });

      const handle = parseInt(String(output || '').trim(), 10);
      return Number.isFinite(handle) ? handle : 0;
    } catch (err) {
      return 0;
    }
  }

  _missingWindowMessage(windowName, options = {}) {
    const label = String(windowName || '').trim();
    if (label) {
      return `Window not found: ${label}`;
    }

    if (options.preferredTitleTokens?.length) {
      return `Window not found: ${options.preferredTitleTokens.join(' ')}`;
    }

    return 'No active window is available';
  }

  _runScript(script, timeout = 6000) {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      script
    ], {
      timeout,
      stdio: 'pipe'
    });
  }
}

module.exports = WindowsSessionController;
