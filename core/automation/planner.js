const fs = require('fs');
const path = require('path');
const {
  buildDataPaths,
  readJsonFile,
  writeJsonAtomic
} = require('../assistant/Data');

const ENTRY_TYPES = new Set(['calendar', 'timetable']);

function normalizeDate(value, fallback = new Date()) {
  const input = String(value || '').trim().toLowerCase();
  const date = new Date(fallback);
  date.setHours(0, 0, 0, 0);

  if (!input || input === 'today') return date.toISOString().slice(0, 10);
  if (input === 'tomorrow') {
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  const iso = input.match(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/);
  if (iso) {
    const parsed = new Date(iso[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = dayNames.findIndex(day => input.includes(day));
  if (dayIndex >= 0) {
    const current = date.getDay();
    let delta = (dayIndex - current + 7) % 7;
    if (delta === 0 || input.includes('next ')) delta += 7;
    date.setDate(date.getDate() + delta);
    return date.toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return '';

  const match = input.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return '';

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || '';
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractDateExpression(text) {
  const input = String(text || '').toLowerCase();
  const match = input.match(/\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{1,2}-\d{1,2})\b/);
  return match ? match[1] : '';
}

function extractTimeExpression(text) {
  const input = String(text || '').toLowerCase();
  const match = input.match(/\b(?:at|from|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/) ||
    input.match(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/) ||
    input.match(/\b(\d{1,2}\s*(?:am|pm))\b/);
  return match ? match[1] : '';
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\b(?:today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{1,2}-\d{1,2})\b/gi, ' ')
    .replace(/\b(?:at|from|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

class PlannerController {
  constructor(config = {}) {
    this.config = config;
    const dataPaths = config?.app?.dataPaths || buildDataPaths(config);
    this.plannerPath = config?.app?.plannerPath || dataPaths.plannerPath;
    this._migrateWorkingDirectoryPlanner(config);
    this.entries = this._loadEntries();
  }

  open(view = 'calendar') {
    return {
      success: true,
      data: {
        view: view === 'timetable' ? 'timetable' : 'calendar',
        count: this.entries.length
      }
    };
  }

  addCalendarEntry(entities = {}, context = {}) {
    return this.addEntry({ ...entities, type: 'calendar' }, context);
  }

  addTimetableEntry(entities = {}, context = {}) {
    return this.addEntry({ ...entities, type: 'timetable' }, context);
  }

  addEntry(entities = {}, context = {}) {
    const type = ENTRY_TYPES.has(entities.type) ? entities.type : 'calendar';
    const sourceText = this._resolveSourceText(entities, context);
    const dateExpression = entities.date || entities.dateExpression || extractDateExpression(sourceText);
    const timeExpression = entities.startTime || entities.timeExpression || extractTimeExpression(sourceText);
    const title = cleanTitle(entities.title || entities.plannerText || sourceText);

    if (!title) {
      return {
        success: false,
        needsClarification: true,
        error: `Tell me what to add to the ${type}.`
      };
    }

    const now = new Date();
    const entry = {
      id: `planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      notes: String(entities.notes || '').trim(),
      date: normalizeDate(dateExpression, now),
      startTime: normalizeTime(timeExpression),
      endTime: normalizeTime(entities.endTime),
      sourceText: String(sourceText || title).trim(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    this.entries.push(entry);
    this._saveEntries();
    return { success: true, data: { entry, view: type, count: this.entries.length } };
  }

  listEntries(options = {}) {
    const type = ENTRY_TYPES.has(options.type) ? options.type : null;
    const date = options.date ? normalizeDate(options.date) : null;
    const entries = this.entries
      .filter(entry => !type || entry.type === type)
      .filter(entry => !date || entry.date === date)
      .sort((a, b) => `${a.date} ${a.startTime || '99:99'}`.localeCompare(`${b.date} ${b.startTime || '99:99'}`));
    return { success: true, data: { entries, count: entries.length } };
  }

  deleteEntry(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter(entry => entry.id !== id);
    if (this.entries.length === before) {
      return { success: false, error: 'Planner entry not found' };
    }
    this._saveEntries();
    return { success: true, data: { id, count: this.entries.length } };
  }

  _resolveSourceText(entities, context) {
    const direct = String(entities.plannerText || entities.title || '').trim();
    if (direct && !/^(?:this|that)$/i.test(direct)) return direct;
    if (entities.reference !== 'previous') return direct;

    const recent = Array.isArray(context?.conversation?.recent) ? context.conversation.recent : [];
    const previous = recent
      .slice()
      .reverse()
      .find(entry => entry?.input && !/\b(?:calendar|timetable|time\s+table)\b/i.test(entry.input));
    return String(previous?.target || previous?.input || context?.conversation?.summaryText || direct).trim();
  }

  _loadEntries() {
    const parsed = readJsonFile(this.plannerPath, [], {
      createIfMissing: false,
      validate: value => Array.isArray(value)
    });
    return Array.isArray(parsed)
      ? parsed.filter(entry => entry && ENTRY_TYPES.has(entry.type) && entry.id && entry.title).slice(-500)
      : [];
  }

  _saveEntries() {
    writeJsonAtomic(this.plannerPath, this.entries.slice(-500), { backup: true });
  }

  _migrateWorkingDirectoryPlanner(config) {
    const shouldMigrate = config?.app?.migrateCwdPlanner === true || !config?.app?.dataDir;
    if (!shouldMigrate) return;

    const sourcePath = path.resolve(process.cwd(), 'planner.json');
    const targetPath = path.resolve(this.plannerPath);
    if (sourcePath === targetPath || !fs.existsSync(sourcePath)) return;

    try {
      const sourceEntries = readJsonFile(sourcePath, [], {
        createIfMissing: false,
        validate: value => Array.isArray(value)
      });
      const targetEntries = readJsonFile(targetPath, [], {
        createIfMissing: false,
        validate: value => Array.isArray(value)
      });
      const merged = [...targetEntries, ...sourceEntries]
        .filter(entry => entry && ENTRY_TYPES.has(entry.type) && entry.id && entry.title)
        .slice(-500);
      writeJsonAtomic(targetPath, merged, { backup: true });
      fs.unlinkSync(sourcePath);
    } catch (_) {
      // Planner migration is best effort; normal loading still uses the managed path.
    }
  }
}

module.exports = PlannerController;
