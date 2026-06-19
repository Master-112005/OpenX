const Logger = require('../shared/index').Logger;
const signals = require('./signals');
const contextEngineModule = require('./context-engine');

const MODES = Object.freeze({
  DEV_MODE: 'DEV_MODE',
  STREAM_MODE: 'STREAM_MODE',
  GAME_MODE: 'GAME_MODE',
  MEDIA_MODE: 'MEDIA_MODE',
  WORK_MODE: 'WORK_MODE',
  FOCUS_MODE: 'FOCUS_MODE'
});

const FOCUS_ACTIVITY_MS = 30 * 60 * 1000;

function normalizedSet(values) {
  return new Set((values || []).map(value => String(value || '').toLowerCase()));
}

function hasApp(apps, candidates) {
  const normalized = normalizedSet(apps);
  return candidates.some(candidate => normalized.has(String(candidate || '').toLowerCase()));
}

function scoreFromProfile(profile, context = {}) {
  const runningApps = context.runningApps || [];
  const activeApp = String(context.activeApp || '').toLowerCase();
  const title = String(context.activeTitle || '').toLowerCase();
  let value = 0;

  for (const rule of profile.rules || []) {
    if (rule.activeApps?.includes(activeApp)) value += rule.score;
    if (rule.runningApps && hasApp(runningApps, rule.runningApps)) value += rule.score;
    if (rule.titlePattern?.test(title)) value += rule.score;
    if (rule.when?.(context, { activeApp, title, runningApps })) value += rule.score;
  }

  return Math.min(100, value);
}

const MODE_PROFILES = Object.freeze({
  [MODES.DEV_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ activeApps: Object.freeze(['code.exe', 'devenv.exe', 'webstorm.exe']), score: 45 }),
      Object.freeze({ activeApps: Object.freeze(['windowsterminal.exe', 'cmd.exe', 'powershell.exe']), score: 30 }),
      Object.freeze({ runningApps: Object.freeze(['Code.exe', 'WindowsTerminal.exe', 'cmd.exe', 'powershell.exe']), score: 20 }),
      Object.freeze({ runningApps: Object.freeze(['docker desktop.exe']), score: 20 }),
      Object.freeze({ titlePattern: /\b(openx|git|npm|node|terminal|powershell|visual studio code)\b/, score: 10 })
    ]),
    behavior: Object.freeze({
      preloadCodingCommands: true,
      prioritizeTerminalIntents: true,
      verbosity: 'reduced',
      developerShortcuts: true,
      prioritizeSystemAutomation: true,
      suppressSpeech: false,
      overlayNotifications: true
    })
  }),
  [MODES.STREAM_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ activeApps: Object.freeze(['obs64.exe', 'streamlabs.exe']), score: 60 }),
      Object.freeze({ runningApps: Object.freeze(['obs64.exe', 'streamlabs.exe']), score: 45 }),
      Object.freeze({ when: context => Boolean(context.microphoneActive), score: 20 }),
      Object.freeze({ when: (context, derived) => Boolean(context.fullscreen) && /stream|record|broadcast|obs/.test(derived.title), score: 15 })
    ]),
    behavior: Object.freeze({
      muteAssistantSpeech: true,
      overlayNotificationsOnly: true,
      suppressInterruptions: true,
      noisyFeedback: false,
      silentExecutionConfirmations: true,
      reducePolling: false
    })
  }),
  [MODES.GAME_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ when: context => Boolean(context.fullscreen), score: 35 }),
      Object.freeze({ activeApps: Object.freeze(['steam.exe', 'game.exe', 'valorant.exe', 'cs2.exe', 'fortniteclient-win64-shipping.exe']), score: 50 }),
      Object.freeze({ runningApps: Object.freeze(['steam.exe']), score: 25 }),
      Object.freeze({ titlePattern: /\b(game|steam|valorant|counter-strike|fortnite)\b/, score: 15 })
    ]),
    behavior: Object.freeze({
      reducePollingFrequency: true,
      disableOverlays: true,
      suspendHeavyStt: true,
      suppressSpeech: true,
      minimizeCpuUsage: true
    })
  }),
  [MODES.MEDIA_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ activeApps: Object.freeze(['spotify.exe']), score: 55 }),
      Object.freeze({ when: (context, derived) => derived.activeApp === 'chrome.exe' && /\b(youtube|music|spotify)\b/.test(derived.title), score: 50 }),
      Object.freeze({ runningApps: Object.freeze(['Spotify.exe', 'chrome.exe']), score: 15 }),
      Object.freeze({ when: context => Boolean(context.audioDevice), score: 10 })
    ]),
    behavior: Object.freeze({
      prioritizeMediaCommands: true,
      optimizeVolumeControls: true,
      reduceNotifications: true,
      suppressSpeech: false,
      overlayNotifications: true
    })
  }),
  [MODES.WORK_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ activeApps: Object.freeze(['teams.exe', 'outlook.exe', 'zoom.exe', 'winword.exe', 'excel.exe']), score: 55 }),
      Object.freeze({ runningApps: Object.freeze(['Teams.exe', 'OUTLOOK.EXE', 'Zoom.exe']), score: 30 }),
      Object.freeze({ titlePattern: /\b(meeting|calendar|inbox|document|spreadsheet|presentation)\b/, score: 15 }),
      Object.freeze({ when: (context, derived) => Boolean(context.microphoneActive) && ['teams.exe', 'zoom.exe'].includes(derived.activeApp), score: 15 })
    ]),
    behavior: Object.freeze({
      reduceInterruptions: true,
      suppressUnnecessarySpeech: true,
      productivityShortcuts: true,
      overlayNotifications: true,
      verbosity: 'reduced'
    })
  }),
  [MODES.FOCUS_MODE]: Object.freeze({
    rules: Object.freeze([
      Object.freeze({ when: context => Boolean(context.fullscreen && context.activeApp), score: 35 }),
      Object.freeze({ when: context => Number(context.uninterruptedActivityMs || 0) >= FOCUS_ACTIVITY_MS, score: 65 }),
      Object.freeze({ when: context => Boolean(context.manualFocusRequested), score: 100 })
    ]),
    behavior: Object.freeze({
      minimizeResponses: true,
      suppressNonEssentialNotifications: true,
      reduceVisualInterruptions: true,
      suppressSpeech: true,
      verbosity: 'minimal'
    })
  })
});

