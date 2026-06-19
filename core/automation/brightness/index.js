const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Logger = require('../../shared/index').Logger;

function psExec(script) {
  try {
    const psFile = path.join(os.tmpdir(), `bright_${Date.now()}.ps1`);
    fs.writeFileSync(psFile, script, 'utf8');
    try {
      const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
        encoding: 'utf8',
        timeout: 5000,
        shell: 'cmd.exe',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return result;
    } finally {
      try { fs.unlinkSync(psFile); } catch (e) {}
    }
  } catch (err) {
    return null;
  }
}

function parseNumber(output) {
  if (!output) return null;

  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const value = Number.parseInt(lines[index], 10);
    if (!Number.isNaN(value)) {
      return Math.max(0, Math.min(100, value));
    }
  }

  return null;
}

class BrightnessController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.step = config?.system?.brightnessStep || 10;
  }

  getCurrentBrightness() {
    try {
      const script = `
\$brightness = Get-WmiObject -Namespace "root/wmi" -Class WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
if (\$brightness) {
  \$brightness.CurrentBrightness
} else {
  -1
}
`;
      const out = psExec(script);
      const val = parseNumber(out);
      if (val !== null && val >= 0) {
        return val;
      }
      return null;
    } catch (err) {
      this.logger.warn('Failed to get brightness', err.message);
      return null;
    }
  }

  setBrightness(value) {
    try {
      const clamped = Math.max(0, Math.min(100, value));
      const script = `
\$monitor = Get-WmiObject -Namespace "root/wmi" -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not \$monitor) {
  throw "Brightness control not supported"
}
\$null = \$monitor.WmiSetBrightness(1, ${clamped})
Start-Sleep -Milliseconds 150
\$current = Get-WmiObject -Namespace "root/wmi" -Class WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not \$current) {
  throw "Brightness readback unavailable"
}
\$current.CurrentBrightness
`;

      const actual = parseNumber(psExec(script));
      if (actual === null) {
        throw new Error('No brightness level returned from Windows');
      }

      this.logger.info(`Brightness set to ${actual}%`);
      return { success: true, data: { value: actual } };
    } catch (err) {
      this.logger.error('Failed to set brightness', err.message);
      return { success: false, error: 'Brightness control not supported on this display' };
    }
  }

  increaseBrightness(amount = null) {
    const step = amount || this.step;
    const current = this.getCurrentBrightness();
    if (current === null) {
      return { success: false, error: 'Brightness control not supported' };
    }
    const newBrightness = Math.min(100, current + step);
    return this.setBrightness(newBrightness);
  }

  decreaseBrightness(amount = null) {
    const step = amount || this.step;
    const current = this.getCurrentBrightness();
    if (current === null) {
      return { success: false, error: 'Brightness control not supported' };
    }
    const newBrightness = Math.max(0, current - step);
    return this.setBrightness(newBrightness);
  }
}

module.exports = BrightnessController;
