const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Logger = require('../assistant/Data').Logger;
const IdGenerator = require('../assistant/Data').IdGenerator;
const { EVENTS } = require('../assistant/Data');

const REMINDER_PRESENTATIONS = Object.freeze({
  education: { symbol: '\u{1F393}', label: 'School & college' },
  water: { symbol: '\u{1F4A7}', label: 'Water' },
  exercise: { symbol: '\u{1F3C3}', label: 'Exercise' },
  health: { symbol: '\u{1F48A}', label: 'Health' },
  work: { symbol: '\u{1F4BC}', label: 'Work' },
  birthday: { symbol: '\u{1F382}', label: 'Birthday' },
  general: { symbol: '\u{1F4DD}', label: 'Reminder' }
});

function inferReminderCategory(message, preferredCategory = '') {
  const preferred = String(preferredCategory || '').trim().toLowerCase();
  if (REMINDER_PRESENTATIONS[preferred]) return preferred;
  const text = String(message || '').toLowerCase();
  if (/\b(?:college|collage|school|class|lecture|campus|study|exam|assignment|homework|tuition)\b/.test(text)) return 'education';
  if (/\b(?:water|hydrate|hydration|drink)\b/.test(text)) return 'water';
  if (/\b(?:exercise|workout|gym|walk|run|running|yoga|stretch|fitness)\b/.test(text)) return 'exercise';
  if (/\b(?:medicine|medication|tablet|pill|doctor|appointment|health)\b/.test(text)) return 'health';
  if (/\b(?:work|office|meeting|project|deadline|client|email)\b/.test(text)) return 'work';
  if (/\b(?:birthday|anniversary|celebrate|party)\b/.test(text)) return 'birthday';
  return 'general';
}

