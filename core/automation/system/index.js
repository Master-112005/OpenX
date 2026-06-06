const os = require('os');
const { execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;

class SystemController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
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

  getCPUUsage() {
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

  getStatus() {
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
