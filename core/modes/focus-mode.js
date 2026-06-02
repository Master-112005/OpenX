const MODE_ID = 'FOCUS_MODE';
const FOCUS_ACTIVITY_MS = 30 * 60 * 1000;

function score(context = {}) {
  let value = 0;

  if (context.fullscreen && context.activeApp) value += 35;
  if (context.uninterruptedActivityMs >= FOCUS_ACTIVITY_MS) value += 65;
  if (context.manualFocusRequested) value += 100;

  return Math.min(100, value);
}

function getBehavior() {
  return {
    minimizeResponses: true,
    suppressNonEssentialNotifications: true,
    reduceVisualInterruptions: true,
    suppressSpeech: true,
    verbosity: 'minimal'
  };
}

module.exports = {
  MODE_ID,
  FOCUS_ACTIVITY_MS,
  score,
  getBehavior
};
