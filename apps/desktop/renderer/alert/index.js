const symbolEl = document.getElementById('alert-symbol');
const kindEl = document.getElementById('alert-kind');
const titleEl = document.getElementById('alert-title');
const messageEl = document.getElementById('alert-message');
const timeEl = document.getElementById('alert-time');
const snoozeBtn = document.getElementById('snooze-btn');
const stopBtn = document.getElementById('stop-btn');

let currentSchedule = null;
let audioContext = null;
let soundInterval = null;
let activeTones = [];

function getAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audioContext = new Context();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function stopAlertSound() {
  if (soundInterval) {
    clearInterval(soundInterval);
    soundInterval = null;
  }
  activeTones.forEach(tone => {
    try {
      tone.stop();
    } catch (_) {}
  });
  activeTones = [];
}

function playTone(frequency, delay, duration, gainValue = 0.08) {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + delay;
  const stopAt = startAt + duration;

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.03);
  activeTones.push(oscillator);
  oscillator.onended = () => {
    activeTones = activeTones.filter(tone => tone !== oscillator);
  };
}

function playScheduleSound(kind) {
  const normalized = String(kind || '').toLowerCase();
  const pattern = normalized === 'alarm'
    ? [[880, 0, 0.16], [660, 0.22, 0.16], [880, 0.44, 0.22]]
    : normalized === 'timer'
      ? [[640, 0, 0.14], [820, 0.18, 0.18]]
      : null;
  if (!pattern) return;
  stopAlertSound();
  const playPattern = () => pattern.forEach(([frequency, delay, duration]) => playTone(frequency, delay, duration));
  playPattern();
  soundInterval = setInterval(playPattern, normalized === 'alarm' ? 1200 : 2200);
}

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
  playScheduleSound(kind);
  document.title = `${kind} · OpenX`;
}

async function act(action) {
  if (!currentSchedule) return;
  stopAlertSound();
  const id = currentSchedule.id || currentSchedule.taskName;
  if (window.jarvis?.handleScheduleAlert) {
    await window.jarvis.handleScheduleAlert(id, action, 5);
  } else {
    window.close();
  }
}

snoozeBtn.addEventListener('click', () => act('snooze'));
stopBtn.addEventListener('click', () => act('stop'));
window.addEventListener('beforeunload', stopAlertSound);
window.jarvis?.onScheduleDue?.(renderSchedule);
