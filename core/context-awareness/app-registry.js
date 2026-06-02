const DEV_APPS = Object.freeze([
  'Code.exe',
  'WindowsTerminal.exe',
  'cmd.exe',
  'powershell.exe',
  'docker desktop.exe'
]);

const STREAM_APPS = Object.freeze([
  'obs64.exe',
  'streamlabs.exe'
]);

const MEDIA_APPS = Object.freeze([
  'Spotify.exe',
  'chrome.exe'
]);

const GAME_APPS = Object.freeze([
  'steam.exe'
]);

const WORK_APPS = Object.freeze([
  'Teams.exe',
  'OUTLOOK.EXE',
  'Zoom.exe'
]);

const CATEGORIES = Object.freeze({
  DEV_APPS,
  STREAM_APPS,
  MEDIA_APPS,
  GAME_APPS,
  WORK_APPS
});

function normalizeProcessName(processName) {
  return String(processName || '').trim().toLowerCase();
}

function getCategoriesForApp(processName) {
  const normalized = normalizeProcessName(processName);
  if (!normalized) return [];

  return Object.entries(CATEGORIES)
    .filter(([, apps]) => apps.some(app => normalizeProcessName(app) === normalized))
    .map(([category]) => category);
}

function isKnownApp(processName) {
  return getCategoriesForApp(processName).length > 0;
}

module.exports = {
  DEV_APPS,
  STREAM_APPS,
  MEDIA_APPS,
  GAME_APPS,
  WORK_APPS,
  CATEGORIES,
  getCategoriesForApp,
  isKnownApp
};
