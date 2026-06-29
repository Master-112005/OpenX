const messagesEl = document.getElementById('messages');
const inputBox = document.getElementById('input-box');
const sendBtn = document.getElementById('send-btn');
const closeBtn = document.getElementById('close-btn');
const settingsBtn = document.getElementById('settings-btn');
const assistantMuteBtn = document.getElementById('assistant-mute-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsNavButtons = document.querySelectorAll('.settings-nav-chip');
const settingsSections = document.querySelectorAll('[data-settings-section]');
const settingsFooterSection = document.getElementById('settings-footer-section');
const systemOptionsEl = document.getElementById('system-options');
const systemOptionButtons = document.querySelectorAll('.system-option');
const systemBlocks = document.querySelectorAll('[data-system-block]');
const quickBtns = document.querySelectorAll('.chip-btn');
const themeGrid = document.getElementById('theme-grid');
const settingsStatusEl = document.getElementById('settings-status');
const modeGridEl = document.getElementById('mode-grid');
const modeUsageEl = document.getElementById('mode-usage');
const modeAddBtn = document.getElementById('mode-add-btn');
const phoneGenerateTokenBtn = document.getElementById('phone-generate-token-btn');
const phonePairingTokenEl = document.getElementById('phone-pairing-token');
const phonePairingStatusEl = document.getElementById('phone-pairing-status');
const phonePairingExpiryEl = document.getElementById('phone-pairing-expiry');
const phonePairingQrEl = document.getElementById('phone-pairing-qr');
const phonePairingCountdownEl = document.getElementById('phone-pairing-countdown');
const phoneServerStatusEl = document.getElementById('phone-server-status');
const phoneServerAddressEl = document.getElementById('phone-server-address');
const phoneServerPortEl = document.getElementById('phone-server-port');
const phoneServerDevicesEl = document.getElementById('phone-server-devices');
const phoneServerVersionEl = document.getElementById('phone-server-version');
const phoneDeviceListEl = document.getElementById('phone-device-list');
const chatViewBtn = document.getElementById('chat-view-btn');
const activityViewBtn = document.getElementById('activity-view-btn');
const conversationView = document.getElementById('conversation-view');
const activityView = document.getElementById('activity-view');
const activityBadge = document.getElementById('activity-badge');
const scheduleListEl = document.getElementById('schedule-list');
const scheduleCountEl = document.getElementById('schedule-count');
const notificationListEl = document.getElementById('notification-list');
const toastRegionEl = document.getElementById('toast-region');
const alarmOverlay = document.getElementById('alarm-overlay');
const alarmKindEl = document.getElementById('alarm-kind');
const alarmTitleEl = document.getElementById('alarm-title');
const alarmMessageEl = document.getElementById('alarm-message');
const alarmTimeEl = document.getElementById('alarm-time');
const alarmSymbolEl = document.getElementById('alarm-symbol');

const MODE_LIMIT = 5;
const MODE_APP_LIMIT = 5;
const SCHEDULE_STORAGE_KEY = 'openx-ui-schedules-v1';
const NOTIFICATION_STORAGE_KEY = 'openx-ui-notifications-v1';
const MAX_NOTIFICATION_HISTORY = 30;
const MAX_RENDERED_MESSAGES = 100;
const ASSISTANT_MUTED_STORAGE_KEY = 'openx-assistant-voice-muted-v1';

let isProcessing = false;
let pendingConfirmation = null;
let settingsSnapshot = null;
let selectedThemeId = 'graphite';
let activeSettingsSection = null;
let activeSystemBlock = 'identity';
let hasRenderedWelcome = false;
let modeDrafts = [];
let selectedModeIndex = 0;
const selectedModeApps = new Map();
let activeWorkspaceView = 'chat';
let scheduleItems = loadStoredList(SCHEDULE_STORAGE_KEY);
let notificationHistory = loadStoredList(NOTIFICATION_STORAGE_KEY);
let activeAlarmId = null;
let alertAudioContext = null;
let alertSoundInterval = null;
let activeAlertTones = [];
let isAssistantMuted = localStorage.getItem(ASSISTANT_MUTED_STORAGE_KEY) === 'true';
let glassTintAnimationFrame = null;
let pendingGlassTintValue = 42;
let phonePairingCountdownHandle = null;
const PHONE_PERMISSIONS = [
  ['remoteCommands', 'Remote Commands'],
  ['fileTransfer', 'File Transfer'],
  ['receiveFiles', 'Receive Files'],
  ['sendFiles', 'Send Files'],
  ['powerActions', 'Power Actions']
];
const scheduleTimers = new Map();

const fieldIds = {
  assistantDisplayName: 'assistant-display-name',
  assistantHonorific: 'assistant-honorific',
  assistantTtsVolume: 'assistant-tts-volume',
  assistantTtsRate: 'assistant-tts-rate',
  profileFullName: 'profile-full-name',
  profileEmail: 'profile-email',
  profilePhone: 'profile-phone',
  profileAddressLine1: 'profile-address-line1',
  profileCity: 'profile-city',
  profileState: 'profile-state',
  profilePostalCode: 'profile-postal-code',
  profileCountry: 'profile-country',
  profileCompany: 'profile-company',
  profileRole: 'profile-role',
  chatMaxHistory: 'chat-max-history',
  glassTint: 'glass-tint',
  systemPermissionLevel: 'system-permission-level'
};

function getAssistantDisplayName() {
  return settingsSnapshot?.settings?.assistant?.displayName || 'JARVIS';
}

function getHonorific() {
  return settingsSnapshot?.settings?.assistant?.honorific || 'sir';
}

function assistantMeta(label = 'just now') {
  return `${getAssistantDisplayName()} - ${label}`;
}

function loadStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveStoredList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {}
}

function addMessage(text, type, meta, options = {}) {
  const msg = document.createElement('article');
  msg.className = `message ${type}`;
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = type === 'user' ? 'You' : (type === 'system' ? '!' : getAssistantDisplayName().slice(0, 2));

  const stack = document.createElement('div');
  stack.className = 'message-stack';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = String(text || '');
  const choices = Array.isArray(options.choices) ? options.choices.slice(0, 8) : [];
  if (type === 'assistant' && choices.length > 0) {
    const choiceList = document.createElement('ol');
    choiceList.className = 'message-choices';
    for (const choice of choices) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'message-choice';
      button.type = 'button';
      const choiceIndex = Number(choice.index) || choiceList.children.length + 1;
      const choicePath = String(choice.path || '');
      const fallbackTitle = String(choice.title || `Option ${choiceIndex}`);
      const choiceName = choicePath.split(/[\\/]/).filter(Boolean).pop() ||
        fallbackTitle.replace(/\s+-\s+[A-Za-z]:\\.*$/, '') ||
        `Option ${choiceIndex}`;
      const number = document.createElement('span');
      number.className = 'message-choice-number';
      number.textContent = String(choiceIndex);
      const copy = document.createElement('span');
      copy.className = 'message-choice-copy';
      const name = document.createElement('strong');
      name.textContent = choiceName;
      copy.appendChild(name);
      if (choicePath) {
        const location = document.createElement('small');
        location.textContent = choicePath;
        copy.appendChild(location);
      }
      button.append(number, copy);
      button.addEventListener('click', () => {
        if (!isProcessing) {
          sendCommand(String(choiceIndex));
        }
      });
      item.appendChild(button);
      choiceList.appendChild(item);
    }
    bubble.appendChild(choiceList);
  }
  stack.appendChild(bubble);
  if (meta) {
    const metaElement = document.createElement('div');
    metaElement.className = 'meta';
    metaElement.textContent = meta;
    stack.appendChild(metaElement);
  }
  msg.append(avatar, stack);
  messagesEl.appendChild(msg);
  const renderedMessages = messagesEl.querySelectorAll('.message');
  for (let index = 0; index < renderedMessages.length - MAX_RENDERED_MESSAGES; index += 1) {
    renderedMessages[index].remove();
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing';
  el.id = 'typing-indicator';
  for (let index = 0; index < 3; index += 1) {
    el.appendChild(document.createElement('span'));
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) {
    el.remove();
  }
}

