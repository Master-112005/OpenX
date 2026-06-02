const MODE_ID = 'DEV_MODE';

function hasApp(apps, candidates) {
  const normalized = new Set((apps || []).map(app => String(app || '').toLowerCase()));
  return candidates.some(candidate => normalized.has(candidate.toLowerCase()));
}

function score(context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  if (['code.exe', 'devenv.exe', 'webstorm.exe'].includes(activeApp)) value += 45;
  if (['windowsterminal.exe', 'cmd.exe', 'powershell.exe'].includes(activeApp)) value += 30;
  if (hasApp(runningApps, ['Code.exe', 'WindowsTerminal.exe', 'cmd.exe', 'powershell.exe'])) value += 20;
  if (hasApp(runningApps, ['docker desktop.exe'])) value += 20;
  if (/\b(openx|git|npm|node|terminal|powershell|visual studio code)\b/.test(title)) value += 10;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    preloadCodingCommands: true,
    prioritizeTerminalIntents: true,
    verbosity: 'reduced',
    developerShortcuts: true,
    prioritizeSystemAutomation: true,
    suppressSpeech: false,
    overlayNotifications: true
  };
}

module.exports = {
  MODE_ID,
  score,
  getBehavior
};
