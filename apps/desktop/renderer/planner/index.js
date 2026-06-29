const shellEl = document.querySelector('.planner-shell');
const calendarTabEl = document.getElementById('calendar-tab');
const timetableTabEl = document.getElementById('timetable-tab');
const closeWindowEl = document.getElementById('close-window');
const monthTitleEl = document.getElementById('month-title');
const currentPeriodEl = document.getElementById('current-period');
const monthGridEl = document.getElementById('month-grid');
const agendaListEl = document.getElementById('agenda-list');
const agendaCountEl = document.getElementById('agenda-count');
const sidePanelEl = document.getElementById('side-panel');
const quickAddToggleEl = document.getElementById('quick-add-toggle');
const quickAddCloseEl = document.getElementById('quick-add-close');
const quickAddEl = document.getElementById('quick-add');
const quickAddSubmitEl = document.getElementById('quick-add-submit');
const entryTitleEl = document.getElementById('entry-title');
const entryDateEl = document.getElementById('entry-date');
const entryTimeEl = document.getElementById('entry-time');
const entryNotesEl = document.getElementById('entry-notes');
const prevMonthEl = document.getElementById('prev-month');
const nextMonthEl = document.getElementById('next-month');
const todayButtonEl = document.getElementById('today-button');
const timetableDateEl = document.getElementById('timetable-date');
const timeGridEl = document.getElementById('time-grid');

let entries = [];
let currentView = 'calendar';
let selectedDateKey = '';
let visibleMonth = new Date();
visibleMonth.setDate(1);

function localDateKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseDateKey(key) {
  const parts = String(key || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateLabel(key) {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function formatTime(value) {
  if (!value) return 'Any time';
  const [hour, minute] = String(value).split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return new Date(2026, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function sortEntries(list) {
  return list.slice().sort((a, b) =>
    `${a.date || ''} ${a.startTime || '99:99'} ${a.title || ''}`
      .localeCompare(`${b.date || ''} ${b.startTime || '99:99'} ${b.title || ''}`));
}

function entriesForDate(dateKey, type = null) {
  return sortEntries(entries.filter(entry =>
    entry.date === dateKey && (!type || entry.type === type)));
}

function setView(view) {
  currentView = view === 'timetable' ? 'timetable' : 'calendar';
  shellEl.dataset.view = currentView;
  calendarTabEl.classList.toggle('active', currentView === 'calendar');
  timetableTabEl.classList.toggle('active', currentView === 'timetable');
  calendarTabEl.setAttribute('aria-pressed', String(currentView === 'calendar'));
  timetableTabEl.setAttribute('aria-pressed', String(currentView === 'timetable'));
  render();
}

function setQuickAddOpen(open) {
  sidePanelEl.hidden = !open;
  sidePanelEl.classList.toggle('open', open);
  quickAddToggleEl.classList.toggle('active', open);
  quickAddToggleEl.setAttribute('aria-expanded', String(open));
  if (open) {
    entryTitleEl.focus();
  }
}

function applyGlassTint(value, themeId = 'graphite') {
  const tint = Math.max(0, Math.min(100, Number(value) || 0));
  const strength = tint / 100;
  const tones = {
    graphite: [48, 50, 58],
    'white-glass': [255, 255, 255],
    'black-glass': [0, 0, 0]
  };
  const [red, green, blue] = tones[themeId] || tones.graphite;
  const useDarkText = themeId === 'white-glass' && tint >= 28;
  const textColor = useDarkText ? '#161619' : '#f8f8fa';
  const mutedColor = useDarkText ? 'rgba(22, 22, 25, 0.68)' : 'rgba(255, 255, 255, 0.72)';
  const controlTone = useDarkText ? '0, 0, 0' : '255, 255, 255';
  const borderTone = useDarkText ? '0, 0, 0' : '255, 255, 255';
  const formatAlpha = value => Math.min(0.96, value).toFixed(3);
  const shellAlpha = useDarkText ? 0.78 + (strength * 0.14) : 0.72 + (strength * 0.2);
  const surfaceAlpha = useDarkText ? 0.2 + (strength * 0.16) : 0.12 + (strength * 0.16);
  const surfaceStrongAlpha = useDarkText ? 0.28 + (strength * 0.18) : 0.18 + (strength * 0.2);
  const borderAlpha = 0.18 + (strength * 0.14);
  const controlAlpha = 0.12 + (strength * 0.1);
  const controlStrongAlpha = 0.18 + (strength * 0.12);
  const quickAddAlpha = useDarkText ? 0.9 + (strength * 0.06) : 0.84 + (strength * 0.1);
  const quickAddControlAlpha = useDarkText ? 0.16 + (strength * 0.08) : 0.16 + (strength * 0.1);
  const root = document.documentElement;
  root.style.setProperty('--adaptive-shell', `rgba(${red}, ${green}, ${blue}, ${formatAlpha(shellAlpha)})`);
  root.style.setProperty('--adaptive-surface', `rgba(${red}, ${green}, ${blue}, ${formatAlpha(surfaceAlpha)})`);
  root.style.setProperty('--adaptive-surface-strong', `rgba(${red}, ${green}, ${blue}, ${formatAlpha(surfaceStrongAlpha)})`);
  root.style.setProperty('--adaptive-border', `rgba(${borderTone}, ${formatAlpha(borderAlpha)})`);
  root.style.setProperty('--adaptive-text', textColor);
  root.style.setProperty('--adaptive-muted', mutedColor);
  root.style.setProperty('--adaptive-control', `rgba(${controlTone}, ${formatAlpha(controlAlpha)})`);
  root.style.setProperty('--adaptive-control-strong', `rgba(${controlTone}, ${formatAlpha(controlStrongAlpha)})`);
  root.style.setProperty('--quick-add-shell', `rgba(${red}, ${green}, ${blue}, ${formatAlpha(quickAddAlpha)})`);
  root.style.setProperty('--quick-add-control', `rgba(${controlTone}, ${formatAlpha(quickAddControlAlpha)})`);
  root.style.setProperty('--adaptive-text-shadow', useDarkText ? '0 1px 2px rgba(255, 255, 255, 0.38)' : '0 1px 3px rgba(0, 0, 0, 0.72)');
  root.style.setProperty('--text-color', textColor);
  root.style.setProperty('--muted-color', mutedColor);
  root.dataset.glassContrast = useDarkText ? 'dark-text' : 'light-text';
}

function applySettingsTheme(snapshot) {
  const themeId = snapshot?.settings?.chat?.themeId || 'graphite';
  const theme = (snapshot?.availableThemes || []).find(entry => entry.id === themeId)
    || snapshot?.availableThemes?.[0];
  if (!theme?.colors) return;
  const root = document.documentElement;
  root.style.setProperty('--panel-bg', theme.colors.panel);
  root.style.setProperty('--surface-bg', theme.colors.surface);
  root.style.setProperty('--surface-strong', theme.colors.surfaceStrong);
  root.style.setProperty('--border-color', theme.colors.border);
  root.style.setProperty('--text-color', theme.colors.text);
  root.style.setProperty('--muted-color', theme.colors.muted);
  root.style.setProperty('--accent-color', theme.colors.accent);
  root.style.setProperty('--accent', theme.colors.accent);
  root.dataset.glassTheme = theme.id;
  applyGlassTint(snapshot?.settings?.chat?.glassTint ?? 42, theme.id);
}

async function loadTheme() {
  const snapshot = await window.jarvis?.getSettings?.();
  applySettingsTheme(snapshot);
}

function renderMonth() {
  const monthName = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  monthTitleEl.textContent = monthName;
  currentPeriodEl.textContent = currentView === 'calendar' ? monthName : formatDateLabel(timetableDateEl.value);

  const first = new Date(visibleMonth);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const todayKey = localDateKey(new Date());
  const monthIndex = visibleMonth.getMonth();
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);
    const dayEntries = entriesForDate(key, 'calendar');
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day-cell';
    if (date.getMonth() !== monthIndex) cell.classList.add('outside');
    if (key === todayKey) cell.classList.add('today');
    if (key === selectedDateKey) cell.classList.add('selected');
    cell.dataset.date = key;
    const numberWrap = document.createElement('span');
    numberWrap.className = 'day-number';
    const number = document.createElement('span');
    number.textContent = String(date.getDate());
    numberWrap.appendChild(number);
    if (dayEntries.length) {
      const dot = document.createElement('span');
      dot.className = 'day-dot';
      numberWrap.appendChild(dot);
    }
    const itemWrap = document.createElement('span');
    itemWrap.className = 'day-items';
    dayEntries.slice(0, 3).forEach(entry => {
      const item = document.createElement('span');
      item.className = 'day-item';
      item.textContent = `${entry.startTime ? `${formatTime(entry.startTime)} ` : ''}${entry.title}`;
      itemWrap.appendChild(item);
    });
    cell.append(numberWrap, itemWrap);
    cell.addEventListener('click', () => {
      selectedDateKey = key;
      entryDateEl.value = key;
      timetableDateEl.value = key;
      monthGridEl.querySelectorAll('.day-cell.selected').forEach(day => day.classList.remove('selected'));
      cell.classList.add('selected');
      cell.classList.add('clicked');
      window.setTimeout(() => cell.classList.remove('clicked'), 180);
      renderAgenda();
    });
    cells.push(cell);
  }

  monthGridEl.replaceChildren(...cells);
}

function renderTimetable() {
  const selectedDate = timetableDateEl.value || localDateKey(new Date());
  currentPeriodEl.textContent = formatDateLabel(selectedDate);
  const dayEntries = entriesForDate(selectedDate);
  const rows = [];

  for (let hour = 5; hour <= 23; hour += 1) {
    const row = document.createElement('div');
    row.className = 'time-row';
    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = formatTime(`${String(hour).padStart(2, '0')}:00`);
    const slot = document.createElement('div');
    slot.className = 'time-slot';
    dayEntries
      .filter(entry => {
        if (!entry.startTime && hour === 5) return true;
        return Number(String(entry.startTime || '').slice(0, 2)) === hour;
      })
      .forEach(entry => {
        const item = document.createElement('div');
        item.className = 'slot-entry';
        item.textContent = `${entry.startTime ? `${formatTime(entry.startTime)} - ` : ''}${entry.title}`;
        slot.appendChild(item);
      });
    row.append(label, slot);
    rows.push(row);
  }

  timeGridEl.replaceChildren(...rows);
}

function renderAgenda() {
  const focusDate = currentView === 'timetable'
    ? timetableDateEl.value
    : (entryDateEl.value || localDateKey(new Date()));
  const visible = sortEntries(entries.filter(entry => !focusDate || entry.date === focusDate));
  agendaCountEl.textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No entries for this day.';
    agendaListEl.replaceChildren(empty);
    return;
  }

  agendaListEl.replaceChildren(...visible.map(entry => {
    const card = document.createElement('article');
    card.className = 'agenda-card';
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const time = document.createElement('time');
    time.textContent = `${formatDateLabel(entry.date)} | ${formatTime(entry.startTime)} | ${entry.type === 'timetable' ? 'Timetable' : 'Calendar'}`;
    const notes = document.createElement('p');
    notes.textContent = entry.notes || entry.sourceText || '';
    const actions = document.createElement('div');
    actions.className = 'agenda-actions';
    const remove = document.createElement('button');
    remove.className = 'delete-entry';
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      await window.jarvis?.deletePlannerEntry?.(entry.id);
      await refreshEntries();
    });
    actions.appendChild(remove);
    card.append(title, time);
    if (notes.textContent) card.appendChild(notes);
    card.appendChild(actions);
    return card;
  }));
}