function setWorkspaceView(viewName) {
  activeWorkspaceView = viewName === 'activity' ? 'activity' : 'chat';
  const showingActivity = activeWorkspaceView === 'activity';
  conversationView.classList.toggle('active', !showingActivity);
  conversationView.hidden = showingActivity;
  activityView.classList.toggle('active', showingActivity);
  activityView.hidden = !showingActivity;
  chatViewBtn.classList.toggle('active', !showingActivity);
  chatViewBtn.setAttribute('aria-pressed', String(!showingActivity));
  activityViewBtn.classList.toggle('active', showingActivity);
  activityViewBtn.setAttribute('aria-pressed', String(showingActivity));
  if (showingActivity) {
    renderActivity();
  } else {
    requestAnimationFrame(() => inputBox.focus());
  }
}

function formatDueDate(value) {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) return 'Time unavailable';
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (left, right) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  const day = sameDay(dueAt, today)
    ? 'Today'
    : (sameDay(dueAt, tomorrow)
      ? 'Tomorrow'
      : dueAt.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  return `${day}, ${dueAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function toneDetails(tone = 'info') {
  const tones = {
    success: { symbol: '✓', color: 'var(--success-color)', soft: 'rgba(105, 213, 165, 0.13)' },
    warning: { symbol: '!', color: 'var(--warning-color)', soft: 'rgba(245, 199, 108, 0.13)' },
    error: { symbol: '×', color: 'var(--danger-color)', soft: 'rgba(255, 133, 143, 0.13)' },
    alarm: { symbol: '⏰', color: '#ff9f73', soft: 'rgba(255, 159, 115, 0.13)' },
    reminder: { symbol: '📝', color: '#ae93ff', soft: 'rgba(174, 147, 255, 0.13)' },
    timer: { symbol: '⏱️', color: '#69c8ff', soft: 'rgba(105, 200, 255, 0.13)' },
    info: { symbol: 'i', color: 'var(--accent-color)', soft: 'var(--accent-soft)' }
  };
  return tones[tone] || tones.info;
}

function recordNotification(title, message, tone = 'info') {
  const notification = {
    id: `notice-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: String(title || 'Assistant'),
    message: String(message || ''),
    tone,
    createdAt: new Date().toISOString()
  };
  notificationHistory = [notification, ...notificationHistory].slice(0, MAX_NOTIFICATION_HISTORY);
  saveStoredList(NOTIFICATION_STORAGE_KEY, notificationHistory);
  renderActivityBadge();
  return notification;
}

function showToast(title, message, tone = 'info', options = {}) {
  const notice = options.record === false
    ? { title, message, tone }
    : recordNotification(title, message, tone);
  const colors = toneDetails(tone);
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;

  const icon = document.createElement('div');
  icon.className = 'notice-icon';
  icon.style.setProperty('--notice-color', colors.color);
  icon.style.setProperty('--notice-soft', colors.soft);
  icon.textContent = colors.symbol;

  const copy = document.createElement('div');
  copy.className = 'toast-copy';
  const heading = document.createElement('div');
  heading.className = 'toast-title';
  heading.textContent = notice.title;
  const body = document.createElement('div');
  body.className = 'toast-message';
  body.textContent = notice.message;
  copy.append(heading, body);

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  const remove = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 180);
  };
  close.addEventListener('click', remove);
  toast.append(icon, copy, close);
  toastRegionEl.prepend(toast);

  const duration = Number(options.duration ?? 5200);
  if (duration > 0) setTimeout(remove, duration);
  renderNotifications();
  return toast;
}

function inferReminderCategory(message, category = '') {
  const preferred = String(category || '').toLowerCase();
  if (['education', 'water', 'exercise', 'health', 'work', 'birthday', 'general'].includes(preferred)) return preferred;
  const text = String(message || '').toLowerCase();
  if (/\b(?:college|collage|school|class|lecture|campus|study|exam|assignment|homework)\b/.test(text)) return 'education';
  if (/\b(?:water|hydrate|hydration|drink)\b/.test(text)) return 'water';
  if (/\b(?:exercise|workout|gym|walk|run|running|yoga|stretch|fitness)\b/.test(text)) return 'exercise';
  if (/\b(?:medicine|medication|tablet|pill|doctor|appointment|health)\b/.test(text)) return 'health';
  if (/\b(?:work|office|meeting|project|deadline|client|email)\b/.test(text)) return 'work';
  if (/\b(?:birthday|anniversary|celebrate|party)\b/.test(text)) return 'birthday';
  return 'general';
}

function scheduleTone(kind, category = '', message = '') {
  const normalized = String(kind || '').toLowerCase();
  if (normalized === 'alarm') return { tone: 'alarm', color: '#ff9f73', symbol: '⏰' };
  if (normalized === 'timer') return { tone: 'timer', color: '#69c8ff', symbol: '⏱️' };
  const reminderCategory = inferReminderCategory(message, category);
  const presentations = {
    education: { color: '#7ea7ff', symbol: '🎓', label: 'School & college' },
    water: { color: '#54c7ec', symbol: '💧', label: 'Water' },
    exercise: { color: '#69d39c', symbol: '🏃', label: 'Exercise' },
    health: { color: '#ff8fa3', symbol: '💊', label: 'Health' },
    work: { color: '#f3b765', symbol: '💼', label: 'Work' },
    birthday: { color: '#f08ad4', symbol: '🎂', label: 'Birthday' },
    general: { color: '#ae93ff', symbol: '📝', label: 'Reminder' }
  };
  return { tone: 'reminder', category: reminderCategory, ...presentations[reminderCategory] };
}

function addScheduleFromResult(result) {
  const data = result?.data || {};
  if (!['timer.set', 'alarm.set', 'reminder.set'].includes(result?.intent) || !data.dueAt) return;
  const kind = data.kind || (result.intent === 'timer.set' ? 'Timer' : result.intent === 'alarm.set' ? 'Alarm' : 'Reminder');
  const message = result.intent === 'reminder.set'
    ? (result.entities?.reminderText || 'Reminder')
    : (result.intent === 'alarm.set'
      ? `Alarm for ${result.entities?.timeExpression || formatDueDate(data.dueAt)}`
      : `${result.entities?.duration || ''} minute timer`.trim());
  const item = {
    id: data.taskName || `schedule-${Date.now()}`,
    kind,
    message,
    category: data.category || result.entities?.reminderCategory || null,
    symbol: data.symbol || null,
    dueAt: data.dueAt,
    status: 'scheduled',
    createdAt: new Date().toISOString()
  };
  scheduleItems = [item, ...scheduleItems.filter(entry => entry.id !== item.id)].slice(0, 50);
  saveStoredList(SCHEDULE_STORAGE_KEY, scheduleItems);
  if (!window.jarvis) armSchedule(item);
  renderActivity();
  const tone = scheduleTone(kind, item.category, item.message).tone;
  showToast(`${kind} scheduled`, `${message} · ${formatDueDate(data.dueAt)}`, tone);
}

function armSchedule(item) {
  if (!item?.id || item.status !== 'scheduled') return;
  const existing = scheduleTimers.get(item.id);
  if (existing) clearTimeout(existing);
  const remaining = new Date(item.dueAt).getTime() - Date.now();
  if (!Number.isFinite(remaining)) return;
  if (remaining <= 0) {
    triggerSchedule(item.id);
    return;
  }
  const delay = Math.min(remaining, 2147483647);
  const timer = setTimeout(() => {
    scheduleTimers.delete(item.id);
    if (remaining > 2147483647) {
      armSchedule(scheduleItems.find(entry => entry.id === item.id));
    } else {
      triggerSchedule(item.id);
    }
  }, delay);
  scheduleTimers.set(item.id, timer);
}

