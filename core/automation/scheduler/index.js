const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const IdGenerator = require('../../shared/index').IdGenerator;

class SchedulerController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
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
    const value = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/^on\s+/, '')
      .replace(/\s+/g, ' ');
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

    const morningEveningNightMatch = value.match(/^(in\s+(?:the\s+)?)?(morning|afternoon|evening|night)(?:\s+at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?$/i);
    if (morningEveningNightMatch) {
      const period = morningEveningNightMatch[2].toLowerCase();
      const timePart = morningEveningNightMatch[3] || '';
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);

      if (period === 'morning') {
        dueAt.setHours(timePart ? this._parseClockParts(timePart)?.hours || 9 : 9, timePart ? this._parseClockParts(timePart)?.minutes || 0 : 0, 0, 0);
      } else if (period === 'afternoon') {
        dueAt.setHours(timePart ? this._parseClockParts(timePart)?.hours || 15 : 15, timePart ? this._parseClockParts(timePart)?.minutes || 0 : 0, 0, 0);
      } else if (period === 'evening') {
        dueAt.setHours(timePart ? this._parseClockParts(timePart)?.hours || 18 : 18, timePart ? this._parseClockParts(timePart)?.minutes || 0 : 0, 0, 0);
      } else if (period === 'night') {
        dueAt.setHours(timePart ? this._parseClockParts(timePart)?.hours || 21 : 21, timePart ? this._parseClockParts(timePart)?.minutes || 0 : 0, 0, 0);
      }

      if (dueAt.getTime() <= Date.now()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
      return dueAt;
    }

    const relativeDayMatch = value.match(/^(today|tonight)$/i);
    if (relativeDayMatch) {
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      dueAt.setHours(relativeDayMatch[1] === 'tonight' ? 20 : 9, 0, 0, 0);
      if (relativeDayMatch[1] === 'tomorrow' || dueAt.getTime() <= Date.now()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
      return dueAt;
    }

    const tomorrowMatch = value.match(/^(tomorrow)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?$/i);
    if (tomorrowMatch) {
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      dueAt.setDate(dueAt.getDate() + 1);
      if (tomorrowMatch[2]) {
        const timeParts = this._parseClockParts(tomorrowMatch[2]);
        if (timeParts) {
          dueAt.setHours(timeParts.hours, timeParts.minutes, 0, 0);
        } else {
          dueAt.setHours(9, 0, 0, 0);
        }
      } else {
        dueAt.setHours(9, 0, 0, 0);
      }
      return dueAt;
    }

    const timeThenTomorrowMatch = value.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(tomorrow)$/i);
    if (timeThenTomorrowMatch) {
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      const timeParts = this._parseClockParts(timeThenTomorrowMatch[1]);
      if (timeParts) {
        dueAt.setHours(timeParts.hours, timeParts.minutes, 0, 0);
      } else {
        dueAt.setHours(9, 0, 0, 0);
      }
      dueAt.setDate(dueAt.getDate() + 1);
      if (dueAt.getTime() <= Date.now()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
      return dueAt;
    }

    const timeWithTodayMatch = value.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+today$/i);
    if (timeWithTodayMatch) {
      const timeParts = this._parseClockParts(timeWithTodayMatch[1]);
      if (!timeParts) {
        return null;
      }
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      dueAt.setHours(timeParts.hours, timeParts.minutes, 0, 0);
      if (dueAt.getTime() <= Date.now()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
      return dueAt;
    }

    const todayWithTimeMatch = value.match(/^today\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
    if (todayWithTimeMatch) {
      const timeParts = this._parseClockParts(todayWithTimeMatch[1]);
      if (!timeParts) {
        return null;
      }
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      dueAt.setHours(timeParts.hours, timeParts.minutes, 0, 0);
      if (dueAt.getTime() <= Date.now()) {
        dueAt.setDate(dueAt.getDate() + 1);
      }
      return dueAt;
    }

    const simpleAtTimeMatch = value.match(/^at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
    if (simpleAtTimeMatch && simpleAtTimeMatch[1]) {
      const parsed = this._parseClockParts(simpleAtTimeMatch[1]);
      if (parsed) {
        const dueAt = new Date();
        dueAt.setSeconds(0, 0);
        dueAt.setHours(parsed.hours, parsed.minutes, 0, 0);
        if (dueAt.getTime() <= Date.now()) {
          dueAt.setDate(dueAt.getDate() + 1);
        }
        return dueAt;
      }
    }

    const weekdayMatch = value.match(/^(?:(next)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:at\s+)?)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?$/i);
    if (weekdayMatch) {
      const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = weekdays.indexOf(weekdayMatch[2].toLowerCase());
      const dueAt = new Date();
      dueAt.setSeconds(0, 0);
      const timeParts = this._parseClockParts(weekdayMatch[3] || '9 am');
      if (!timeParts) {
        return null;
      }
      dueAt.setHours(timeParts.hours, timeParts.minutes, 0, 0);
      let daysUntil = (targetDay - dueAt.getDay() + 7) % 7;
      if (daysUntil === 0 || weekdayMatch[1]) {
        daysUntil = daysUntil === 0 ? 7 : daysUntil;
      }
      dueAt.setDate(dueAt.getDate() + daysUntil);
      return dueAt;
    }

    const match = value.match(/^(tomorrow\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) {
      return null;
    }

    const isTomorrow = Boolean(match[1]);
    const parsedClock = this._parseClockParts(`${match[2]}${match[3] ? `:${match[3]}` : ''}${match[4] || ''}`);
    if (!parsedClock) {
      return null;
    }

    const dueAt = new Date();
    dueAt.setSeconds(0, 0);
    dueAt.setHours(parsedClock.hours, parsedClock.minutes, 0, 0);

    if (isTomorrow || dueAt.getTime() <= Date.now()) {
      dueAt.setDate(dueAt.getDate() + 1);
    }

    return dueAt;
  }

  _parseClockParts(value) {
    const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) {
      return null;
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2] || '0', 10);
    const meridiem = match[3] ? match[3].toLowerCase() : null;

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

    return { hours, minutes };
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
