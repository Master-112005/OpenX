const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const IdGenerator = require('../../shared/index').IdGenerator;

class SchedulerController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
  }

  setTimer(durationMinutes) {
    if (!durationMinutes || durationMinutes <= 0) {
      return { success: false, error: 'Invalid timer duration' };
    }

    const dueAt = new Date(Date.now() + (durationMinutes * 60 * 1000));
    return this._scheduleNotification({
      kind: 'Timer',
      title: 'JARVIS Timer',
      message: `Your ${durationMinutes} minute timer is done.`,
      dueAt
    });
  }

  setAlarm(timeExpression) {
    const dueAt = this._parseTimeExpression(timeExpression);
    if (!dueAt) {
      return { success: false, error: 'Invalid alarm time' };
    }

    return this._scheduleNotification({
      kind: 'Alarm',
      title: 'JARVIS Alarm',
      message: `Alarm for ${timeExpression} is ringing.`,
      dueAt
    });
  }

  setReminder(reminderText, options = {}) {
    const message = String(reminderText || '').trim();
    if (!message) {
      return { success: false, error: 'Reminder text is required' };
    }

    let dueAt = null;
    if (options.duration && options.duration > 0) {
      dueAt = new Date(Date.now() + (options.duration * 60 * 1000));
    } else if (options.timeExpression) {
      dueAt = this._parseTimeExpression(options.timeExpression);
    }

    if (!dueAt) {
      return { success: false, error: 'Invalid reminder time' };
    }

    return this._scheduleNotification({
      kind: 'Reminder',
      title: 'JARVIS Reminder',
      message,
      dueAt
    });
  }

  _parseTimeExpression(input) {
    const value = String(input || '').trim().toLowerCase();
    if (!value) return null;

    const durationMatch = value.match(/(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);
    if (durationMatch) {
      const amount = parseInt(durationMatch[1], 10);
      const unit = durationMatch[2].toLowerCase();
      let minutes = amount;
      if (unit.startsWith('hour') || unit.startsWith('hr')) {
        minutes = amount * 60;
      } else if (unit.startsWith('second') || unit.startsWith('sec')) {
        minutes = Math.max(1, Math.ceil(amount / 60));
      }

      return new Date(Date.now() + (minutes * 60 * 1000));
    }

    const match = value.match(/^(tomorrow\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) {
      return null;
    }

    const isTomorrow = Boolean(match[1]);
    let hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3] || '0', 10);
    const meridiem = match[4] ? match[4].toLowerCase() : null;

    if (meridiem) {
      if (hours === 12) {
        hours = meridiem === 'am' ? 0 : 12;
      } else if (meridiem === 'pm') {
        hours += 12;
      }
    }

    if (hours > 23 || minutes > 59) {
      return null;
    }

    const dueAt = new Date();
    dueAt.setSeconds(0, 0);
    dueAt.setHours(hours, minutes, 0, 0);

    if (isTomorrow || dueAt.getTime() <= Date.now()) {
      dueAt.setDate(dueAt.getDate() + 1);
    }

    return dueAt;
  }

  _scheduleNotification({ kind, title, message, dueAt }) {
    try {
      const taskName = `JARVIS_${kind}_${IdGenerator.short()}`;
      const scriptPath = this._writeNotificationScript(taskName, title, message);
      const registerScript = this._buildRegisterTaskScript(taskName, scriptPath, dueAt);

      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        registerScript
      ], {
        timeout: 15000,
        stdio: 'ignore'
      });

      return {
        success: true,
        data: {
          taskName,
          dueAt: dueAt.toISOString(),
          kind
        }
      };
    } catch (err) {
      this.logger.error(`Failed to schedule ${kind.toLowerCase()}`, err);
      return { success: false, error: `Could not schedule ${kind.toLowerCase()}` };
    }
  }

  _writeNotificationScript(taskName, title, message) {
    const safeTitle = String(title || '').replace(/'/g, "''");
    const safeMessage = String(message || '').replace(/'/g, "''");
    const scriptPath = path.join(os.tmpdir(), `${taskName}.ps1`);
    const script = [
      "Add-Type -AssemblyName PresentationFramework",
      `[System.Windows.MessageBox]::Show('${safeMessage}','${safeTitle}') | Out-Null`
    ].join('\r\n');

    fs.writeFileSync(scriptPath, script, 'utf8');
    return scriptPath;
  }

  _buildRegisterTaskScript(taskName, scriptPath, dueAt) {
    const safeTaskName = String(taskName || '').replace(/'/g, "''");
    const safeScriptPath = String(scriptPath || '').replace(/'/g, "''");
    const safeDate = String(dueAt.toISOString()).replace(/'/g, "''");

    return [
      `$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "${safeScriptPath}"'`,
      `$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]'${safeDate}')`,
      `Register-ScheduledTask -TaskName '${safeTaskName}' -Action $action -Trigger $trigger -Force | Out-Null`
    ].join('; ');
  }
}

module.exports = SchedulerController;