function getAlertAudioContext() {
  if (!alertAudioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    alertAudioContext = new Context();
  }
  if (alertAudioContext.state === 'suspended') {
    alertAudioContext.resume().catch(() => {});
  }
  return alertAudioContext;
}

function stopScheduleSound() {
  if (alertSoundInterval) {
    clearInterval(alertSoundInterval);
    alertSoundInterval = null;
  }
  activeAlertTones.forEach(tone => {
    try {
      tone.stop();
    } catch (_) {}
  });
  activeAlertTones = [];
}

function playAlertTone(frequency, delay, duration) {
  const context = getAlertAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startAt = context.currentTime + delay;
  const stopAt = startAt + duration;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.03);
  activeAlertTones.push(oscillator);
  oscillator.onended = () => {
    activeAlertTones = activeAlertTones.filter(tone => tone !== oscillator);
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
  stopScheduleSound();
  const playPattern = () => pattern.forEach(([frequency, delay, duration]) => playAlertTone(frequency, delay, duration));
  playPattern();
  alertSoundInterval = setInterval(playPattern, normalized === 'alarm' ? 1200 : 2200);
}

function triggerSchedule(id) {
  const item = scheduleItems.find(entry => entry.id === id);
  if (!item || !['scheduled', 'due'].includes(item.status)) return;
  if (item.status === 'due' && activeAlarmId === item.id && !alarmOverlay.hidden) return;
  if (item.status === 'scheduled') item.status = 'due';
  saveStoredList(SCHEDULE_STORAGE_KEY, scheduleItems);
  activeAlarmId = item.id;
  alarmKindEl.textContent = item.kind;
  const alertStyle = scheduleTone(item.kind, item.category, item.message);
  alarmSymbolEl.textContent = item.symbol || alertStyle.symbol;
  alarmTitleEl.textContent = item.kind === 'Reminder' ? `${alertStyle.label} reminder` : `${item.kind} is ready`;
  alarmMessageEl.textContent = item.message;
  alarmTimeEl.textContent = formatDueDate(item.dueAt);
  alarmOverlay.hidden = false;
  playScheduleSound(item.kind);
  showToast(`${item.kind} due`, item.message, scheduleTone(item.kind, item.category, item.message).tone, { duration: 0 });
  renderActivity();
}

function updateSchedule(id, changes) {
  const item = scheduleItems.find(entry => entry.id === id);
  if (!item) return;
  Object.assign(item, changes);
  saveStoredList(SCHEDULE_STORAGE_KEY, scheduleItems);
  if (item.status === 'scheduled' && !window.jarvis) armSchedule(item);
  renderActivity();
}

function snoozeSchedule(id, minutes = 5) {
  const item = scheduleItems.find(entry => entry.id === id);
  if (!item) return;
  stopScheduleSound();
  updateSchedule(id, {
    status: 'scheduled',
    dueAt: new Date(Date.now() + (minutes * 60 * 1000)).toISOString()
  });
  window.jarvis?.handleScheduleAlert?.(id, 'snooze', minutes);
  showToast(`${item.kind} snoozed`, `It will return in ${minutes} minutes.`, 'info');
}

function renderSchedules() {
  scheduleListEl.replaceChildren();
  const visible = scheduleItems
    .filter(item => item.status !== 'dismissed')
    .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt));
  const pending = visible.filter(item => ['scheduled', 'due'].includes(item.status));
  scheduleCountEl.textContent = String(pending.length);
  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No alarms or reminders yet. Try “remind me tomorrow at 9 AM to review my tasks.”';
    scheduleListEl.appendChild(empty);
    return;
  }

  visible.slice(0, 12).forEach(item => {
    const style = scheduleTone(item.kind, item.category, item.message);
    const card = document.createElement('article');
    card.className = 'schedule-card';
    card.style.setProperty('--schedule-color', style.color);
    const top = document.createElement('div');
    top.className = 'schedule-card-top';
    const copy = document.createElement('div');
    const kind = document.createElement('div');
    kind.className = 'schedule-kind';
    kind.textContent = `${item.symbol || style.symbol} ${item.kind === 'Reminder' ? style.label : item.kind}`;
    const title = document.createElement('div');
    title.className = 'schedule-title';
    title.textContent = item.message;
    const due = document.createElement('div');
    due.className = 'schedule-due';
    due.textContent = formatDueDate(item.dueAt);
    copy.append(kind, title, due);
    const state = document.createElement('span');
    state.className = 'schedule-state';
    state.textContent = item.status === 'due' ? 'Due now' : (item.status === 'completed' ? 'Done' : 'Scheduled');
    top.append(copy, state);
    card.appendChild(top);

    const actions = document.createElement('div');
    actions.className = 'schedule-actions';
    if (['scheduled', 'due'].includes(item.status)) {
      const snooze = document.createElement('button');
      snooze.className = 'mini-btn';
      snooze.type = 'button';
      snooze.textContent = 'Snooze 5 min';
      snooze.addEventListener('click', () => snoozeSchedule(item.id));
      actions.appendChild(snooze);
    }
    if (item.status === 'due' && !window.jarvis) {
      const open = document.createElement('button');
      open.className = 'mini-btn';
      open.type = 'button';
      open.textContent = 'Open alert';
      open.addEventListener('click', () => triggerSchedule(item.id));
      actions.appendChild(open);
    }
    const dismiss = document.createElement('button');
    dismiss.className = 'mini-btn danger';
    dismiss.type = 'button';
    dismiss.textContent = item.status === 'completed' ? 'Remove' : 'Stop';
    dismiss.addEventListener('click', () => {
      window.jarvis?.handleScheduleAlert?.(item.id, 'stop');
      updateSchedule(item.id, { status: 'dismissed' });
    });
    actions.appendChild(dismiss);
    card.appendChild(actions);
    scheduleListEl.appendChild(card);
  });
}

function renderNotifications() {
  notificationListEl.replaceChildren();
  if (notificationHistory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Important assistant updates will appear here.';
    notificationListEl.appendChild(empty);
    return;
  }
  notificationHistory.slice(0, 15).forEach(notice => {
    const colors = toneDetails(notice.tone);
    const row = document.createElement('article');
    row.className = 'notice-item';
    const icon = document.createElement('div');
    icon.className = 'notice-icon';
    icon.style.setProperty('--notice-color', colors.color);
    icon.style.setProperty('--notice-soft', colors.soft);
    icon.textContent = colors.symbol;
    const copy = document.createElement('div');
    copy.className = 'notice-copy';
    const title = document.createElement('div');
    title.className = 'notice-title';
    title.textContent = notice.title;
    const message = document.createElement('div');
    message.className = 'notice-message';
    message.textContent = notice.message;
    copy.append(title, message);
    const time = document.createElement('time');
    time.className = 'notice-time';
    time.dateTime = notice.createdAt;
    time.textContent = relativeTime(notice.createdAt);
    row.append(icon, copy, time);
    notificationListEl.appendChild(row);
  });
}

function renderActivityBadge() {
  const pending = scheduleItems.filter(item => ['scheduled', 'due'].includes(item.status)).length;
  activityBadge.textContent = String(pending);
  activityBadge.hidden = pending === 0;
}