class SchedulerController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.eventBus = config?.eventBus || null;
    this.schedulePath = path.join(config?.app?.dataDir || process.cwd(), 'schedules.json');
    this.scheduledItems = this._loadScheduledItems();
    this.timers = new Map();
    this._cleanupLegacyWindowsTasks(config);
    this.scheduledItems.filter(item => item.status === 'scheduled').forEach(item => this._arm(item));
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
      dueAt,
      category: 'timer',
      symbol: '\u23F1\uFE0F',
      metadata: {
        durationMinutes,
        durationMs: durationMinutes * 60 * 1000
      }
    });
  }

  startStopwatch() {
    const existing = this._latestSchedule('Stopwatch', ['running', 'paused']);
    if (existing) {
      return { success: true, data: this._stopwatchData(existing) };
    }

    const taskName = `JARVIS_Stopwatch_${IdGenerator.short()}`;
    const now = new Date().toISOString();
    const item = {
      id: taskName,
      taskName,
      kind: 'Stopwatch',
      title: 'JARVIS Stopwatch',
      message: 'Stopwatch is running.',
      category: 'stopwatch',
      symbol: '\u23F1\uFE0F',
      status: 'running',
      startedAt: now,
      elapsedMs: 0,
      createdAt: now
    };
    this.scheduledItems.push(item);
    this._saveScheduledItems();
    return { success: true, data: this._stopwatchData(item) };
  }

  pauseStopwatch() {
    const item = this._latestSchedule('Stopwatch', ['running']);
    if (!item) return { success: false, error: 'No running stopwatch found' };
    item.elapsedMs = this._stopwatchElapsedMs(item);
    item.status = 'paused';
    delete item.startedAt;
    this._saveScheduledItems();
    return { success: true, data: this._stopwatchData(item) };
  }

  resumeStopwatch() {
    const item = this._latestSchedule('Stopwatch', ['paused']);
    if (!item) return { success: false, error: 'No paused stopwatch found' };
    item.startedAt = new Date().toISOString();
    item.status = 'running';
    this._saveScheduledItems();
    return { success: true, data: this._stopwatchData(item) };
  }

  resetStopwatch() {
    const item = this._latestSchedule('Stopwatch', ['running', 'paused']);
    if (!item) return this.startStopwatch();
    const wasRunning = item.status === 'running';
    item.elapsedMs = 0;
    if (wasRunning) {
      item.startedAt = new Date().toISOString();
      item.status = 'running';
    } else {
      item.status = 'paused';
      delete item.startedAt;
    }
    this._saveScheduledItems();
    return { success: true, data: this._stopwatchData(item) };
  }

  stopStopwatch() {
    const item = this._latestSchedule('Stopwatch', ['running', 'paused']);
    if (!item) return { success: false, error: 'No active stopwatch found' };
    item.elapsedMs = this._stopwatchElapsedMs(item);
    item.status = 'completed';
    delete item.startedAt;
    this._saveScheduledItems();
    return { success: true, data: this._stopwatchData(item) };
  }

  getStopwatchElapsed() {
    const item = this._latestSchedule('Stopwatch', ['running', 'paused']);
    if (!item) return { success: false, error: 'No active stopwatch found' };
    return { success: true, data: this._stopwatchData(item) };
  }

  setAlarm(timeExpression, alarmLabel = '') {
    const dueAt = this._parseTimeExpression(timeExpression);
    if (!dueAt) {
      return { success: false, error: 'Invalid alarm time' };
    }

    const label = String(alarmLabel || '').trim();
    return this._scheduleNotification({
      kind: 'Alarm',
      title: label ? `JARVIS Alarm: ${label}` : 'JARVIS Alarm',
      message: label || `Alarm for ${timeExpression} is ringing.`,
      dueAt,
      category: 'alarm',
      symbol: '\u23F0',
      metadata: label ? { alarmLabel: label } : {}
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
    } else if (options.recurrence) {
      dueAt = this._nextRecurringDate(options.recurrence, new Date());
    }

    if (!dueAt) {
      return { success: false, error: 'Invalid reminder time' };
    }

    const category = inferReminderCategory(message, options.category);
    const presentation = REMINDER_PRESENTATIONS[category];
    return this._scheduleNotification({
      kind: 'Reminder',
      title: `JARVIS ${presentation.label} Reminder`,
      message,
      dueAt,
      category,
      symbol: presentation.symbol,
      metadata: options.recurrence ? { recurrence: options.recurrence } : {}
    });
  }

  _parseTimeExpression(input) {
    const value = this._normalizeSpokenTime(String(input || ''))
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

    const tomorrowPeriodMatch = value.match(/^tomorrow\s+(?:in\s+the\s+)?(morning|afternoon|evening|night)$/i);
    if (tomorrowPeriodMatch) {
      const hours = { morning: 9, afternoon: 15, evening: 18, night: 21 };
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 1);
      dueAt.setHours(hours[tomorrowPeriodMatch[1].toLowerCase()], 0, 0, 0);
      return dueAt;
    }

    if (/^next\s+week$/i.test(value)) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 7);
      dueAt.setHours(9, 0, 0, 0);
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

  _normalizeSpokenTime(input) {
    const numbers = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
    };
    let value = String(input || '').trim().toLowerCase();
    value = value.replace(/\bnoon\b/g, '12 pm').replace(/\bmidnight\b/g, '12 am');
    value = value.replace(/\bhalf\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (_, hour) => `${numbers[hour]}:30`);
    value = value.replace(/\bquarter\s+past\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (_, hour) => `${numbers[hour]}:15`);
    value = value.replace(/\bquarter\s+to\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
      (_, hour) => `${numbers[hour] === 1 ? 12 : numbers[hour] - 1}:45`);
    value = value.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s*(?:am|pm|today|tomorrow|$))/g,
      (_, hour) => String(numbers[hour]));
    return value.replace(/\bo['’]?clock\b/g, '').replace(/\s+/g, ' ').trim();
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

  _scheduleNotification({ kind, title, message, dueAt, category = null, symbol = null, metadata = {} }) {
    try {
      const taskName = `JARVIS_${kind}_${IdGenerator.short()}`;
      const item = {
        id: taskName,
        taskName,
        kind,
        title,
        message,
        category: category || String(kind || '').toLowerCase(),
        symbol: symbol || null,
        ...metadata,
        dueAt: dueAt.toISOString(),
        status: 'scheduled',
        createdAt: new Date().toISOString()
      };
      this.scheduledItems.push(item);
      this._saveScheduledItems();
      this._arm(item);

      return {
        success: true,
        data: {
          taskName,
          dueAt: item.dueAt,
          kind,
          title: item.title,
          message: item.message,
          category: item.category,
          symbol: item.symbol,
          id: item.id,
          durationMinutes: item.durationMinutes,
          durationMs: item.durationMs
        }
      };
    } catch (err) {
      this.logger.error(`Failed to schedule ${kind.toLowerCase()}`, err);
      return { success: false, error: `Could not schedule ${kind.toLowerCase()}` };
    }
  }

  _loadScheduledItems() {
    try {
      if (!fs.existsSync(this.schedulePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.schedulePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.logger.warn('Could not load persisted schedules', error.message);
      return [];
    }
  }

  _cleanupLegacyWindowsTasks(config) {
    if (process.platform !== 'win32' || !config?.app?.dataDir || config.app.cleanupLegacySchedules === false) return;
    const script = "Get-ScheduledTask -TaskName 'JARVIS_*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
    child.once('error', error => this.logger.warn('Could not clean up legacy schedules', error.message));
    child.unref();
  }

  _saveScheduledItems() {
    const directory = path.dirname(this.schedulePath);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(this.schedulePath, JSON.stringify(this.scheduledItems.slice(-100), null, 2), 'utf8');
  }

  _arm(item) {
    if (!item?.id || item.status !== 'scheduled') return;
    const existing = this.timers.get(item.id);
    if (existing) clearTimeout(existing);
    const remaining = new Date(item.dueAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const delay = Math.max(0, Math.min(remaining, 2147483647));
    const timer = setTimeout(() => {
      this.timers.delete(item.id);
      if (remaining > 2147483647) {
        this._arm(item);
        return;
      }
      this._publishDue(item);
    }, delay);
    this.timers.set(item.id, timer);
  }

  _publishDue(item) {
    if (!item || item.status !== 'scheduled') return;
    item.status = 'due';
    this._saveScheduledItems();
    this.eventBus?.publish?.(EVENTS.SCHEDULE_DUE, { ...item });
  }

  snooze(id, minutes = 5) {
    const item = this.scheduledItems.find(entry => entry.id === id || entry.taskName === id);
    if (!item) return { success: false, error: 'Schedule not found' };
    item.status = 'scheduled';
    item.dueAt = new Date(Date.now() + (Math.max(1, Number(minutes) || 5) * 60 * 1000)).toISOString();
    this._saveScheduledItems();
    this._arm(item);
    return { success: true, data: { ...item } };
  }

  complete(id) {
    const item = this.scheduledItems.find(entry => entry.id === id || entry.taskName === id);
    if (!item) return { success: false, error: 'Schedule not found' };
    const timer = this.timers.get(item.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(item.id);
    if (item.recurrence) {
      item.dueAt = this._nextRecurringDate(item.recurrence, new Date(item.dueAt)).toISOString();
      item.status = 'scheduled';
      this._arm(item);
    } else {
      item.status = 'completed';
    }
    this._saveScheduledItems();
    return { success: true, data: { ...item } };
  }

  pauseActiveTimer() {
    const item = this._latestSchedule('Timer', ['scheduled']);
    if (!item) return { success: false, error: 'No active timer found' };
    const timer = this.timers.get(item.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(item.id);
    item.remainingMs = Math.max(0, new Date(item.dueAt).getTime() - Date.now());
    item.status = 'paused';
    this._saveScheduledItems();
    return { success: true, data: { ...item } };
  }

  resumeActiveTimer() {
    const item = this._latestSchedule('Timer', ['paused']);
    if (!item) return { success: false, error: 'No paused timer found' };
    item.dueAt = new Date(Date.now() + Math.max(1000, Number(item.remainingMs) || 1000)).toISOString();
    item.status = 'scheduled';
    delete item.remainingMs;
    this._saveScheduledItems();
    this._arm(item);
    return { success: true, data: { ...item } };
  }

  resetActiveTimer() {
    const item = this._latestSchedule('Timer', ['scheduled', 'paused', 'due']);
    if (!item || !item.durationMinutes) return { success: false, error: 'No resettable timer found' };
    const timer = this.timers.get(item.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(item.id);
    item.dueAt = new Date(Date.now() + Number(item.durationMinutes) * 60000).toISOString();
    item.status = 'scheduled';
    delete item.remainingMs;
    this._saveScheduledItems();
    this._arm(item);
    return { success: true, data: { ...item } };
  }

  getRemainingTimer() {
    const item = this._latestSchedule('Timer', ['scheduled', 'paused']);
    if (!item) return { success: false, error: 'No active timer found' };
    const remainingMs = item.status === 'paused'
      ? Number(item.remainingMs) || 0
      : Math.max(0, new Date(item.dueAt).getTime() - Date.now());
    return { success: true, data: { ...item, remainingMs, remainingMinutes: Math.max(0, Math.ceil(remainingMs / 60000)) } };
  }

  getTimerWidgetState(preferredId = null) {
    const timer = this._activeTimerForWidget(preferredId);
    const stopwatch = this._activeStopwatchForWidget(preferredId);
    const active = [timer, stopwatch]
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
    if (!active) {
      return { visible: false };
    }

    if (String(active.kind || '').toLowerCase() === 'stopwatch') {
      return {
        visible: true,
        mode: 'stopwatch',
        id: active.id,
        taskName: active.taskName,
        status: active.status,
        elapsedMs: this._stopwatchElapsedMs(active),
        title: active.title || 'Stopwatch',
        createdAt: active.createdAt
      };
    }

    const durationMs = Math.max(1000, Number(active.durationMs) || Number(active.durationMinutes) * 60000 || 1000);
    const remainingMs = active.status === 'paused'
      ? Math.max(0, Number(active.remainingMs) || 0)
      : Math.max(0, new Date(active.dueAt).getTime() - Date.now());
    return {
      visible: true,
      mode: 'timer',
      id: active.id,
      taskName: active.taskName,
      status: active.status,
      dueAt: active.dueAt,
      durationMs,
      remainingMs,
      title: active.title || 'Timer',
      createdAt: active.createdAt
    };
  }

  listSchedules(kind = null, scope = 'active') {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const now = new Date();
    const entries = this.scheduledItems.filter(item => {
      if (normalizedKind && String(item.kind || '').toLowerCase() !== normalizedKind) return false;
      if (scope === 'today') {
        const due = new Date(item.dueAt);
        return due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
      }
      if (scope === 'all') return item.status !== 'dismissed';
      return ['scheduled', 'paused', 'due'].includes(item.status);
    });
    return { success: true, data: { kind: kind || 'Schedule', scope, count: entries.length, entries: entries.map(item => ({ ...item })) } };
  }

  cancelLatest(kind) {
    const item = this._latestSchedule(kind, ['scheduled', 'paused', 'due']);
    if (!item) return { success: false, error: `No active ${String(kind || 'schedule').toLowerCase()} found` };
    return this.complete(item.id);
  }

  clearSchedules(kind) {
    const normalizedKind = String(kind || '').toLowerCase();
    const targets = this.scheduledItems.filter(item =>
      String(item.kind || '').toLowerCase() === normalizedKind && ['scheduled', 'paused', 'due'].includes(item.status));
    for (const item of targets) {
      const timer = this.timers.get(item.id);
      if (timer) clearTimeout(timer);
      this.timers.delete(item.id);
      item.status = 'completed';
    }
    this._saveScheduledItems();
    return { success: true, data: { kind, count: targets.length } };
  }

  snoozeLatestAlarm(minutes = 5) {
    const item = this._latestSchedule('Alarm', ['scheduled', 'due']);
    return item ? this.snooze(item.id, minutes) : { success: false, error: 'No active alarm found' };
  }

  snoozeLatestReminder(minutes = 5) {
    const item = this._latestSchedule('Reminder', ['scheduled', 'due']);
    return item ? this.snooze(item.id, minutes) : { success: false, error: 'No active reminder found' };
  }

  _latestSchedule(kind, statuses) {
    const normalizedKind = String(kind || '').toLowerCase();
    return this.scheduledItems
      .slice()
      .reverse()
      .find(item => String(item.kind || '').toLowerCase() === normalizedKind && statuses.includes(item.status)) || null;
  }

  _activeTimerForWidget(preferredId = null) {
    const active = this.scheduledItems.filter(item =>
      String(item.kind || '').toLowerCase() === 'timer' && ['scheduled', 'paused'].includes(item.status));
    if (preferredId) {
      const preferred = active.find(item => item.id === preferredId || item.taskName === preferredId);
      if (preferred) return preferred;
    }
    return active.slice().reverse()[0] || null;
  }

  _activeStopwatchForWidget(preferredId = null) {
    const active = this.scheduledItems.filter(item =>
      String(item.kind || '').toLowerCase() === 'stopwatch' && ['running', 'paused'].includes(item.status));
    if (preferredId) {
      const preferred = active.find(item => item.id === preferredId || item.taskName === preferredId);
      if (preferred) return preferred;
    }
    return active.slice().reverse()[0] || null;
  }

  _stopwatchElapsedMs(item) {
    const base = Math.max(0, Number(item?.elapsedMs) || 0);
    if (!item || item.status !== 'running') return base;
    const startedAt = new Date(item.startedAt).getTime();
    if (!Number.isFinite(startedAt)) return base;
    return base + Math.max(0, Date.now() - startedAt);
  }

  _stopwatchData(item) {
    return {
      ...item,
      elapsedMs: this._stopwatchElapsedMs(item)
    };
  }

  _nextRecurringDate(recurrence, fromDate = new Date()) {
    const next = new Date(Math.max(Date.now(), fromDate.getTime()));
    const key = String(recurrence || '').toLowerCase();
    if (key === 'hourly' || key === 'every-2-hours') {
      next.setTime(next.getTime() + (key === 'hourly' ? 1 : 2) * 3600000);
      return next;
    }
    if (key === 'weekly') {
      next.setDate(next.getDate() + 7);
      return next;
    }
    next.setDate(next.getDate() + 1);
    if (key.startsWith('weekday')) {
      while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    }
    if (key.includes('morning')) next.setHours(9, 0, 0, 0);
    else if (key.includes('evening')) next.setHours(18, 0, 0, 0);
    else if (key.includes('night')) next.setHours(21, 0, 0, 0);
    return next;
  }

  destroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

module.exports = SchedulerController;
module.exports.inferReminderCategory = inferReminderCategory;
module.exports.REMINDER_PRESENTATIONS = REMINDER_PRESENTATIONS;
