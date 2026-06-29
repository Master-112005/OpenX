const widgetEl = document.getElementById('widget');
const resetBtn = document.getElementById('reset-btn');
const closeBtn = document.getElementById('close-btn');
const stopwatchFaceEl = document.getElementById('stopwatch-face');
const stopwatchLabelEl = stopwatchFaceEl.querySelector('.stopwatch-label');
const timeValueEl = document.getElementById('time-value');
const stopwatchValueEl = document.getElementById('stopwatch-value');
const timerProgressEl = document.getElementById('timer-progress');

const RING_LENGTH = 2 * Math.PI * 42;
let latestState = null;
let pollHandle = null;
let tickHandle = null;
let audioContext = null;

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

function playWidgetTone(mode) {
  const context = getAudioContext();
  if (!context) return;
  const pattern = mode === 'stopwatch'
    ? [[720, 0, 0.06], [920, 0.08, 0.08]]
    : [[560, 0, 0.07], [760, 0.1, 0.08]];
  pattern.forEach(([frequency, delay, duration]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + delay;
    const stopAt = startAt + duration;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.05, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(stopAt + 0.02);
  });
}

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
  const previousKey = latestState?.visible ? `${latestState.mode}:${latestState.id || latestState.taskName}` : '';
  latestState = state;
  if (!state?.visible) {
    window.jarvis?.closeTimerWidget?.();
    return;
  }

  const nextKey = `${state.mode}:${state.id || state.taskName}`;
  if (nextKey !== previousKey) {
    playWidgetTone(state.mode);
  }

  if (state.mode === 'stopwatch') {
    widgetEl.dataset.mode = 'stopwatch';
    widgetEl.dataset.state = state.status || 'running';
    stopwatchLabelEl.textContent = state.status === 'paused' ? 'Start' : 'Stop';
    stopwatchFaceEl.setAttribute('aria-label', state.status === 'paused' ? 'Start stopwatch' : 'Stop stopwatch');
    stopwatchValueEl.textContent = formatDuration(activeElapsedMs(state));
    document.title = 'Stopwatch - OpenX';
    return;
  }

  widgetEl.dataset.mode = 'timer';
  delete widgetEl.dataset.state;
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

stopwatchFaceEl.addEventListener('click', async () => {
  if (latestState?.mode !== 'stopwatch') return;
  stopwatchFaceEl.disabled = true;
  widgetEl.dataset.stopping = 'true';
  try {
    if (latestState.status === 'paused') {
      await window.jarvis?.resumeStopwatchFromWidget?.();
    } else {
      await window.jarvis?.stopStopwatchFromWidget?.();
    }
    await refresh();
  } finally {
    stopwatchFaceEl.disabled = false;
    delete widgetEl.dataset.stopping;
  }
});

resetBtn.addEventListener('click', async () => {
  if (latestState?.mode !== 'stopwatch') return;
  resetBtn.disabled = true;
  try {
    await window.jarvis?.resetStopwatchFromWidget?.();
    await refresh();
  } finally {
    resetBtn.disabled = false;
  }
});

timerProgressEl.style.strokeDasharray = String(RING_LENGTH);
timerProgressEl.style.strokeDashoffset = '0';

window.jarvis?.onTimerWidgetState?.(render);
refresh();
pollHandle = setInterval(refresh, 1000);
tickHandle = setInterval(tick, 500);

window.addEventListener('beforeunload', () => {
  if (pollHandle) clearInterval(pollHandle);
  if (tickHandle) clearInterval(tickHandle);
});