function renderActivity() {
  const now = new Date();
  document.getElementById('activity-date').textContent = `${now.toLocaleDateString([], { weekday: 'short' })}\n${now.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  renderSchedules();
  renderNotifications();
  renderActivityBadge();
}

function handleCommandResult(result) {
  addScheduleFromResult(result);
  if (result?.success === false) {
    showToast('Command needs attention', result.error || result.response || 'The command could not be completed.', 'error');
  } else if (result?.requiresConfirmation) {
    showToast('Confirmation required', result.confirmationMessage || result.response || 'Review this action before continuing.', 'warning');
  }
}

function addConfirmationPrompt(result) {
  pendingConfirmation = {
    commandId: result.commandId,
    intent: result.intent,
    entities: result.entities
  };

  addMessage(
    result.response || `Please confirm this action, ${getHonorific()}.`,
    'system',
    `${getAssistantDisplayName()} - confirmation required`
  );
  speakAssistantResponse(result.response || `Please confirm this action, ${getHonorific()}.`);
}

function speakAssistantResponse(text) {
  const spokenText = String(text || '').trim();
  if (!isAssistantMuted && spokenText && window.jarvis?.speak) {
    window.jarvis.speak(spokenText);
  }
}

function updateAssistantMuteButton() {
  assistantMuteBtn.classList.toggle('active', isAssistantMuted);
  assistantMuteBtn.setAttribute('aria-pressed', String(isAssistantMuted));
  assistantMuteBtn.setAttribute('aria-label', isAssistantMuted ? 'Unmute assistant voice' : 'Mute assistant voice');
  assistantMuteBtn.title = isAssistantMuted ? 'Unmute assistant voice' : 'Mute assistant voice';
  assistantMuteBtn.querySelector('.voice-icon').textContent = isAssistantMuted ? '\u{1F507}' : '\u{1F50A}';
}

async function toggleAssistantMute() {
  isAssistantMuted = !isAssistantMuted;
  localStorage.setItem(ASSISTANT_MUTED_STORAGE_KEY, String(isAssistantMuted));
  updateAssistantMuteButton();
  if (isAssistantMuted && window.jarvis?.stopSpeaking) {
    await window.jarvis.stopSpeaking();
  }
  showToast(
    isAssistantMuted ? 'Assistant voice muted' : 'Assistant voice on',
    isAssistantMuted ? 'Spoken replies are off. Other app audio is unchanged.' : 'Spoken assistant replies are enabled.',
    'info'
  );
}

async function sendCommand(text) {
  if (!text.trim() || isProcessing) {
    return;
  }

  if (pendingConfirmation) {
    addMessage(text, 'user', 'You - just now');
    pendingConfirmation = null;
    isProcessing = true;
    showTyping();

    try {
      const result = await window.jarvis.processCommand(text, 'chat');
      hideTyping();
      handleCommandResult(result);
      if (result.requiresConfirmation) {
        addConfirmationPrompt(result);
      } else {
        const response = result.response || `Operation completed, ${getHonorific()}.`;
        addMessage(response, 'assistant', assistantMeta(), { choices: result.data?.choices });
        speakAssistantResponse(response);
      }
    } catch (err) {
      hideTyping();
      addMessage(`Unable to complete that action, ${getHonorific()}.`, 'system', assistantMeta('error'));
      showToast('Command failed', err?.message || 'Unable to complete that action.', 'error');
    } finally {
      isProcessing = false;
      inputBox.focus();
    }
    return;
  }

  isProcessing = true;
  addMessage(text, 'user', 'You - just now');
  inputBox.value = '';
  showTyping();

  try {
    const result = await window.jarvis.processCommand(text, 'chat');
    hideTyping();
    handleCommandResult(result);

    if (result.requiresConfirmation) {
      addConfirmationPrompt(result);
      return;
    }

    const response = result.response || `Operation completed, ${getHonorific()}.`;
    addMessage(response, 'assistant', assistantMeta(), { choices: result.data?.choices });
    speakAssistantResponse(response);
  } catch (err) {
    hideTyping();
    addMessage(`An error occurred, ${getHonorific()}.`, 'system', assistantMeta('error'));
    showToast('Command failed', err?.message || 'An unexpected error occurred.', 'error');
  } finally {
    isProcessing = false;
    inputBox.focus();
  }
}

function handleSend() {
  const text = inputBox.value.trim();
  if (text) {
    sendCommand(text);
  }
}

function applyTheme(themeId) {
  if (!settingsSnapshot) {
    return;
  }

  const theme = (settingsSnapshot.availableThemes || []).find(entry => entry.id === themeId)
    || settingsSnapshot.availableThemes?.[0];
  if (!theme) {
    return;
  }

  selectedThemeId = theme.id;
  const root = document.documentElement;
  root.style.setProperty('--panel-bg', theme.colors.panel);
  root.style.setProperty('--surface-bg', theme.colors.surface);
  root.style.setProperty('--surface-strong', theme.colors.surfaceStrong);
  root.style.setProperty('--border-color', theme.colors.border);
  root.style.setProperty('--text-color', theme.colors.text);
  root.style.setProperty('--muted-color', theme.colors.muted);
  root.style.setProperty('--accent-color', theme.colors.accent);
  root.dataset.glassTheme = theme.id;
  applyGlassTint(document.getElementById(fieldIds.glassTint)?.value ?? settingsSnapshot?.settings?.chat?.glassTint ?? 42);

  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.themeId === theme.id);
  });

  if (settingsSnapshot) {
    updateSettingsSummary();
  }
}

function applyGlassTint(value) {
  const tint = Math.max(0, Math.min(100, Number(value) || 0));
  const strength = tint / 100;
  const themeId = selectedThemeId || 'graphite';
  const tones = {
    graphite: [48, 50, 58],
    'white-glass': [255, 255, 255],
    'black-glass': [0, 0, 0]
  };
  const [red, green, blue] = tones[themeId] || tones.graphite;
  const root = document.documentElement;
  const useDarkText = themeId === 'white-glass' && tint >= 28;
  const textColor = useDarkText ? '#161619' : '#f8f8fa';
  const mutedColor = useDarkText ? 'rgba(22, 22, 25, 0.68)' : 'rgba(255, 255, 255, 0.72)';
  const controlTone = useDarkText ? '0, 0, 0' : '255, 255, 255';
  const borderTone = useDarkText ? '0, 0, 0' : '255, 255, 255';
  const primaryTone = useDarkText ? '18, 18, 20' : '255, 255, 255';
  const primaryText = useDarkText ? '#ffffff' : '#151517';
  root.style.setProperty('--adaptive-shell', `rgba(${red}, ${green}, ${blue}, ${(0.025 + (strength * 0.68)).toFixed(3)})`);
  root.style.setProperty('--adaptive-surface', `rgba(${red}, ${green}, ${blue}, ${(0.025 + (strength * 0.2)).toFixed(3)})`);
  root.style.setProperty('--adaptive-surface-strong', `rgba(${red}, ${green}, ${blue}, ${(0.05 + (strength * 0.3)).toFixed(3)})`);
  root.style.setProperty('--adaptive-border', `rgba(${borderTone}, ${(0.09 + (strength * 0.18)).toFixed(3)})`);
  root.style.setProperty('--adaptive-text', textColor);
  root.style.setProperty('--adaptive-muted', mutedColor);
  root.style.setProperty('--adaptive-control', `rgba(${controlTone}, ${(0.055 + (strength * 0.11)).toFixed(3)})`);
  root.style.setProperty('--adaptive-control-strong', `rgba(${controlTone}, ${(0.1 + (strength * 0.16)).toFixed(3)})`);
  root.style.setProperty('--adaptive-primary', `rgba(${primaryTone}, 0.9)`);
  root.style.setProperty('--adaptive-primary-text', primaryText);
  root.style.setProperty('--adaptive-text-shadow', useDarkText ? '0 1px 2px rgba(255, 255, 255, 0.38)' : '0 1px 3px rgba(0, 0, 0, 0.72)');
  root.style.setProperty('--text-color', textColor);
  root.style.setProperty('--muted-color', mutedColor);
  root.dataset.glassContrast = useDarkText ? 'dark-text' : 'light-text';
  document.querySelectorAll('.primary-btn, #send-btn').forEach(button => {
    button.style.setProperty('background-color', `rgba(${primaryTone}, 0.9)`, 'important');
    button.style.setProperty('color', primaryText, 'important');
  });
  const valueEl = document.getElementById('glass-tint-value');
  if (valueEl) valueEl.textContent = `${Math.round(tint)}%`;
}

function scheduleGlassTintUpdate(value) {
  pendingGlassTintValue = value;
  if (glassTintAnimationFrame !== null) return;
  glassTintAnimationFrame = requestAnimationFrame(() => {
    glassTintAnimationFrame = null;
    applyGlassTint(pendingGlassTintValue);
  });
}

function renderThemeCards() {
  themeGrid.replaceChildren();
  const captions = {
    graphite: 'Neutral glass with balanced contrast.',
    'white-glass': 'Bright translucent glass with dark type.',
    'black-glass': 'Deep translucent glass with bright type.'
  };
  (settingsSnapshot?.availableThemes || []).forEach(theme => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.themeId = theme.id;
    const preview = document.createElement('div');
    preview.className = 'theme-preview';
    preview.style.background = `radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 30%), linear-gradient(160deg, rgba(255,255,255,0.06), transparent 35%), ${theme.colors.panel}`;
    preview.style.border = `1px solid ${theme.colors.border}`;

    const name = document.createElement('div');
    name.className = 'theme-name';
    name.textContent = theme.label;

    const caption = document.createElement('div');
    caption.className = 'theme-caption';
    caption.textContent = captions[theme.id] || theme.id;

    const selection = document.createElement('div');
    selection.className = 'theme-select';
    const themeId = document.createElement('span');
    themeId.className = 'section-note';
    themeId.textContent = theme.id;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme-choice';
    radio.value = theme.id;
    selection.append(themeId, radio);
    card.append(preview, name, caption, selection);
    card.addEventListener('click', () => {
      applyTheme(theme.id);
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
      }
    });
    themeGrid.appendChild(card);
  });
}

function setFieldValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || '';
  }
}

function updateTtsSliderLabels() {
  const volumeEl = document.getElementById(fieldIds.assistantTtsVolume);
  const rateEl = document.getElementById(fieldIds.assistantTtsRate);
  const volumeValueEl = document.getElementById('assistant-tts-volume-value');
  const rateValueEl = document.getElementById('assistant-tts-rate-value');

  if (volumeEl && volumeValueEl) {
    volumeValueEl.textContent = `${volumeEl.value || 100}%`;
  }

  if (rateEl && rateValueEl) {
    const rate = Number(rateEl.value || 0);
    rateValueEl.textContent = rate > 0 ? `+${rate}` : String(rate);
  }
}

function populateSettingsForm() {
  const settings = settingsSnapshot?.settings;
  if (!settings) {
    return;
  }

  setFieldValue(fieldIds.assistantDisplayName, settings.assistant.displayName);
  setFieldValue(fieldIds.assistantHonorific, settings.assistant.honorific);
  setFieldValue(fieldIds.assistantTtsVolume, String(settings.voice?.tts?.volume ?? 100));
  setFieldValue(fieldIds.assistantTtsRate, String(settings.voice?.tts?.rate ?? 2));
  updateTtsSliderLabels();
  setFieldValue(fieldIds.profileFullName, settings.userProfile.fullName);
  setFieldValue(fieldIds.profileEmail, settings.userProfile.email);
  setFieldValue(fieldIds.profilePhone, settings.userProfile.phone);
  setFieldValue(fieldIds.profileAddressLine1, settings.userProfile.addressLine1);
  setFieldValue(fieldIds.profileCity, settings.userProfile.city);
  setFieldValue(fieldIds.profileState, settings.userProfile.state);
  setFieldValue(fieldIds.profilePostalCode, settings.userProfile.postalCode);
  setFieldValue(fieldIds.profileCountry, settings.userProfile.country);
  setFieldValue(fieldIds.profileCompany, settings.userProfile.company);
  setFieldValue(fieldIds.profileRole, settings.userProfile.role);
  setFieldValue(fieldIds.chatMaxHistory, String(settings.chat.maxHistory));
  setFieldValue(fieldIds.glassTint, String(settings.chat.glassTint ?? 42));
  applyGlassTint(settings.chat.glassTint ?? 42);
  setFieldValue(fieldIds.systemPermissionLevel, settings.system.permissionLevel);
  updatePermissionScale();
  populateModeFields(settings.modes || []);

  renderThemeCards();
  applyTheme(settings.chat.themeId);

  const selectedThemeInput = document.querySelector(`input[name="theme-choice"][value="${settings.chat.themeId}"]`);
  if (selectedThemeInput) {
    selectedThemeInput.checked = true;
  }
}

function updatePermissionScale() {
  const selected = document.getElementById(fieldIds.systemPermissionLevel).value;
  document.querySelectorAll('.permission-option').forEach(button => {
    const isActive = button.dataset.permission === selected;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-checked', String(isActive));
  });
}

function setActiveSystemBlock(blockName) {
  const allowedBlocks = new Set(['identity', 'theme', 'access']);
  activeSystemBlock = allowedBlocks.has(blockName) ? blockName : 'identity';

  systemOptionButtons.forEach(button => {
    const isActive = button.dataset.systemBlockTarget === activeSystemBlock;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });

  systemBlocks.forEach(block => {
    const isOpen = activeSettingsSection === 'system' && block.dataset.systemBlock === activeSystemBlock;
    block.classList.toggle('open', isOpen);
  });
}

function setActiveSettingsSection(sectionName) {
  activeSettingsSection = sectionName || null;

  settingsNavButtons.forEach(button => {
    const isActive = button.dataset.sectionTarget === activeSettingsSection;
    button.classList.toggle('active', isActive);
  });

  if (systemOptionsEl) {
    const systemActive = activeSettingsSection === 'system';
    systemOptionsEl.hidden = !systemActive;
    systemOptionsEl.classList.toggle('open', systemActive);
  }

  settingsSections.forEach(section => {
    const isOpen = section.dataset.settingsSection === activeSettingsSection
      && (activeSettingsSection !== 'system' || section.dataset.systemBlock === activeSystemBlock);
    section.classList.toggle('open', isOpen);
  });

  setActiveSystemBlock(activeSystemBlock);

  settingsFooterSection.classList.toggle('open', Boolean(activeSettingsSection));
  const settingsContent = document.querySelector('.settings-content');
  if (settingsContent) settingsContent.scrollTop = 0;
}

function splitInstructionDraft(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeModeDrafts(modes) {
  return (Array.isArray(modes) ? modes : []).slice(0, MODE_LIMIT).map((mode, modeIndex) => {
    const apps = (Array.isArray(mode?.apps) ? mode.apps : [])
      .slice(0, MODE_APP_LIMIT)
      .map(app => {
        if (app && typeof app === 'object' && !Array.isArray(app)) {
          return {
            name: String(app.name || app.appName || '').trim(),
            instructions: Array.isArray(app.instructions)
              ? app.instructions.join('\n')
              : String(app.instructions || app.commands || '').trim()
          };
        }

        return {
          name: String(app || '').trim(),
          instructions: ''
        };
      })
      .filter(app => app.name || app.instructions);

    const legacyCommands = Array.isArray(mode?.commands) ? mode.commands.join('\n') : String(mode?.commands || '').trim();
    if (legacyCommands && apps.length > 0) {
      apps[0].instructions = [apps[0].instructions, legacyCommands].filter(Boolean).join('\n');
    }

    return {
      id: String(mode?.id || `mode-${modeIndex + 1}`),
      name: String(mode?.name || '').trim(),
      apps,
      commands: legacyCommands && apps.length === 0 ? legacyCommands : ''
    };
  });
}

function populateModeFields(modes) {
  modeDrafts = normalizeModeDrafts(modes);
  renderModeEditor();
}

function createEmptyMode() {
  return {
    id: `mode-${Date.now()}`,
    name: '',
    apps: [{ name: '', instructions: '' }],
    commands: ''
  };
}

function renderModeEditor() {
  modeGridEl.replaceChildren();
  modeUsageEl.textContent = `${modeDrafts.length} / ${MODE_LIMIT} saved`;
  modeAddBtn.disabled = modeDrafts.length >= MODE_LIMIT;

  if (modeDrafts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'section-note';
    empty.textContent = 'No modes saved yet. Press + to add one.';
    modeGridEl.appendChild(empty);
    return;
  }

  selectedModeIndex = Math.max(0, Math.min(selectedModeIndex, modeDrafts.length - 1));
  const modeTabs = document.createElement('div');
  modeTabs.className = 'mode-tabs';
  modeDrafts.forEach((mode, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `mode-tab${index === selectedModeIndex ? ' active' : ''}`;
    tab.textContent = mode.name || `Mode ${index + 1}`;
    tab.addEventListener('click', () => {
      selectedModeIndex = index;
      renderModeEditor();
    });
    modeTabs.appendChild(tab);
  });
  modeGridEl.appendChild(modeTabs);

  modeDrafts.forEach((mode, modeIndex) => {
    if (modeIndex !== selectedModeIndex) return;
    const row = document.createElement('div');
    row.className = 'mode-row';

    const header = document.createElement('div');
    header.className = 'mode-row-header';
    const title = document.createElement('div');
    title.className = 'mode-row-title';
    title.textContent = mode.name || `Mode ${modeIndex + 1}`;
    const deleteModeBtn = document.createElement('button');
    deleteModeBtn.className = 'danger-btn';
    deleteModeBtn.type = 'button';
    deleteModeBtn.textContent = 'Delete';
    deleteModeBtn.addEventListener('click', () => {
      modeDrafts.splice(modeIndex, 1);
      selectedModeIndex = Math.max(0, modeIndex - 1);
      renderModeEditor();
    });
    header.appendChild(title);
    header.appendChild(deleteModeBtn);
    row.appendChild(header);

    const nameLabel = document.createElement('label');
    nameLabel.className = 'field-wrap';
    const nameText = document.createElement('span');
    nameText.className = 'field-label';
    nameText.textContent = 'Mode Name';
    const nameInput = document.createElement('input');
    nameInput.className = 'field';
    nameInput.type = 'text';
    nameInput.placeholder = 'development';
    nameInput.value = mode.name || '';
    nameInput.addEventListener('input', () => {
      modeDrafts[modeIndex].name = nameInput.value;
      modeTabs.children[modeIndex].textContent = nameInput.value.trim() || `Mode ${modeIndex + 1}`;
    });
    nameLabel.appendChild(nameText);
    nameLabel.appendChild(nameInput);
    row.appendChild(nameLabel);

    const appHeader = document.createElement('div');
    appHeader.className = 'mode-app-header';
    const appTitle = document.createElement('div');
    appTitle.className = 'mode-row-title';
    appTitle.textContent = `Apps ${mode.apps.length} / ${MODE_APP_LIMIT}`;
    const addAppBtn = document.createElement('button');
    addAppBtn.className = 'secondary-btn';
    addAppBtn.type = 'button';
    addAppBtn.textContent = '+ App';
    addAppBtn.disabled = mode.apps.length >= MODE_APP_LIMIT;
    addAppBtn.addEventListener('click', () => {
      modeDrafts[modeIndex].apps.push({ name: '', instructions: '' });
      selectedModeApps.set(modeIndex, modeDrafts[modeIndex].apps.length - 1);
      renderModeEditor();
    });
    appHeader.appendChild(appTitle);
    appHeader.appendChild(addAppBtn);
    row.appendChild(appHeader);

    const appList = document.createElement('div');
    appList.className = 'mode-app-list';
    const selectedAppIndex = Math.max(0, Math.min(selectedModeApps.get(modeIndex) || 0, Math.max(0, mode.apps.length - 1)));
    selectedModeApps.set(modeIndex, selectedAppIndex);
    const appTabs = document.createElement('div');
    appTabs.className = 'mode-app-tabs';
    mode.apps.forEach((app, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `mode-app-tab${index === selectedAppIndex ? ' active' : ''}`;
      tab.textContent = app.name || `App ${index + 1}`;
      tab.addEventListener('click', () => {
        selectedModeApps.set(modeIndex, index);
        renderModeEditor();
      });
      appTabs.appendChild(tab);
    });
    appList.appendChild(appTabs);
    mode.apps.forEach((app, appIndex) => {
      if (appIndex !== selectedAppIndex) return;
      const appRow = document.createElement('div');
      appRow.className = 'mode-app-row';

      const appNameLabel = document.createElement('label');
      appNameLabel.className = 'field-wrap';
      const appNameText = document.createElement('span');
      appNameText.className = 'field-label';
      appNameText.textContent = `App ${appIndex + 1}`;
      const appInput = document.createElement('input');
      appInput.className = 'field';
      appInput.type = 'text';
      appInput.placeholder = 'youtube';
      appInput.value = app.name || '';
      appInput.addEventListener('input', () => {
        modeDrafts[modeIndex].apps[appIndex].name = appInput.value;
        appTabs.children[appIndex].textContent = appInput.value.trim() || `App ${appIndex + 1}`;
      });
      appNameLabel.appendChild(appNameText);
      appNameLabel.appendChild(appInput);

      const instructionLabel = document.createElement('label');
      instructionLabel.className = 'field-wrap';
      const instructionText = document.createElement('span');
      instructionText.className = 'field-label';
      instructionText.textContent = 'Instructions';
      const instructionInput = document.createElement('textarea');
      instructionInput.className = 'field field-textarea';
      instructionInput.placeholder = 'set volume to 100\nplay liked songs';
      instructionInput.value = app.instructions || '';
      instructionInput.addEventListener('input', () => {
        modeDrafts[modeIndex].apps[appIndex].instructions = instructionInput.value;
      });
      instructionLabel.appendChild(instructionText);
      instructionLabel.appendChild(instructionInput);

      const actions = document.createElement('div');
      actions.className = 'mode-inline-actions';
      const deleteAppBtn = document.createElement('button');
      deleteAppBtn.className = 'danger-btn';
      deleteAppBtn.type = 'button';
      deleteAppBtn.textContent = 'Delete App';
      deleteAppBtn.addEventListener('click', () => {
        modeDrafts[modeIndex].apps.splice(appIndex, 1);
        selectedModeApps.set(modeIndex, Math.max(0, appIndex - 1));
        renderModeEditor();
      });
      actions.appendChild(deleteAppBtn);

      appRow.appendChild(appNameLabel);
      appRow.appendChild(instructionLabel);
      appRow.appendChild(actions);
      appList.appendChild(appRow);
    });
    row.appendChild(appList);

    modeGridEl.appendChild(row);
  });
}

function collectModesPayload() {
  return modeDrafts
    .slice(0, MODE_LIMIT)
    .map((mode, modeIndex) => ({
      id: mode.id || `mode-${modeIndex + 1}`,
      name: String(mode.name || '').trim(),
      apps: (mode.apps || []).slice(0, MODE_APP_LIMIT)
        .map(app => ({
          name: String(app.name || '').trim(),
          instructions: splitInstructionDraft(app.instructions)
        }))
        .filter(app => app.name),
      commands: splitInstructionDraft(mode.commands)
    }))
    .filter(mode => mode.name || mode.apps.length > 0 || mode.commands.length > 0);
}

function collectSettingsPayload() {
  return {
    assistant: {
      displayName: document.getElementById(fieldIds.assistantDisplayName).value.trim(),
      honorific: document.getElementById(fieldIds.assistantHonorific).value
    },
    voice: {
      tts: {
        volume: Number(document.getElementById(fieldIds.assistantTtsVolume).value || 100),
        rate: Number(document.getElementById(fieldIds.assistantTtsRate).value || 2)
      }
    },
    chat: {
      themeId: selectedThemeId,
      glassTint: Number(document.getElementById(fieldIds.glassTint).value || 42),
      maxHistory: Number(document.getElementById(fieldIds.chatMaxHistory).value || 500)
    },
    userProfile: {
      fullName: document.getElementById(fieldIds.profileFullName).value.trim(),
      email: document.getElementById(fieldIds.profileEmail).value.trim(),
      phone: document.getElementById(fieldIds.profilePhone).value.trim(),
      addressLine1: document.getElementById(fieldIds.profileAddressLine1).value.trim(),
      city: document.getElementById(fieldIds.profileCity).value.trim(),
      state: document.getElementById(fieldIds.profileState).value.trim(),
      postalCode: document.getElementById(fieldIds.profilePostalCode).value.trim(),
      country: document.getElementById(fieldIds.profileCountry).value.trim(),
      company: document.getElementById(fieldIds.profileCompany).value.trim(),
      role: document.getElementById(fieldIds.profileRole).value.trim()
    },
    system: {
      permissionLevel: document.getElementById(fieldIds.systemPermissionLevel).value
    },
    modes: collectModesPayload()
  };
}

function updateBranding() {
  const assistantName = getAssistantDisplayName();
  document.getElementById('header-title').textContent = assistantName;
  document.getElementById('header-subtitle').textContent = 'Ready for local commands';
  document.title = `${assistantName} Chat`;
}

function updateSettingsSummary() {
  const assistantName = getAssistantDisplayName();
  const theme = (settingsSnapshot?.availableThemes || []).find(entry => entry.id === selectedThemeId)
    || (settingsSnapshot?.availableThemes || [])[0];
  document.getElementById('settings-hero-name').textContent = assistantName;
  document.getElementById('settings-hero-title').textContent = 'Configured for local automation, profile storage, voice, theme, and access controls.';
  document.getElementById('settings-hero-honorific').textContent = settingsSnapshot?.settings?.assistant?.honorific || 'sir';
  document.getElementById('settings-hero-theme').textContent = theme?.label || 'Theme';
  document.getElementById('settings-hero-learning').textContent = settingsSnapshot?.settings?.activeLearning?.enabled === false ? 'Disabled' : 'Enabled';
  document.getElementById('settings-hero-permission').textContent = settingsSnapshot?.settings?.system?.permissionLevel || 'medium';
}

function ensureWelcomeMessage() {
  if (hasRenderedWelcome) {
    return;
  }

  addMessage(
    `At your service, ${getHonorific()}. Type a command here.`,
    'assistant',
    assistantMeta('ready')
  );
  hasRenderedWelcome = true;
}

function setSettingsStatus(message, tone = 'info') {
  const palette = {
    info: 'var(--muted-color)',
    success: 'var(--success-color)',
    error: 'var(--danger-color)'
  };
  settingsStatusEl.textContent = message || '';
  settingsStatusEl.style.color = palette[tone] || palette.info;
}

function applySnapshot(snapshot) {
  settingsSnapshot = snapshot;
  updateBranding();
  populateSettingsForm();
  updateSettingsSummary();
  ensureWelcomeMessage();
}

function openSettingsPanel() {
  setActiveSettingsSection(activeSettingsSection || 'system');
  settingsOverlay.classList.add('open');
  setSettingsStatus('Settings are stored locally on this machine.', 'info');
  loadPhoneServerStatus();
  loadPhoneDevices();
}

function closeSettingsPanel() {
  if (document.body.classList.contains('settings-only')) {
    window.close();
    return;
  }
  settingsOverlay.classList.remove('open');
  inputBox.focus();
}

function initializeCompactSettingsLayout() {
  const panelHeader = document.querySelector('.panel-header');
  const panelActions = settingsFooterSection.querySelector('.panel-actions');
  const resetButton = document.getElementById('settings-reset-btn');
  resetButton.textContent = 'Reset';
  panelActions.classList.add('settings-header-actions');
  panelHeader.insertBefore(panelActions, settingsCloseBtn);
  settingsFooterSection.remove();

}

async function saveSettings() {
  try {
    setSettingsStatus('Saving settings...', 'info');
    const snapshot = await window.jarvis.saveSettings(collectSettingsPayload());
    applySnapshot(snapshot);
    setSettingsStatus('Settings saved successfully.', 'success');
    addMessage(`Settings updated. ${getAssistantDisplayName()} is ready, ${getHonorific()}.`, 'system', assistantMeta('settings'));
  } catch (err) {
    setSettingsStatus('Unable to save settings.', 'error');
  }
}

async function resetSettings() {
  try {
    setSettingsStatus('Resetting settings...', 'info');
    const snapshot = await window.jarvis.resetSettings();
    setActiveSettingsSection(null);
    applySnapshot(snapshot);
    setSettingsStatus('Settings reset to defaults.', 'success');
  } catch (err) {
    setSettingsStatus('Unable to reset settings.', 'error');
  }
}

function formatPairingCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function stopPairingCountdown() {
  if (phonePairingCountdownHandle) clearInterval(phonePairingCountdownHandle);
  phonePairingCountdownHandle = null;
}

function startPairingCountdown(expiresAt) {
  stopPairingCountdown();
  const update = () => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      stopPairingCountdown();
      phonePairingStatusEl.textContent = 'Pairing code expired.';
      phonePairingCountdownEl.textContent = 'Expired';
      phonePairingQrEl.classList.add('expired');
      phoneGenerateTokenBtn.textContent = 'Generate New QR';
      return;
    }
    phonePairingCountdownEl.textContent = `Expires in ${formatPairingCountdown(remaining)}`;
  };
  update();
  phonePairingCountdownHandle = setInterval(update, 1000);
}

async function generatePairingQR() {
  stopPairingCountdown();
  phoneGenerateTokenBtn.disabled = true;
  phonePairingTokenEl.textContent = '--------';
  phonePairingExpiryEl.textContent = '';
  phonePairingCountdownEl.textContent = '';
  phonePairingQrEl.hidden = true;
  phonePairingQrEl.removeAttribute('src');
  phonePairingQrEl.classList.remove('expired');
  phonePairingStatusEl.textContent = 'Waiting for Windows identity verification...';
  try {
    const result = await window.jarvis.generatePairingQR();
    if (result?.success !== true) {
      phonePairingStatusEl.textContent = result?.message || 'Identity verification required.';
      return;
    }
    phonePairingQrEl.src = result.qrDataUrl;
    phonePairingQrEl.hidden = false;
    phonePairingTokenEl.textContent = result.payload.pairingToken;
    phonePairingStatusEl.textContent = 'Identity verified. Scan this QR code with your phone.';
    phonePairingExpiryEl.textContent = `Expires at ${new Date(result.payload.expiresAt).toLocaleTimeString()}.`;
    phoneGenerateTokenBtn.textContent = 'Generate New QR';
    startPairingCountdown(result.payload.expiresAt);
    await loadPhoneServerStatus();
  } catch (_) {
    phonePairingStatusEl.textContent = 'Unable to generate pairing QR.';
  } finally {
    phoneGenerateTokenBtn.disabled = false;
  }
}

function renderPhoneServerStatus(status) {
  const safeStatus = status && typeof status === 'object' ? status : {};
  phoneServerStatusEl.textContent = safeStatus.serverStatus === 'listening' ? 'Listening' : 'Stopped';
  phoneServerAddressEl.textContent = safeStatus.currentIp || '--';
  phoneServerPortEl.textContent = Number.isInteger(safeStatus.currentPort) ? String(safeStatus.currentPort) : '--';
  phoneServerDevicesEl.textContent = String(Array.isArray(safeStatus.connectedDevices) ? safeStatus.connectedDevices.length : 0);
  phoneServerVersionEl.textContent = String(safeStatus.currentVersion ?? 1);
}

function formatDeviceDate(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value).toLocaleString() : 'Unknown';
}

function renderPhoneDevices(devices) {
  phoneDeviceListEl.replaceChildren();
  if (!Array.isArray(devices) || devices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'phone-device-empty';
    empty.textContent = 'No trusted phones paired.';
    phoneDeviceListEl.appendChild(empty);
    return;
  }

  devices.forEach(device => {
    const card = document.createElement('article');
    card.className = 'phone-device-card';
    card.dataset.deviceId = device.deviceId;

    const heading = document.createElement('div');
    heading.className = 'phone-device-card-heading';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = device.deviceName;
    const id = document.createElement('span');
    id.textContent = device.deviceId;
    identity.append(name, id);
    const dates = document.createElement('div');
    dates.className = 'phone-device-dates';
    dates.textContent = `Paired ${formatDeviceDate(device.pairedAt)} · Last seen ${formatDeviceDate(device.lastSeen)}`;
    heading.append(identity, dates);

    const permissions = document.createElement('div');
    permissions.className = 'phone-device-permissions';
    PHONE_PERMISSIONS.forEach(([permission, label]) => {
      const control = document.createElement('label');
      control.className = 'phone-permission-toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.permission = permission;
      checkbox.checked = device.permissions?.[permission] === true;
      const text = document.createElement('span');
      text.textContent = label;
      control.append(checkbox, text);
      permissions.appendChild(control);
    });

    const actions = document.createElement('div');
    actions.className = 'phone-device-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary-btn';
    save.textContent = 'Save Permissions';
    save.addEventListener('click', async () => {
      const updates = {};
      card.querySelectorAll('[data-permission]').forEach(input => {
        updates[input.dataset.permission] = input.checked;
      });
      try {
        await window.jarvis.updatePhonePermissions(device.deviceId, updates);
        setSettingsStatus(`Permissions saved for ${device.deviceName}.`, 'success');
      } catch (_) {
        setSettingsStatus('Unable to save device permissions.', 'error');
      }
    });

    const disconnect = document.createElement('button');
    disconnect.type = 'button';
    disconnect.className = 'secondary-btn';
    disconnect.textContent = 'Disconnect Device';
    disconnect.addEventListener('click', async () => {
      await window.jarvis.disconnectPhoneDevice(device.deviceId);
      setSettingsStatus(`${device.deviceName} disconnected.`, 'success');
      await loadPhoneDevices();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-btn';
    remove.textContent = 'Remove Device';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove ${device.deviceName} from trusted devices?`)) return;
      await window.jarvis.removePhoneDevice(device.deviceId);
      setSettingsStatus(`${device.deviceName} removed.`, 'success');
      await loadPhoneDevices();
    });

    actions.append(save, disconnect, remove);
    card.append(heading, permissions, actions);
    phoneDeviceListEl.appendChild(card);
  });
}

