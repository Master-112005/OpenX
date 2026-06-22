const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Logger = require('../assistant/Data').Logger;

const AUDIO_BRIDGE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out uint pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
  int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
  int VolumeStepUp(Guid pguidEventContext);
  int VolumeStepDown(Guid pguidEventContext);
  int QueryHardwareSupport(out uint pdwHardwareSupportMask);
  int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume ppInterface);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public static class AudioBridge {
  private static IAudioEndpointVolume GetEndpointVolume() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume volume;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume));
    return volume;
  }

  public static int GetMasterVolume() {
    float level;
    Marshal.ThrowExceptionForHR(GetEndpointVolume().GetMasterVolumeLevelScalar(out level));
    return (int)Math.Round(level * 100);
  }

  public static int SetMasterVolume(int value) {
    float level = Math.Max(0, Math.Min(100, value)) / 100f;
    Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMute(false, Guid.Empty));
    Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMasterVolumeLevelScalar(level, Guid.Empty));
    return GetMasterVolume();
  }

  public static bool GetMute() {
    bool muted;
    Marshal.ThrowExceptionForHR(GetEndpointVolume().GetMute(out muted));
    return muted;
  }

  public static bool SetMute(bool muted) {
    Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMute(muted, Guid.Empty));
    return GetMute();
  }
}
"@ -ErrorAction Stop
`;

function psExec(script) {
  try {
    const psFile = path.join(os.tmpdir(), `vol_${Date.now()}.ps1`);
    fs.writeFileSync(psFile, script, 'utf8');
    try {
      return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psFile}"`, {
        encoding: 'utf8',
        timeout: 8000,
        shell: 'cmd.exe',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
    } finally {
      try { fs.unlinkSync(psFile); } catch (err) {}
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

function parseBoolean(output) {
  if (!output) return null;

  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim().toLowerCase())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index] === 'true') return true;
    if (lines[index] === 'false') return false;
  }

  return null;
}

class VolumeController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.step = config?.system?.volumeStep || 5;
    this.lastKnownVolume = 50;
    this.lastSetAt = 0;
  }

  _run(body) {
    return psExec(`
$ErrorActionPreference = 'Stop'
${AUDIO_BRIDGE}
${body}
`);
  }

  _getAudioState() {
    const output = this._run(`
$muted = [AudioBridge]::GetMute()
$volume = [AudioBridge]::GetMasterVolume()
Write-Output $muted
Write-Output $volume
`);

    const muted = parseBoolean(output);
    const volume = parseNumber(output);

    if (muted === null || volume === null) {
      return null;
    }

    if (volume > 0) {
      this.lastKnownVolume = volume;
    }

    return { muted, volume };
  }

  getCurrentVolume() {
    try {
      const state = this._getAudioState();
      if (!state) {
        return this.lastKnownVolume;
      }

      return state.muted ? 0 : state.volume;
    } catch (err) {
      this.logger.warn('Failed to get current volume', err.message);
      return this.lastKnownVolume;
    }
  }

  setVolume(value) {
    try {
      const clamped = Math.max(0, Math.min(100, value));
      const actual = parseNumber(this._run(`[AudioBridge]::SetMasterVolume(${clamped})`));

      if (actual === null) {
        throw new Error('No volume level returned from Windows');
      }

      if (actual > 0) {
        this.lastKnownVolume = actual;
      }
      this.lastSetAt = Date.now();
      this.logger.info(`Volume set to ${actual}%`);
      return { success: true, data: { value: actual } };
    } catch (err) {
      this.logger.error('Failed to set volume', err.message);
      return { success: false, error: 'Failed to set system volume' };
    }
  }

  increaseVolume(amount = null) {
    const current = this._getVolumeBaseline();
    const newVolume = Math.min(100, current + (amount || this.step));
    return this.setVolume(newVolume);
  }

  decreaseVolume(amount = null) {
    const current = this._getVolumeBaseline();
    const newVolume = Math.max(0, current - (amount || this.step));
    return this.setVolume(newVolume);
  }

  mute() {
    try {
      const muted = parseBoolean(this._run(`[AudioBridge]::SetMute($true)`));
      if (muted !== true) {
        throw new Error('Mute state did not change');
      }

      this.logger.info('Volume muted');
      return { success: true, data: { value: 0 } };
    } catch (err) {
      this.logger.error('Failed to mute volume', err.message);
      return { success: false, error: 'Failed to mute system volume' };
    }
  }

  unmute() {
    try {
      const result = this.setVolume(50);
      if (!result.success) {
        return result;
      }

      const muted = parseBoolean(this._run(`[AudioBridge]::SetMute($false)`));
      if (muted !== false) {
        throw new Error('Mute state did not clear');
      }

      return { success: true, data: { value: result.data.value } };
    } catch (err) {
      this.logger.error('Failed to unmute volume', err.message);
      return { success: false, error: 'Failed to unmute system volume' };
    }
  }

  _getVolumeBaseline() {
    const current = this.getCurrentVolume();
    if (Date.now() - this.lastSetAt <= 1500) {
      return this.lastKnownVolume;
    }
    return current;
  }
}

module.exports = VolumeController;
