const { execFile } = require('child_process');
const Logger = require('../shared/index').Logger;

const AUDIO_QUERY_TIMEOUT_MS = 6000;

const DEFAULT_AUDIO_DEVICE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY {
  public Guid fmtid;
  public int pid;
}

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT {
  [FieldOffset(0)] public ushort vt;
  [FieldOffset(8)] public IntPtr p;
}

[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  int GetCount(out int cProps);
  int GetAt(int iProp, out PROPERTYKEY pkey);
  int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  int SetValue(ref PROPERTYKEY key, ref PROPVARIANT propvar);
  int Commit();
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out object ppInterface);
  int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  int GetState(out int pdwState);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int dwStateMask, out object ppDevices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  int GetDevice(string pwstrId, out IMMDevice ppDevice);
  int RegisterEndpointNotificationCallback(IntPtr pClient);
  int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject {}

public static class DefaultAudioDevice {
  public static string GetName() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));

    string id;
    Marshal.ThrowExceptionForHR(device.GetId(out id));

    IPropertyStore store;
    Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));

    PROPERTYKEY key;
    key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
    key.pid = 14;

    PROPVARIANT value;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
    string name = Marshal.PtrToStringUni(value.p);
    return id + "|" + name;
  }
}
"@

[DefaultAudioDevice]::GetName()
`;

function runPowerShell(script, timeout = AUDIO_QUERY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function classifyAudioDevice(name) {
  const normalized = String(name || '').toLowerCase();

  if (normalized.includes('bluetooth')) return 'bluetooth-headphones';
  if (/(headphone|headset|earbud|airpods|wh-|buds)/i.test(normalized)) return 'wired-headphones';
  if (/(speaker|realtek|hd audio|display audio|monitor)/i.test(normalized)) return 'speaker';
  return 'audio-output';
}

function normalizeAudioDevice(raw, overrides = {}) {
  if (!raw) return null;

  const name = raw.name || raw.Name || raw.FriendlyName || 'Unknown audio device';
  const id = raw.id || raw.Id || raw.DeviceID || name;

  return {
    name,
    type: raw.type || classifyAudioDevice(name),
    active: overrides.active ?? raw.active ?? false,
    id,
    timestamp: Date.now()
  };
}

function parseDefaultAudioOutput(output) {
  const line = String(output || '').split(/\r?\n/).map(value => value.trim()).find(Boolean);
  if (!line) return null;

  const separator = line.indexOf('|');
  if (separator === -1) {
    return normalizeAudioDevice({ name: line, id: line }, { active: true });
  }

  return normalizeAudioDevice({
    id: line.slice(0, separator),
    name: line.slice(separator + 1)
  }, { active: true });
}

function parseAudioDeviceList(output, activeDevice = null) {
  if (!output || !output.trim()) return [];

  const parsed = JSON.parse(output.trim());
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records
    .map(record => normalizeAudioDevice(record, {
      active: Boolean(activeDevice && (
        record.DeviceID === activeDevice.id ||
        record.Name === activeDevice.name ||
        record.FriendlyName === activeDevice.name
      ))
    }))
    .filter(Boolean);
}

class AudioDeviceManager {
  constructor(options = {}) {
    this.logger = options.logger || new Logger({ level: options.logging?.level || 'info' });
    this.runner = options.runner || runPowerShell;
  }

  async getCurrentAudioDevice() {
    try {
      const output = await this.runner(DEFAULT_AUDIO_DEVICE_SCRIPT);
      return parseDefaultAudioOutput(output);
    } catch (err) {
      this.logger.warn('[Audio] Failed to read active audio device', err.message);
      return null;
    }
  }

  async getAudioDevices() {
    const activeDevice = await this.getCurrentAudioDevice();

    try {
      const script = [
        'Get-CimInstance Win32_PnPEntity',
        '| Where-Object { $_.Name -match \'audio|speaker|headphone|headset|bluetooth\' }',
        '| Select-Object DeviceID,Name,Status',
        '| ConvertTo-Json -Compress'
      ].join(' ');
      const output = await this.runner(script);
      const devices = parseAudioDeviceList(output, activeDevice);

      if (activeDevice && !devices.some(device => device.id === activeDevice.id || device.name === activeDevice.name)) {
        devices.unshift(activeDevice);
      }

      return devices;
    } catch (err) {
      this.logger.warn('[Audio] Failed to enumerate audio devices', err.message);
      return activeDevice ? [activeDevice] : [];
    }
  }
}

const defaultManager = new AudioDeviceManager();

module.exports = {
  AUDIO_QUERY_TIMEOUT_MS,
  AudioDeviceManager,
  classifyAudioDevice,
  normalizeAudioDevice,
  parseDefaultAudioOutput,
  createManager: options => new AudioDeviceManager(options),
  getCurrentAudioDevice: defaultManager.getCurrentAudioDevice.bind(defaultManager),
  getAudioDevices: defaultManager.getAudioDevices.bind(defaultManager)
};
