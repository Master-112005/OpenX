const symbolEl = document.getElementById('alert-symbol');
const kindEl = document.getElementById('alert-kind');
const titleEl = document.getElementById('alert-title');
const messageEl = document.getElementById('alert-message');
const timeEl = document.getElementById('alert-time');
const snoozeBtn = document.getElementById('snooze-btn');
const stopBtn = document.getElementById('stop-btn');

let currentSchedule = null;

function inferReminderCategory(message, category = '') {
  const preferred = String(category || '').toLowerCase();
  if (preferred) return preferred;
  const text = String(message || '').toLowerCase();
  if (/\b(?:college|collage|school|class|lecture|campus|study|exam|assignment|homework)\b/.test(text)) return 'education';
  if (/\b(?:water|hydrate|hydration|drink)\b/.test(text)) return 'water';
  if (/\b(?:exercise|workout|gym|walk|run|yoga|stretch|fitness)\b/.test(text)) return 'exercise';
  if (/\b(?:medicine|medication|tablet|pill|doctor|health)\b/.test(text)) return 'health';
  if (/\b(?:work|office|meeting|project|deadline|client|email)\b/.test(text)) return 'work';
  if (/\b(?:birthday|anniversary|party)\b/.test(text)) return 'birthday';
  return 'general';
}

function alertPresentation(kind, category = '', message = '') {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'timer') return { symbol: '⏱️', title: 'Timer complete' };
  if (normalized === 'alarm') return { symbol: '⏰', title: 'Alarm ringing' };
  const presentations = {
    education: { symbol: '🎓', title: 'School & college reminder' },
    water: { symbol: '💧', title: 'Water reminder' },
    exercise: { symbol: '🏃', title: 'Exercise reminder' },
    health: { symbol: '💊', title: 'Health reminder' },
    work: { symbol: '💼', title: 'Work reminder' },
    birthday: { symbol: '🎂', title: 'Birthday reminder' },
    general: { symbol: '📝', title: 'A gentle reminder' }
  };
  return presentations[inferReminderCategory(message, category)] || presentations.general;
}

function renderSchedule(schedule) {
  currentSchedule = schedule;
  const kind = schedule?.kind || 'Reminder';
  const presentation = alertPresentation(kind, schedule?.category, schedule?.message);
  symbolEl.textContent = schedule?.symbol || presentation.symbol;
  kindEl.textContent = kind;
  titleEl.textContent = presentation.title;
  messageEl.textContent = schedule?.message || 'It is time.';
  const dueAt = new Date(schedule?.dueAt);
  timeEl.textContent = Number.isNaN(dueAt.getTime())
    ? ''
    : dueAt.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  document.title = `${kind} · OpenX`;
}

async function act(action) {
  if (!currentSchedule) return;
  const id = currentSchedule.id || currentSchedule.taskName;
  if (window.jarvis?.handleScheduleAlert) {
    await window.jarvis.handleScheduleAlert(id, action, 5);
  } else {
    window.close();
  }
}

snoozeBtn.addEventListener('click', () => act('snooze'));
stopBtn.addEventListener('click', () => act('stop'));
window.jarvis?.onScheduleDue?.(renderSchedule);