async function loadPhoneDevices() {
  if (!window.jarvis?.getPhoneDevices) return;
  try {
    renderPhoneDevices(await window.jarvis.getPhoneDevices());
  } catch (_) {
    renderPhoneDevices([]);
    setSettingsStatus('Unable to load trusted phones.', 'error');
  }
}

async function loadPhoneServerStatus() {
  if (!window.jarvis?.getPhoneServerStatus) return;
  try {
    renderPhoneServerStatus(await window.jarvis.getPhoneServerStatus());
  } catch (_) {
    renderPhoneServerStatus({ serverStatus: 'stopped', currentVersion: 1, connectedDevices: [] });
    setSettingsStatus('Unable to load phone server status.', 'error');
  }
}

inputBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSend();
  }
});

document.getElementById(fieldIds.assistantTtsVolume).addEventListener('input', updateTtsSliderLabels);
document.getElementById(fieldIds.assistantTtsRate).addEventListener('input', updateTtsSliderLabels);
document.getElementById(fieldIds.glassTint).addEventListener('input', event => scheduleGlassTintUpdate(event.target.value));
document.querySelectorAll('.permission-option').forEach(button => {
  button.addEventListener('click', () => {
    document.getElementById(fieldIds.systemPermissionLevel).value = button.dataset.permission;
    updatePermissionScale();
  });
});

