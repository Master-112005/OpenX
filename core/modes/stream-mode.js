const MODE_ID = 'STREAM_MODE';

function hasApp(apps, candidates) {
  const normalized = new Set((apps || []).map(app => String(app || '').toLowerCase()));
  return candidates.some(candidate => normalized.has(candidate.toLowerCase()));
}

function score(context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  if (['obs64.exe', 'streamlabs.exe'].includes(activeApp)) value += 60;
  if (hasApp(runningApps, ['obs64.exe', 'streamlabs.exe'])) value += 45;
  if (context.microphoneActive) value += 20;
  if (context.fullscreen && /stream|record|broadcast|obs/.test(title)) value += 15;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    muteAssistantSpeech: true,
    overlayNotificationsOnly: true,
    suppressInterruptions: true,
    noisyFeedback: false,
    silentExecutionConfirmations: true,
    reducePolling: false
  };
}

module.exports = {
  MODE_ID,
  score,
  getBehavior
};
