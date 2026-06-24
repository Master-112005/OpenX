const { execFile } = require('child_process');

const VERIFICATION_TIMEOUT_MS = 2 * 60 * 1000;
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]

function Wait-WinRtOperation($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

try {
  $availability = Wait-WinRtOperation ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
  if ([string]$availability -ne 'Available') {
    @{ success = $false; reason = ('windows_hello_' + ([string]$availability).ToLowerInvariant()) } |
      ConvertTo-Json -Compress
    exit 0
  }

  $message = $env:OPENX_IDENTITY_VERIFICATION_MESSAGE
  $result = Wait-WinRtOperation ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($message)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  if ([string]$result -eq 'Verified') {
    @{ success = $true } | ConvertTo-Json -Compress
  } else {
    @{ success = $false; reason = ('verification_' + ([string]$result).ToLowerInvariant()) } |
      ConvertTo-Json -Compress
  }
} catch {
  @{ success = $false; reason = 'verification_unavailable' } | ConvertTo-Json -Compress
}
`;

class WindowsIdentityVerifier {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.execFile = options.execFile || execFile;
    this.message = options.message || 'Verify your Windows identity to connect a phone to OpenX.';
  }

  async verifyIdentity() {
    if (this.platform !== 'win32') {
      return { success: false, reason: 'windows_only' };
    }

    const encodedScript = Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64');
    try {
      const stdout = await this._runPowerShell(encodedScript);
      return this._parseResult(stdout);
    } catch (error) {
      return { success: false, reason: error.code === 'ETIMEDOUT' ? 'verification_timeout' : 'verification_unavailable' };
    }
  }

  _runPowerShell(encodedScript) {
    return new Promise((resolve, reject) => {
      this.execFile(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-EncodedCommand', encodedScript],
        {
          windowsHide: true,
          timeout: VERIFICATION_TIMEOUT_MS,
          encoding: 'utf8',
          maxBuffer: 64 * 1024,
          env: {
            ...process.env,
            OPENX_IDENTITY_VERIFICATION_MESSAGE: this.message
          }
        },
        (error, stdout) => error ? reject(error) : resolve(stdout)
      );
    });
  }

  _parseResult(stdout) {
    const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const result = JSON.parse(lines[index]);
        if (typeof result?.success === 'boolean') return result;
      } catch (_) {}
    }
    return { success: false, reason: 'invalid_verification_response' };
  }
}

module.exports = WindowsIdentityVerifier;