const MODE_HANDLERS = Object.freeze(
  Object.fromEntries(Object.entries(MODE_PROFILES).map(([mode, profile]) => [
    mode,
    Object.freeze({
      score: context => scoreFromProfile(profile, context),
      getBehavior: () => ({ ...profile.behavior })
    })
  ]))
);

const DEFAULT_SCORES = Object.freeze({
  [MODES.DEV_MODE]: 0,
  [MODES.STREAM_MODE]: 0,
  [MODES.GAME_MODE]: 0,
  [MODES.MEDIA_MODE]: 0,
  [MODES.WORK_MODE]: 0,
  [MODES.FOCUS_MODE]: 0
});

class ModeEngine {
  constructor(options = {}) {
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.signals = options.signals || signals;
    this.contextEngine = options.contextEngine || contextEngineModule.createEngine(options);
    this.now = options.now || (() => Date.now());
    this.handlers = options.handlers || MODE_HANDLERS;
    this.threshold = options.threshold ?? 60;
    this.hysteresis = options.hysteresis ?? 15;
    this.minDominantMs = options.minDominantMs ?? 10000;
    this.minModeDurationMs = options.minModeDurationMs ?? 15000;
    this.cooldownMs = options.cooldownMs ?? 5000;
    this.smoothingFactor = options.smoothingFactor ?? 0.45;
    this.scoreDecay = options.scoreDecay ?? 0.85;
    this.unsubscribers = [];
    this.currentMode = null;
    this.enteredAt = null;
    this.lastTransitionAt = 0;
    this.dominantCandidate = null;
    this.dominantSince = 0;
    this.scores = { ...DEFAULT_SCORES };
    this.rawScores = { ...DEFAULT_SCORES };
    this.behavior = {};
  }

  start() {
    if (this.unsubscribers.length > 0) return;

    if (typeof this.contextEngine.start === 'function') {
      this.contextEngine.start();
    }

    this.unsubscribers = [
      this.contextEngine.subscribe(snapshot => this.evaluate(snapshot))
    ];
  }

  stop() {
    this.unsubscribers.forEach(unsubscribe => unsubscribe());
    this.unsubscribers = [];

    if (typeof this.contextEngine.stop === 'function') {
      this.contextEngine.stop();
    }
  }

  evaluate(snapshot = null) {
    const context = snapshot || this.contextEngine.getSnapshot();
    const evaluatedAt = this.now();
    const rawScores = this.computeRawScores(context);
    const scores = this._smoothScores(rawScores);
    const dominantMode = this.getDominantMode(scores);

    this.rawScores = rawScores;
    this.scores = scores;

    if (dominantMode) {
      this.logger.info(`[Mode] ${dominantMode} score -> ${Math.round(scores[dominantMode])}`);
    }

    this._considerTransition(dominantMode, scores, context, evaluatedAt);
    return this.getState();
  }

  computeRawScores(context = {}) {
    return Object.entries(this.handlers).reduce((scores, [mode, handler]) => {
      try {
        scores[mode] = Math.max(0, Math.min(100, Number(handler.score(context)) || 0));
      } catch (err) {
        this.logger.warn(`[Mode] Failed to score ${mode}`, err.message);
        scores[mode] = 0;
      }
      return scores;
    }, { ...DEFAULT_SCORES });
  }

  getDominantMode(scores = this.scores) {
    const ranked = Object.entries(scores)
      .sort((left, right) => right[1] - left[1]);

    if (!ranked.length || ranked[0][1] < this.threshold) {
      return null;
    }

    return ranked[0][0];
  }

