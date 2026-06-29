const widgetEl = document.getElementById('widget');
const closeBtn = document.getElementById('close-btn');
const timeValueEl = document.getElementById('time-value');
const stopwatchValueEl = document.getElementById('stopwatch-value');
const timerProgressEl = document.getElementById('timer-progress');

const RING_LENGTH = 2 * Math.PI * 42;
let latestState = null;
let pollHandle = null;

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function activeRemainingMs(state) {
  if (state?.status === 'paused') return Number(state.remainingMs) || 0;
  const dueAt = new Date(state?.dueAt).getTime();
  if (!Number.isFinite(dueAt)) return Number(state?.remainingMs) || 0;
  return Math.max(0, dueAt - Date.now());
}

function activeElapsedMs(state) {
  return Math.max(0, Number(state?.elapsedMs) || 0);
}

function setRingProgress(remainingMs, durationMs) {
  const duration = Math.max(1000, Number(durationMs) || 1000);
  const ratio = Math.max(0, Math.min(1, remainingMs / duration));
  timerProgressEl.style.strokeDasharray = String(RING_LENGTH);
  timerProgressEl.style.strokeDashoffset = String(RING_LENGTH * (1 - ratio));
}

function render(state) {
  latestState = state;
  if (!state?.visible) {
    window.jarvis?.closeTimerWidget?.();
    return;
  }

  if (state.mode === 'stopwatch') {
    widgetEl.dataset.mode = 'stopwatch';
    stopwatchValueEl.textContent = formatDuration(activeElapsedMs(state));
    document.title = 'Stopwatch - OpenX';
    return;
  }

  widgetEl.dataset.mode = 'timer';
  const remainingMs = activeRemainingMs(state);
  timeValueEl.textContent = formatDuration(remainingMs);
  setRingProgress(remainingMs, state.durationMs);
  document.title = 'Timer - OpenX';
}

async function refresh() {
  if (!window.jarvis?.getTimerWidgetState) return;
  try {
    render(await window.jarvis.getTimerWidgetState());
  } catch (_) {}
}

function tick() {
  if (!latestState?.visible) return;
  render(latestState);
}

closeBtn.addEventListener('click', () => {
  window.jarvis?.closeTimerWidget?.();
});

timerProgressEl.style.strokeDasharray = String(RING_LENGTH);
timerProgressEl.style.strokeDashoffset = '0';

window.jarvis?.onTimerWidgetState?.(render);
refresh();
pollHandle = setInterval(refresh, 1000);
setInterval(tick, 250);

window.addEventListener('beforeunload', () => {
  if (pollHandle) clearInterval(pollHandle);
});
