const MODE_ID = 'GAME_MODE';

function hasApp(apps, candidates) {
  const normalized = new Set((apps || []).map(app => String(app || '').toLowerCase()));
  return candidates.some(candidate => normalized.has(candidate.toLowerCase()));
}

function score(context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  if (context.fullscreen) value += 35;
  if (['steam.exe', 'game.exe', 'valorant.exe', 'cs2.exe', 'fortniteclient-win64-shipping.exe'].includes(activeApp)) value += 50;
  if (hasApp(runningApps, ['steam.exe'])) value += 25;
  if (/\b(game|steam|valorant|counter-strike|fortnite)\b/.test(title)) value += 15;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    reducePollingFrequency: true,
    disableOverlays: true,
    suspendHeavyStt: true,
    suppressSpeech: true,
    minimizeCpuUsage: true
  };
}

module.exports = {
  MODE_ID,
  score,
  getBehavior
};