sendBtn.addEventListener('click', handleSend);
chatViewBtn.addEventListener('click', () => setWorkspaceView('chat'));
activityViewBtn.addEventListener('click', () => setWorkspaceView('activity'));
document.getElementById('clear-notifications-btn').addEventListener('click', () => {
  notificationHistory = [];
  saveStoredList(NOTIFICATION_STORAGE_KEY, notificationHistory);
  renderNotifications();
});
document.getElementById('alarm-dismiss-btn').addEventListener('click', () => {
  stopScheduleSound();
  if (activeAlarmId) updateSchedule(activeAlarmId, { status: 'completed' });
  activeAlarmId = null;
  alarmOverlay.hidden = true;
});
document.getElementById('alarm-snooze-btn').addEventListener('click', () => {
  if (activeAlarmId) {
    snoozeSchedule(activeAlarmId);
  }
  activeAlarmId = null;
  alarmOverlay.hidden = true;
});
window.addEventListener('beforeunload', stopScheduleSound);
quickBtns.forEach(button => {
  button.addEventListener('click', () => {
    const command = button.dataset.cmd;
    if (command) {
      sendCommand(command);
    }
  });
});

closeBtn.addEventListener('click', () => window.close());
settingsBtn.addEventListener('click', openSettingsPanel);
assistantMuteBtn.addEventListener('click', toggleAssistantMute);
settingsCloseBtn.addEventListener('click', closeSettingsPanel);
settingsNavButtons.forEach(button => {
  button.addEventListener('click', () => {
    const sectionName = button.dataset.sectionTarget;
    setActiveSettingsSection(sectionName);
    if (sectionName === 'phone') {
      loadPhoneServerStatus();
      loadPhoneDevices();
    }
  });
});
systemOptionButtons.forEach(button => {
  button.addEventListener('click', () => {
    setActiveSystemBlock(button.dataset.systemBlockTarget);
    const settingsContent = document.querySelector('.settings-content');
    if (settingsContent) settingsContent.scrollTop = 0;
  });
});
document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
document.getElementById('settings-reset-btn').addEventListener('click', resetSettings);
phoneGenerateTokenBtn.addEventListener('click', generatePairingQR);
modeAddBtn.addEventListener('click', () => {
  if (modeDrafts.length >= MODE_LIMIT) {
    setSettingsStatus(`Mode limit reached. Remove one of the ${MODE_LIMIT} saved modes before adding another.`, 'error');
    return;
  }
  modeDrafts.push(createEmptyMode());
  selectedModeIndex = modeDrafts.length - 1;
  selectedModeApps.set(selectedModeIndex, 0);
  renderModeEditor();
  setActiveSettingsSection('modes');
});
settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) {
    closeSettingsPanel();
  }
});

