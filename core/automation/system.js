const os = require('os');
const { execFileSync, execSync } = require('child_process');
const Logger = require('../assistant/Data').Logger;

class SystemController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.cache = new Map();
  }

  _getCached(key, ttlMs, producer) {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now - cached.timestamp < ttlMs) {
      return cached.value;
    }

    const value = producer();
    this.cache.set(key, { timestamp: now, value });
    return value;
  }

  _clearExpiredCache(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (!entry || now - entry.timestamp > maxAgeMs) {
        this.cache.delete(key);
      }
    }
  }

  getTime(now = new Date()) {
    try {
      return {
        success: true,
        data: {
          time: now.toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
          }),
          iso: now.toISOString()
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getDate(now = new Date()) {
    try {
      return {
        success: true,
        data: {
          date: now.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          day: now.toLocaleDateString(undefined, { weekday: 'long' }),
          iso: now.toISOString()
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  calculate(expression) {
    const source = String(expression || '').trim();
    if (!source) {
      return { success: false, error: 'No calculation expression provided' };
    }

    try {
      const normalized = this._normalizeCalculationExpression(source);
      if (!normalized || !/^[\d+\-*/^().\s%a-z]+$/.test(normalized) || !/\d/.test(normalized)) {
        return { success: false, error: 'Invalid calculation expression' };
      }

      const result = this._evaluateArithmeticExpression(normalized);
      if (!Number.isFinite(result)) {
        return { success: false, error: 'Invalid calculation result' };
      }

      return {
        success: true,
        data: {
          expression: source,
          normalizedExpression: normalized,
          result: Number.isInteger(result) ? result : Number(result.toFixed(10))
        }
      };
    } catch (err) {
      return { success: false, error: 'Invalid calculation expression' };
    }
  }

  _normalizeCalculationExpression(expression) {
    return String(expression || '')
      .toLowerCase()
      .replace(/\behat\b/g, 'what')
      .replace(/\bteh\b/g, 'the')
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/\b(?:what\s+is|what's|calculate|solve|answer|find|tell\s+me|equals?)\b/g, ' ')
      .replace(/\b(?:the\s+)?(?:value|answer|result)\s+of\b/g, ' ')
      .replace(/(\d+(?:\.\d+)?)\s+percent\s+of\s+(\d+(?:\.\d+)?)/g, '$1% of $2')
      .replace(/(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/g, '($1/100)*$2')
      .replace(/\b(?:square\s+root|sqrt)\s+of\s+([+\-]?\d+(?:\.\d+)?)/g, 'sqrt($1)')
      .replace(/\b(?:absolute\s+value|absolute|abs)\s+of\s+([+\-]?\d+(?:\.\d+)?)/g, 'abs($1)')
      .replace(/\b(?:squared|square)\b/g, '^2')
      .replace(/\bcubed\b/g, '^3')
      .replace(/\b(?:to\s+the\s+power\s+of|power\s+of|raised\s+to|power)\b/g, '^')
      .replace(/\b(?:plus|add)\b/g, '+')
      .replace(/\b(?:minus|subtract)\b/g, '-')
      .replace(/\b(?:times|multiply|multiplied\s+by|x)\b/g, '*')
      .replace(/\b(?:divided\s+by|divide\s+by|over)\b/g, '/')
      .replace(/[=,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _evaluateArithmeticExpression(expression) {
    const tokens = String(expression || '').match(/sqrt|abs|\d+(?:\.\d+)?|[+\-*/^()%]/g) || [];
    let index = 0;

    const peek = () => tokens[index];
    const consume = expected => {
      const token = tokens[index];
      if (expected && token !== expected) {
        throw new Error('Unexpected token');
      }
      index += 1;
      return token;
    };

    const parseExpression = () => {
      let value = parseTerm();
      while (peek() === '+' || peek() === '-') {
        const operator = consume();
        const right = parseTerm();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    };

    const parseTerm = () => {
      let value = parsePower();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const operator = consume();
        const right = parsePower();
        if ((operator === '/' || operator === '%') && right === 0) {
          throw new Error('Division by zero');
        }
        if (operator === '*') value *= right;
        if (operator === '/') value /= right;
        if (operator === '%') value %= right;
      }
      return value;
    };

    const parsePower = () => {
      let value = parseFactor();
      if (peek() === '^') {
        consume('^');
        const exponent = parsePower();
        value = Math.pow(value, exponent);
      }
      return value;
    };

    const parseFactor = () => {
      if (peek() === '+') {
        consume('+');
        return parseFactor();
      }
      if (peek() === '-') {
        consume('-');
        return -parseFactor();
      }
      if (peek() === 'sqrt' || peek() === 'abs') {
        const fn = consume();
        const value = peek() === '('
          ? (() => {
              consume('(');
              const inner = parseExpression();
              consume(')');
              return inner;
            })()
          : parseFactor();
        if (fn === 'sqrt') {
          if (value < 0) {
            throw new Error('Invalid square root');
          }
          return Math.sqrt(value);
        }
        return Math.abs(value);
      }
      if (peek() === '(') {
        consume('(');
        const value = parseExpression();
        consume(')');
        return value;
      }

      const token = consume();
      if (!/^\d+(?:\.\d+)?$/.test(token || '')) {
        throw new Error('Expected number');
      }
      return Number(token);
    };

    const result = parseExpression();
    if (index !== tokens.length) {
      throw new Error('Unexpected trailing tokens');
    }
    return result;
  }

  getCPUUsage() {
    return this._getCached('cpuUsage', 15000, () => this._getCPUUsageNow());
  }

  _getCPUUsageNow() {
    try {
      const result = execSync(
        'powershell -Command "Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average"',
        { encoding: 'utf8', timeout: 5000 }
      );
      const cpu = parseInt(result.trim(), 10);
      return { success: true, data: { cpu: isNaN(cpu) ? 0 : cpu } };
    } catch (err) {
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      cpus.forEach(cpu => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      const usage = Math.round(100 - (totalIdle / totalTick) * 100);
      return { success: true, data: { cpu: usage } };
    }
  }

  getMemoryUsage() {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const usedGB = (usedMem / 1024 / 1024 / 1024).toFixed(1);
      const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1);
      const percent = Math.round((usedMem / totalMem) * 100);

      return {
        success: true,
        data: {
          ram: percent,
          used: usedGB,
          total: totalGB,
          percent
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getBatteryStatus() {
    return this._getCached('batteryStatus', 60000, () => this._getBatteryStatusNow());
  }

  _getBatteryStatusNow() {
    try {
      const result = execSync(
        'powershell -Command "Get-CimInstance Win32_Battery | Select-Object -ExpandProperty EstimatedChargeRemaining"',
        { encoding: 'utf8', timeout: 5000 }
      );
      const battery = parseInt(result.trim(), 10);
      if (isNaN(battery)) {
        return { success: true, data: { battery: 'N/A', message: 'No battery detected' } };
      }
      return { success: true, data: { battery } };
    } catch (err) {
      return { success: true, data: { battery: 'N/A', message: 'No battery detected' } };
    }
  }

  getDiskSpace() {
    return this._getCached('diskSpace', 60000, () => this._getDiskSpaceNow());
  }

  _getDiskSpaceNow() {
    try {
      const result = execSync(
        'powershell -Command "Get-CimInstance Win32_LogicalDisk -Filter DriveType=3 | Select-Object DeviceID, @{N=\'FreeGB\';E={[math]::Round($_.FreeSpace/1GB,1)}}, @{N=\'TotalGB\';E={[math]::Round($_.Size/1GB,1)}} | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 5000 }
      );

      let disks;
      try {
        disks = JSON.parse(result.trim());
      } catch (e) {
        disks = [{ DeviceID: 'C:', FreeGB: 0, TotalGB: 0 }];
      }

      if (!Array.isArray(disks)) disks = [disks];

      const primaryDisk = disks.find(d => d.DeviceID === 'C:') || disks[0] || {};
      return {
        success: true,
        data: {
          label: primaryDisk.DeviceID || 'C:',
          free: primaryDisk.FreeGB || 0,
          total: primaryDisk.TotalGB || 0
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getProcessCount() {
    return this._getCached('processCount', 10000, () => this._getProcessCountNow());
  }

  _getProcessCountNow() {
    try {
      const result = execSync(
        'powershell -Command "(Get-Process).Count"',
        { encoding: 'utf8', timeout: 5000 }
      );
      const count = parseInt(result.trim(), 10);
      return { success: true, data: { count: isNaN(count) ? 0 : count } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getRunningApps(options = {}) {
    const queryApp = String(options?.queryApp || '').trim().toLowerCase();
    return this._getCached(`runningApps:${queryApp}`, 3000, () => this._getRunningAppsNow({ queryApp }));
  }

  _getRunningAppsNow(options = {}) {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        [
          "$apps = Get-Process |",
          "Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |",
          "Select-Object ProcessName, MainWindowTitle, Id |",
          "Sort-Object ProcessName, MainWindowTitle -Unique;",
          "$apps | ConvertTo-Json -Compress"
        ].join(' ')
      ], {
        encoding: 'utf8',
        timeout: 5000
      });
      const parsed = JSON.parse(output || '[]');
      const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      const apps = rows
        .map(row => ({
          name: String(row.ProcessName || '').trim(),
          title: String(row.MainWindowTitle || '').trim(),
          id: Number(row.Id || 0)
        }))
        .filter(row => row.name && row.title);
      const queryApp = String(options?.queryApp || '').trim().toLowerCase();
      const matchedApps = queryApp
        ? apps.filter(app => {
            const name = app.name.toLowerCase();
            const title = app.title.toLowerCase();
            return name.includes(queryApp) || title.includes(queryApp) || queryApp.includes(name);
          })
        : [];

      return {
        success: true,
        data: {
          target: 'apps',
          count: apps.length,
          apps,
          names: Array.from(new Set(apps.map(app => app.name))).slice(0, 8),
          queryApp: queryApp || undefined,
          isOpen: queryApp ? matchedApps.length > 0 : undefined,
          matchedApps: queryApp ? matchedApps.slice(0, 8) : undefined
        }
      };
    } catch (err) {
      return { success: false, error: 'Running apps are not available' };
    }
  }

  getInsight(insightType) {
    const type = String(insightType || '').trim();
    if (type === 'topMemoryApp') {
      return this._getTopProcessBy('WorkingSet64', 'memory');
    }
    if (type === 'topCpuProcess') {
      return this._getTopProcessBy('CPU', 'cpu');
    }
    if (type === 'storageUsage') {
      return this._getLargestUserFolders();
    }
    if (type === 'recentlyInstalledApps') {
      return this._getRecentlyInstalledApps();
    }
    if (type === 'systemSlowdown') {
      return this._getSystemSlowdownSnapshot();
    }
    return { success: false, error: 'System insight is not supported yet' };
  }

  _getTopProcessBy(property, metric) {
    return this._getCached(`topProcess:${property}:${metric}`, 10000, () => this._getTopProcessByNow(property, metric));
  }

  _getTopProcessByNow(property, metric) {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        [
          `$items = Get-Process | Where-Object { $_.${property} -ne $null } | Sort-Object ${property} -Descending | Select-Object -First 8 ProcessName, Id, CPU, WorkingSet64, MainWindowTitle;`,
          '$items | ConvertTo-Json -Compress'
        ].join(' ')
      ], { encoding: 'utf8', timeout: 6000 });
      const parsed = JSON.parse(output || '[]');
      const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      const processes = rows.map(row => ({
        name: String(row.ProcessName || '').trim(),
        id: Number(row.Id || 0),
        cpu: Number(row.CPU || 0),
        memoryMB: Number((Number(row.WorkingSet64 || 0) / 1024 / 1024).toFixed(1)),
        title: String(row.MainWindowTitle || '').trim()
      })).filter(row => row.name);

      return {
        success: true,
        data: {
          insightType: metric === 'memory' ? 'topMemoryApp' : 'topCpuProcess',
          metric,
          top: processes[0] || null,
          processes
        }
      };
    } catch (err) {
      return { success: false, error: `${metric === 'memory' ? 'Memory' : 'CPU'} usage by process is not available` };
    }
  }

  _getLargestUserFolders() {
    return this._getCached('largestUserFolders', 10 * 60 * 1000, () => this._getLargestUserFoldersNow());
  }

  _getLargestUserFoldersNow() {
    try {
      const home = os.homedir();
      const folders = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music']
        .map(name => `${home}\\${name}`);
      const script = [
        `$paths = @(${folders.map(folder => `'${folder.replace(/'/g, "''")}'`).join(',')});`,
        '$items = foreach ($p in $paths) {',
        '  if (Test-Path $p) {',
        '    $size = (Get-ChildItem -LiteralPath $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum;',
        '    [PSCustomObject]@{ Path = $p; Name = Split-Path $p -Leaf; SizeBytes = [int64]($size) }',
        '  }',
        '};',
        '$items | Sort-Object SizeBytes -Descending | ConvertTo-Json -Compress'
      ].join(' ');
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 12000
      });
      const parsed = JSON.parse(output || '[]');
      const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      const folderRows = rows.map(row => ({
        name: String(row.Name || '').trim(),
        path: String(row.Path || '').trim(),
        sizeMB: Number((Number(row.SizeBytes || 0) / 1024 / 1024).toFixed(1))
      })).filter(row => row.name);
      return { success: true, data: { insightType: 'storageUsage', folders: folderRows } };
    } catch (err) {
      return { success: false, error: 'Storage usage by folder is not available' };
    }
  }

  _getRecentlyInstalledApps() {
    return this._getCached('recentlyInstalledApps', 10 * 60 * 1000, () => this._getRecentlyInstalledAppsNow());
  }

  _getRecentlyInstalledAppsNow() {
    try {
      const script = [
        '$roots = @("HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*");',
        '$apps = foreach ($root in $roots) { Get-ItemProperty $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, InstallDate, Publisher };',
        '$apps | Sort-Object InstallDate -Descending | Select-Object -First 10 | ConvertTo-Json -Compress'
      ].join(' ');
      const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        timeout: 8000
      });
      const parsed = JSON.parse(output || '[]');
      const rows = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      const apps = rows.map(row => ({
        name: String(row.DisplayName || '').trim(),
        installDate: String(row.InstallDate || '').trim(),
        publisher: String(row.Publisher || '').trim()
      })).filter(row => row.name);
      return { success: true, data: { insightType: 'recentlyInstalledApps', apps } };
    } catch (err) {
      return { success: false, error: 'Recently installed applications are not available' };
    }
  }

  _getSystemSlowdownSnapshot() {
    const cpu = this._getTopProcessBy('CPU', 'cpu');
    const memory = this._getTopProcessBy('WorkingSet64', 'memory');
    return {
      success: true,
      data: {
        insightType: 'systemSlowdown',
        cpu: cpu.data?.top || null,
        memory: memory.data?.top || null
      }
    };
  }

  bluetooth(enabled = undefined) {
    if (enabled === true || enabled === false) {
      return this._setBluetoothState(enabled);
    }

    return this._getBluetoothState();
  }

  _getBluetoothState() {
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        [
          "$devices = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |",
          "Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Enumerator|Protocol|Service|Generic Attribute|RFCOMM' };",
          "$device = $devices | Sort-Object { if ($_.Status -eq 'OK') { 0 } else { 1 } } | Select-Object -First 1;",
          "if (-not $device) { @{ available = $false } | ConvertTo-Json -Compress; exit }",
          "@{ available = $true; enabled = ($device.Status -eq 'OK'); status = $device.Status; name = $device.FriendlyName } | ConvertTo-Json -Compress"
        ].join(' ')
      ], {
        encoding: 'utf8',
        timeout: 8000
      });
      const data = JSON.parse(output || '{}');
      if (!data.available) {
        return { success: false, error: 'Bluetooth device not found' };
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: 'Bluetooth status is not available' };
    }
  }

  _setBluetoothState(enabled) {
    const verb = enabled ? 'Enable-PnpDevice' : 'Disable-PnpDevice';
    try {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        [
          "$devices = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |",
          "Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Enumerator|Protocol|Service|Generic Attribute|RFCOMM' };",
          "if (-not $devices) { @{ success = $false; error = 'Bluetooth device not found' } | ConvertTo-Json -Compress; exit }",
          `$devices | ${verb} -Confirm:$false -ErrorAction Stop;`,
          "$after = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |",
          "Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Enumerator|Protocol|Service|Generic Attribute|RFCOMM' } |",
          "Sort-Object { if ($_.Status -eq 'OK') { 0 } else { 1 } } | Select-Object -First 1;",
          `@{ success = $true; enabled = ${enabled ? '$true' : '$false'}; status = $after.Status; name = $after.FriendlyName } | ConvertTo-Json -Compress`
        ].join(' ')
      ], {
        encoding: 'utf8',
        timeout: 15000
      });
      const data = JSON.parse(output || '{}');
      if (!data.success) {
        return { success: false, error: data.error || 'Bluetooth could not be changed' };
      }
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        error: 'Bluetooth could not be changed. Windows may require administrator permission or may not expose a Bluetooth radio'
      };
    }
  }

  getStatus() {
    this._clearExpiredCache();
    const cpu = this.getCPUUsage();
    const mem = this.getMemoryUsage();
    const battery = this.getBatteryStatus();
    const disk = this.getDiskSpace();

    return {
      success: true,
      data: {
        cpu: cpu.data?.cpu || 0,
        ram: mem.data?.percent || 0,
        battery: battery.data?.battery || 'N/A',
        disk: disk.data?.free || 0,
        diskTotal: disk.data?.total || 0,
        diskLabel: disk.data?.label || 'C:'
      }
    };
  }
}

module.exports = SystemController;
