const symbolEl = document.getElementById('alert-symbol');
const kindEl = document.getElementById('alert-kind');
const titleEl = document.getElementById('alert-title');
const messageEl = document.getElementById('alert-message');
const timeEl = document.getElementById('alert-time');
const snoozeBtn = document.getElementById('snooze-btn');
const stopBtn = document.getElementById('stop-btn');

let currentSchedule = null;

function alertPresentation(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'timer') return { symbol: '⏱️', title: 'Timer complete' };
  if (normalized === 'alarm') return { symbol: '⏰', title: 'Alarm ringing' };
  return { symbol: '📝', title: 'A gentle reminder' };
}

function renderSchedule(schedule) {
  currentSchedule = schedule;
  const kind = schedule?.kind || 'Reminder';
  const presentation = alertPresentation(kind);
  symbolEl.textContent = presentation.symbol;
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
