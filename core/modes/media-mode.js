const MODE_ID = 'MEDIA_MODE';

function hasApp(apps, candidates) {
  const normalized = new Set((apps || []).map(app => String(app || '').toLowerCase()));
  return candidates.some(candidate => normalized.has(candidate.toLowerCase()));
}

function score(context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  if (['spotify.exe'].includes(activeApp)) value += 55;
  if (activeApp === 'chrome.exe' && /\b(youtube|music|spotify)\b/.test(title)) value += 50;
  if (hasApp(runningApps, ['Spotify.exe', 'chrome.exe'])) value += 15;
  if (context.audioDevice) value += 10;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    prioritizeMediaCommands: true,
    optimizeVolumeControls: true,
    reduceNotifications: true,
    suppressSpeech: false,
    overlayNotifications: true
  };
}

module.exports = {
  MODE_ID,
  score,
  getBehavior
};
