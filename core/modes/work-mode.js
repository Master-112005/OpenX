const MODE_ID = 'WORK_MODE';

function hasApp(apps, candidates) {
  const normalized = new Set((apps || []).map(app => String(app || '').toLowerCase()));
  return candidates.some(candidate => normalized.has(candidate.toLowerCase()));
}

function score(context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  if (['teams.exe', 'outlook.exe', 'zoom.exe', 'winword.exe', 'excel.exe'].includes(activeApp)) value += 55;
  if (hasApp(runningApps, ['Teams.exe', 'OUTLOOK.EXE', 'Zoom.exe'])) value += 30;
  if (/\b(meeting|calendar|inbox|document|spreadsheet|presentation)\b/.test(title)) value += 15;
  if (context.microphoneActive && ['teams.exe', 'zoom.exe'].includes(activeApp)) value += 15;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    reduceInterruptions: true,
    suppressUnnecessarySpeech: true,
    productivityShortcuts: true,
    overlayNotifications: true,
    verbosity: 'reduced'
  };
}

module.exports = {
  MODE_ID,
  score,
  getBehavior
};