if (window.jarvis) {
  window.jarvis.onSettingsChanged((snapshot) => {
    applySnapshot(snapshot);
  });
  window.jarvis.onOpenSettings?.(openSettingsPanel);
}

async function initialize() {
  initializeCompactSettingsLayout();
  updateAssistantMuteButton();
  const settingsOnly = new URLSearchParams(window.location.search).get('settings') === '1';
  if (settingsOnly) {
    document.body.classList.add('settings-only');
    document.title = 'Assistant Settings';
  }
  if (!window.jarvis) {
    settingsSnapshot = {
      settings: {
        assistant: { displayName: 'Jaanu', title: 'Desktop Assistant', honorific: 'sir' },
        chat: { activationShortcut: 'Alt+Space', themeId: 'graphite', glassTint: 42, maxHistory: 500 },
        system: { permissionLevel: 'medium' },
        user: { profile: {} },
        modes: []
      },
      availableThemes: []
    };
    updateBranding();
    ensureWelcomeMessage();
    renderActivity();
    setWorkspaceView('chat');
    if (settingsOnly) openSettingsPanel();
    return;
  }
  const snapshot = await window.jarvis.getSettings();
  applySnapshot(snapshot);
  if (!window.jarvis) {
    scheduleItems.forEach(item => {
      if (item.status === 'scheduled') armSchedule(item);
    });
  }
  renderActivity();
  setWorkspaceView('chat');
  if (settingsOnly) {
    document.title = `${getAssistantDisplayName()} Settings`;
    openSettingsPanel();
  } else {
    inputBox.focus();
  }
}

initialize();