function render() {
  renderMonth();
  renderTimetable();
  renderAgenda();
}

async function refreshEntries() {
  const result = await window.jarvis?.getPlannerEntries?.();
  entries = Array.isArray(result?.data?.entries) ? result.data.entries : [];
  render();
}

quickAddEl.addEventListener('submit', async event => {
  event.preventDefault();
  const title = entryTitleEl.value.trim();
  if (!title) {
    entryTitleEl.focus();
    return;
  }
  quickAddSubmitEl.disabled = true;
  quickAddSubmitEl.setAttribute('aria-busy', 'true');
  const type = currentView === 'timetable' ? 'timetable' : 'calendar';
  try {
    const result = await window.jarvis?.addPlannerEntry?.({
      type,
      title,
      date: entryDateEl.value || timetableDateEl.value || localDateKey(new Date()),
      startTime: entryTimeEl.value,
      notes: entryNotesEl.value.trim()
    });
    if (result?.success) {
      entryTitleEl.value = '';
      entryNotesEl.value = '';
      setQuickAddOpen(false);
      await refreshEntries();
    }
  } finally {
    quickAddSubmitEl.disabled = false;
    quickAddSubmitEl.removeAttribute('aria-busy');
  }
});

quickAddToggleEl.addEventListener('click', () => setQuickAddOpen(sidePanelEl.hidden));
quickAddCloseEl.addEventListener('click', () => setQuickAddOpen(false));
calendarTabEl.addEventListener('click', () => setView('calendar'));
timetableTabEl.addEventListener('click', () => setView('timetable'));
prevMonthEl.addEventListener('click', () => {
  visibleMonth.setMonth(visibleMonth.getMonth() - 1);
  render();
});
nextMonthEl.addEventListener('click', () => {
  visibleMonth.setMonth(visibleMonth.getMonth() + 1);
  render();
});
todayButtonEl.addEventListener('click', () => {
  const today = new Date();
  visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  entryDateEl.value = localDateKey(today);
  timetableDateEl.value = localDateKey(today);
  render();
});
timetableDateEl.addEventListener('change', () => {
  entryDateEl.value = timetableDateEl.value;
  render();
});
closeWindowEl.addEventListener('click', () => window.jarvis?.closePlanner?.());

window.jarvis?.onPlannerView?.(view => setView(view));
window.jarvis?.onPlannerEntriesChanged?.(payload => {
  entries = Array.isArray(payload?.entries) ? payload.entries : entries;
  if (payload?.view) setView(payload.view);
  render();
});

const todayKey = localDateKey(new Date());
selectedDateKey = todayKey;
entryDateEl.value = todayKey;
timetableDateEl.value = todayKey;
loadTheme();
window.jarvis?.onSettingsChanged?.(snapshot => applySettingsTheme(snapshot));
refreshEntries();