  getState() {
    const now = this.now();
    return {
      currentMode: this.currentMode,
      scores: { ...this.scores },
      rawScores: { ...this.rawScores },
      enteredAt: this.enteredAt,
      duration: this.enteredAt ? now - this.enteredAt : 0,
      behavior: { ...this.behavior },
      dominantCandidate: this.dominantCandidate,
      dominantSince: this.dominantSince
    };
  }

  _smoothScores(rawScores) {
    return Object.keys(DEFAULT_SCORES).reduce((scores, mode) => {
      const previous = this.scores[mode] || 0;
      const decayedPrevious = previous * this.scoreDecay;
      const raw = rawScores[mode] || 0;
      scores[mode] = Math.round((decayedPrevious * (1 - this.smoothingFactor)) + (raw * this.smoothingFactor));
      return scores;
    }, {});
  }

  _considerTransition(dominantMode, scores, context, evaluatedAt) {
    if (!dominantMode) {
      this.dominantCandidate = null;
      this.dominantSince = 0;
      if (this.currentMode && this._canLeaveCurrentMode(evaluatedAt)) {
        this._exitMode(evaluatedAt);
      }
      return;
    }

    if (dominantMode !== this.dominantCandidate) {
      this.dominantCandidate = dominantMode;
      this.dominantSince = evaluatedAt;
      return;
    }

    const dominantDuration = evaluatedAt - this.dominantSince;
    if (dominantDuration < this.minDominantMs) {
      return;
    }

    if (!this.currentMode) {
      this._enterMode(dominantMode, context, evaluatedAt);
      return;
    }

    if (dominantMode === this.currentMode) {
      this.behavior = this._behaviorFor(dominantMode, context);
      return;
    }

    if (!this._canLeaveCurrentMode(evaluatedAt)) {
      this.logger.info(`[Mode] ${dominantMode} suppressed due to minimum mode duration`);
      return;
    }

    if (evaluatedAt - this.lastTransitionAt < this.cooldownMs) {
      this.logger.info(`[Mode] ${dominantMode} suppressed due to cooldown`);
      return;
    }

    const currentScore = scores[this.currentMode] || 0;
    const nextScore = scores[dominantMode] || 0;
    if (nextScore < currentScore + this.hysteresis) {
      return;
    }

    this._switchMode(dominantMode, context, evaluatedAt);
  }

  _enterMode(mode, context, timestamp) {
    this.currentMode = mode;
    this.enteredAt = timestamp;
    this.lastTransitionAt = timestamp;
    this.behavior = this._behaviorFor(mode, context);
    this.logger.info(`[Mode] Entered ${mode}`);

    const state = this.getState();
    this.contextEngine.updateMode(state);
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_ENTERED, state);
  }

  _switchMode(nextMode, context, timestamp) {
    const previousMode = this.currentMode;
    const previousState = this.getState();
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_EXITED, {
      ...previousState,
      exitedMode: previousMode
    });

    this.currentMode = nextMode;
    this.enteredAt = timestamp;
    this.lastTransitionAt = timestamp;
    this.behavior = this._behaviorFor(nextMode, context);
    this.logger.info(`[Mode] Switched ${previousMode} -> ${nextMode}`);

    const state = this.getState();
    this.contextEngine.updateMode(state);
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_CHANGED, {
      from: previousMode,
      to: nextMode,
      state
    });
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_ENTERED, state);
  }

  _exitMode(timestamp) {
    const previousMode = this.currentMode;
    const previousState = this.getState();
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_EXITED, {
      ...previousState,
      exitedMode: previousMode
    });

    this.currentMode = null;
    this.enteredAt = null;
    this.lastTransitionAt = timestamp;
    this.behavior = {};
    this.logger.info(`[Mode] Exited ${previousMode}`);

    const state = this.getState();
    this.contextEngine.updateMode(state);
    this.signals.emit(this.signals.SIGNAL_EVENTS.MODE_CHANGED, {
      from: previousMode,
      to: null,
      state
    });
  }

  _canLeaveCurrentMode(timestamp) {
    if (this.enteredAt === null) {
      return true;
    }

    return timestamp - this.enteredAt >= this.minModeDurationMs;
  }

  _behaviorFor(mode, context) {
    const handler = this.handlers[mode];
    if (!handler || typeof handler.getBehavior !== 'function') {
      return {};
    }

    return handler.getBehavior(context);
  }
}

const defaultEngine = new ModeEngine();

module.exports = {
  MODES,
  MODE_PROFILES,
  MODE_HANDLERS,
  DEFAULT_SCORES,
  FOCUS_ACTIVITY_MS,
  ModeEngine,
  createEngine: options => new ModeEngine(options),
  start: defaultEngine.start.bind(defaultEngine),
  stop: defaultEngine.stop.bind(defaultEngine),
  evaluate: defaultEngine.evaluate.bind(defaultEngine),
  getState: defaultEngine.getState.bind(defaultEngine),
  computeRawScores: defaultEngine.computeRawScores.bind(defaultEngine),
  getDominantMode: defaultEngine.getDominantMode.bind(defaultEngine)
};
