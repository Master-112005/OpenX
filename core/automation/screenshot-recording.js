const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Logger = require('../assistant/Data').Logger;

function escapePowerShell(value) {
  return String(value ?? '').replace(/'/g, "''");
}

class ScreenshotController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.outputDirectory = config?.screenshots?.directory || path.join(os.homedir(), 'Pictures', 'Screenshots');
  }

  capture() {
    try {
      fs.mkdirSync(this.outputDirectory, { recursive: true });
      const filePath = path.join(this.outputDirectory, `OpenX-${this._timestamp()}.png`);
      const script = this._buildCaptureScript(filePath);

      execFileSync('powershell.exe', [
        '-NoProfile',
        '-STA',
        '-Command',
        script
      ], {
        encoding: 'utf8',
        timeout: 12000
      });

      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Screenshot capture did not produce a file' };
      }

      return {
        success: true,
        data: {
          filePath,
          directory: this.outputDirectory
        }
      };
    } catch (err) {
      this.logger.warn('Screenshot capture failed', err.message);
      return { success: false, error: 'Could not take a screenshot' };
    }
  }

  _buildCaptureScript(filePath) {
    return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
  $bitmap.Save('${escapePowerShell(filePath)}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
}
`;
  }

  _timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
}

module.exports = ScreenshotController;
