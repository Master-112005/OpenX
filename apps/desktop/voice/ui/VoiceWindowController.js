'use strict';

const VoiceConfiguration = require('./VoiceConfiguration');
const VoiceOverlayIPC = require('./VoiceOverlayIPC');
const { OverlayCreationFailed, RendererUnavailable } = require('./VoiceUIErrors');

/**
 * Purpose: Owns the floating Voice overlay Electron window.
 * Responsibility: Create, position, show, hide, focus, z-order, transparency, and renderer updates.
 * Dependencies: Electron BrowserWindow/screen supplied through dependency injection and VoiceOverlayIPC.
 * Lifecycle: Created lazily, kept lightweight, hidden when not needed, destroyed during runtime cleanup.
 * Future extension notes: Do not add speech recognition, microphone capture, NLP, or command execution here.
 */
class VoiceWindowController {
  /**
   * Create a Voice window controller.
   * @param {{BrowserWindow?: Function, screen?: object, configuration?: object|VoiceConfiguration, ipc?: VoiceOverlayIPC, preloadPath?: string, logger?: object}} dependencies Controller dependencies.
   */
  constructor(dependencies = {}) {
    this.BrowserWindow = dependencies.BrowserWindow || null;
    this.screen = dependencies.screen || null;
    this.configuration = dependencies.configuration instanceof VoiceConfiguration
      ? dependencies.configuration
      : new VoiceConfiguration(dependencies.configuration || {});
    this.ipc = dependencies.ipc || new VoiceOverlayIPC({ logger: dependencies.logger });
    this.preloadPath = dependencies.preloadPath || '';
    this.logger = dependencies.logger || null;
    this.window = null;
    this.visible = false;
    this.lastView = null;
    this.sizeMode = 'compact';
    this.activeSize = { ...this.configuration.size };
    this.resizeTimer = null;
    this.boundsAnimationTimer = null;
    this.pendingSizeMode = null;
    this.pendingSize = null;
    this.lastBounds = null;
  }

  /**
   * Create the Electron overlay window when needed.
   * @returns {object}
   */
  createWindow() {
    if (this.window && !this._isDestroyed(this.window)) return this.window;
    if (typeof this.BrowserWindow !== 'function') {
      throw new OverlayCreationFailed('Voice overlay window cannot be created without BrowserWindow.');
    }
    const { width, height } = this.configuration.size;
    try {
      this.window = new this.BrowserWindow({
        width,
        height,
        minWidth: width,
        minHeight: height,
        transparent: true,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        show: false,
        hasShadow: true,
        backgroundColor: '#00000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: this.preloadPath || undefined
        }
      });
      this.ipc.attach(this.window.webContents);
      this._attachWindowRecovery(this.window);
      this._loadRenderer();
      this._applySizeMode('compact', { snap: true });
      this._log('Overlay Window Created');
      return this.window;
    } catch (error) {
      throw new OverlayCreationFailed('Voice overlay window creation failed.', {
        details: { error: error.message }
      });
    }
  }

  /**
   * Position the overlay centered horizontally and slightly above screen center.
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  position(size = this._currentSize(), options = {}) {
    const win = this.window;
    if (!win || this._isDestroyed(win)) {
      throw new RendererUnavailable('Voice overlay window is unavailable.');
    }
    const { width, height } = size;
    const display = this._getTargetDisplay();
    const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1280, height: 720 };
    const vertical = String(this.configuration.position?.vertical || 'top').toLowerCase();
    const yOffset = Number(this.configuration.position?.yOffset || 0);
    const y = vertical === 'top'
      ? area.y + yOffset
      : area.y + ((area.height - height) / 2) + yOffset;
    const bounds = {
      x: Math.round(area.x + ((area.width - width) / 2)),
      y: Math.round(y),
      width,
      height
    };
    if (this._boundsEqual(this.lastBounds, bounds)) return bounds;
    this._moveToBounds(bounds, options);
    return bounds;
  }

  /**
   * Show the overlay without stealing permanent focus.
   * @param {object} view Renderer view payload.
   * @returns {{visible: boolean, view: object}}
   */
  show(view = {}) {
    const win = this.createWindow();
    this._setSizeMode('compact', { immediate: true, snap: true });
    if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof win.showInactive === 'function') win.showInactive();
    else if (typeof win.show === 'function') win.show();
    this.visible = true;
    this.updateState(view);
    this.ipc.send(VoiceOverlayIPC.OPERATIONS.SHOW_OVERLAY, { view });
    this._log('Overlay Shown', { state: view.state });
    return { visible: true, view };
  }

  /**
   * Hide the overlay.
   * @returns {{visible: boolean}}
   */
  hide() {
    if (this.window && !this._isDestroyed(this.window) && typeof this.window.hide === 'function') {
      this.window.hide();
    }
    this.visible = false;
    this._setSizeMode('compact', { immediate: true, snap: true });
    if (this.window && !this._isDestroyed(this.window)) {
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.HIDE_OVERLAY, {});
    }
    this._log('Overlay Hidden');
    return { visible: false };
  }

  /**
   * Update state payload.
   * @param {object} view Renderer view payload.
   * @returns {{updated: boolean, view: object}}
   */
  updateState(view = {}) {
    this.lastView = view;
    if (this.window && !this._isDestroyed(this.window)) {
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.UPDATE_STATE, { view });
      if (this._shouldCollapseForState(view?.state)) {
        this._setSizeMode('compact', { delayMs: 140 });
        this.ipc.send(VoiceOverlayIPC.OPERATIONS.DISPLAY_ASSISTANT_RESULT, {});
      }
    }
    return { updated: true, view };
  }

  /**
   * Update transcript payload.
   * @param {object} transcript Transcript payload.
   * @returns {{updated: boolean, transcript: object}}
   */
  updateTranscript(transcript = {}) {
    if (this.window && !this._isDestroyed(this.window)) {
      if (transcript?.partial || transcript?.transcript) {
        this._setSizeMode('compact', { delayMs: 90 });
      }
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.UPDATE_TRANSCRIPT, transcript);
    }
    return { updated: true, transcript };
  }

  /**
   * Update assistant result presentation payload.
   * @param {object} payload Renderer-safe assistant result payload.
   * @returns {{updated: boolean, payload: object}}
   */
  updateAssistantResult(payload = {}) {
    if (this.window && !this._isDestroyed(this.window)) {
      const displayMode = this._sizeModeForAssistantResult(payload);
      this._setSizeMode(displayMode, {
        immediate: true,
        size: this._sizeForAssistantResult(payload, displayMode)
      });
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.DISPLAY_ASSISTANT_RESULT, { ...payload, displayMode });
    }
    return { updated: true, payload };
  }

  /**
   * Display an error payload.
   * @param {object} view Error view payload.
   * @returns {{displayed: boolean, view: object}}
   */
  displayError(view = {}) {
    if (!this.window || this._isDestroyed(this.window)) this.createWindow();
    this.visible = true;
    this._setSizeMode('compact', { immediate: true, snap: true });
    if (typeof this.window.showInactive === 'function') this.window.showInactive();
    this.ipc.send(VoiceOverlayIPC.OPERATIONS.DISPLAY_ERROR, { view });
    return { displayed: true, view };
  }

  /**
   * Destroy the overlay window.
   * @returns {{destroyed: boolean}}
   */
  destroy() {
    if (this.window && !this._isDestroyed(this.window) && typeof this.window.destroy === 'function') {
      this.window.destroy();
    }
    this.window = null;
    this.visible = false;
    this._clearResizeTimer();
    this._clearBoundsAnimation();
    return { destroyed: true };
  }

  /**
   * Return controller status.
   * @returns {{created: boolean, visible: boolean, bounds: object|null}}
   */
  getStatus() {
    return {
      created: Boolean(this.window && !this._isDestroyed(this.window)),
      visible: this.visible,
      bounds: this.window && typeof this.window.getBounds === 'function' ? this.window.getBounds() : null
    };
  }

  /**
   * Load a lightweight built-in overlay renderer.
   * @returns {void}
   * @private
   */
  _loadRenderer() {
    if (!this.window?.loadURL) return;
    const html = this._createRendererHtml();
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    this.window.loadURL(url).catch?.(error => {
      this._log('Overlay Renderer Load Failed', { error: error.message });
    });
  }

  /**
   * Keep overlay renderer failures from leaving stale voice UI state behind.
   * @param {object} win Electron BrowserWindow-like object.
   * @returns {void}
   * @private
   */
  _attachWindowRecovery(win) {
    if (!win?.webContents || typeof win.webContents.on !== 'function') return;
    win.webContents.on('render-process-gone', (_event, details = {}) => {
      this._log('Overlay Renderer Exited', { reason: details.reason || 'unknown' });
      this.visible = false;
      this.window = null;
      if (typeof win.destroy === 'function' && !this._isDestroyed(win)) {
        win.destroy();
      }
    });
    if (typeof win.on === 'function') {
      win.on('unresponsive', () => {
        this._log('Overlay Renderer Unresponsive');
        try {
          win.webContents.reloadIgnoringCache?.();
        } catch (error) {
          this._log('Overlay Renderer Reload Failed', { error: error.message });
        }
      });
    }
  }

  /**
   * Create the built-in overlay HTML shell.
   * @returns {string}
   * @private
   */
  _createRendererHtml() {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self';">
<style>
:root { --voice-bg: #000; --voice-text: #f7f8fb; --voice-muted: rgba(247,248,251,.66); --voice-accent: #4488ff; --voice-border: rgba(255,255,255,.08); --voice-blur: 0px; --voice-ease: cubic-bezier(.16,1,.3,1); }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: Segoe UI, system-ui, sans-serif; color: var(--voice-text); -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
body { animation: overlay-in 220ms var(--voice-ease) both; }
#voice-overlay { box-sizing: border-box; height: 100vh; padding: 7px 13px; border: 1px solid var(--voice-border); border-radius: 999px; background: #000; box-shadow: 0 12px 30px rgba(0,0,0,.40), inset 0 1px 1px rgba(255,255,255,.08); display: grid; grid-template-columns: 34px minmax(0,1fr); gap: 9px; align-items: center; contain: layout paint style; transform: translate3d(0,0,0); transition: border-radius 220ms var(--voice-ease), box-shadow 220ms var(--voice-ease), padding 220ms var(--voice-ease), grid-template-columns 220ms var(--voice-ease), gap 220ms var(--voice-ease); will-change: transform, opacity; }
#voice-overlay.expanded { padding: 16px 18px; border-radius: 28px; grid-template-columns: 50px minmax(0,1fr); align-items: start; box-shadow: 0 20px 64px rgba(0,0,0,.44), inset 0 1px 1px rgba(255,255,255,.10); }
#voice-overlay.expanded.medium { padding: 11px 15px; border-radius: 24px; grid-template-columns: 42px minmax(0,1fr); gap: 10px; align-items: center; box-shadow: 0 18px 48px rgba(0,0,0,.42), inset 0 1px 1px rgba(255,255,255,.10); }
#voice-overlay section { min-width: 0; overflow: hidden; }
#icon { width: 32px; height: 32px; border-radius: 999px; display: grid; place-items: center; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.10); font-size: 11px; font-weight: 750; transform: translate3d(0,0,0); transition: width 220ms var(--voice-ease), height 220ms var(--voice-ease), border-radius 220ms var(--voice-ease), transform 220ms var(--voice-ease), opacity 220ms var(--voice-ease), border-color 220ms var(--voice-ease); will-change: transform, opacity; }
#voice-overlay.expanded #icon { width: 50px; height: 50px; border-radius: 16px; background: color-mix(in srgb, var(--voice-accent) 18%, transparent); border-color: color-mix(in srgb, var(--voice-accent) 36%, transparent); font-size: 13px; }
#voice-overlay.expanded.medium #icon { width: 40px; height: 40px; border-radius: 14px; font-size: 12px; }
#title { display: none; font-size: 15px; font-weight: 650; line-height: 1.25; }
#voice-overlay.expanded #title { display: block; }
#voice-overlay.expanded.medium #title { display: none; }
#status { color: var(--voice-text); font-size: 13px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#voice-overlay.expanded #status { color: var(--voice-muted); margin-top: 3px; }
#voice-overlay.expanded.medium #status { margin-top: 0; color: var(--voice-text); }
#transcript { margin-top: 2px; min-height: 0; max-width: 100%; color: var(--voice-muted); font-size: 12px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: translate3d(0,0,0); transition: opacity 160ms var(--voice-ease), transform 160ms var(--voice-ease); will-change: opacity, transform; }
#voice-overlay.expanded #transcript { margin-top: 10px; min-height: 20px; color: var(--voice-text); font-size: 14px; line-height: 1.35; }
#voice-overlay.expanded.medium #transcript { margin-top: 3px; min-height: 0; color: var(--voice-muted); font-size: 12px; line-height: 1.2; white-space: nowrap; }
#assistant-response { margin-top: 10px; max-height: 154px; overflow: hidden auto; padding-right: 4px; opacity: 0; transform: translate3d(0, 6px, 0) scale(.992); transform-origin: top center; transition: opacity 180ms var(--voice-ease), transform 180ms var(--voice-ease); will-change: opacity, transform; contain: layout paint style; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--voice-accent) 55%, transparent) transparent; }
#assistant-response.visible { opacity: 1; transform: translate3d(0,0,0); }
#voice-overlay.expanded.medium #assistant-response { margin-top: 6px; max-height: 48px; overflow: hidden; padding-right: 0; }
.voice-response-heading { margin-bottom: 5px; color: rgba(247,248,251,.56); font-size: 11px; font-weight: 700; letter-spacing: .08em; line-height: 1.1; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.voice-response-text { font-size: 13px; line-height: 1.35; color: var(--voice-text); overflow-wrap: anywhere; }
#voice-overlay.expanded.medium .voice-response-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12.5px; line-height: 1.28; }
.voice-card-list { display: grid; gap: 7px; margin: 9px 0 0; padding: 0; list-style: none; }
.voice-card { display: grid; grid-template-columns: 26px minmax(0,1fr); gap: 8px; align-items: start; padding: 8px 9px; border-radius: 13px; border: 1px solid rgba(255,255,255,.13); background: rgba(255,255,255,.08); box-shadow: inset 0 1px 0 rgba(255,255,255,.08); contain: layout paint style; transform: translateZ(0); }
.voice-card-number { width: 24px; height: 24px; border-radius: 9px; display: grid; place-items: center; color: var(--voice-text); background: color-mix(in srgb, var(--voice-accent) 28%, transparent); border: 1px solid color-mix(in srgb, var(--voice-accent) 45%, transparent); font-size: 12px; font-weight: 700; }
.voice-card strong { display: block; min-width: 0; font-size: 13px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.voice-card small { display: block; margin-top: 3px; color: var(--voice-muted); font-size: 11px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.listening #icon { animation: pulse 1.4s var(--voice-ease) infinite; }
.processing #icon { animation: pulse 1.7s var(--voice-ease) infinite; }
.error #icon { color: #ffb1b1; border-color: rgba(255,120,120,.45); }
@keyframes overlay-in { from { opacity: 0; transform: translate3d(0, 8px, 0) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0%,100% { transform: translateZ(0) scale(1); opacity: .78; } 50% { transform: translateZ(0) scale(1.055); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main id="voice-overlay" role="status" aria-live="polite">
  <div id="icon">JA</div>
  <section>
    <div id="title">Starting</div>
    <div id="status">Initializing voice...</div>
    <div id="transcript"></div>
    <div id="assistant-response" aria-live="polite"></div>
  </section>
</main>
</body>
</html>`;
  }

  /**
   * Return target display for positioning.
   * @returns {object}
   * @private
   */
  _getTargetDisplay() {
    if (this.screen?.getDisplayNearestPoint && this.screen?.getCursorScreenPoint) {
      return this.screen.getDisplayNearestPoint(this.screen.getCursorScreenPoint());
    }
    if (this.screen?.getPrimaryDisplay) return this.screen.getPrimaryDisplay();
    return { workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  }

  _currentSize() {
    if (this.activeSize) return this.activeSize;
    if (this.sizeMode === 'expanded') return { ...this.configuration.expandedSize };
    if (this.sizeMode === 'medium') return { ...this.configuration.mediumSize };
    return this.configuration.size;
  }

  _setSizeMode(mode = 'compact', options = {}) {
    const nextMode = ['medium', 'expanded'].includes(mode) ? mode : 'compact';
    if (!this.window || this._isDestroyed(this.window)) return null;
    const nextSize = this._normalizeSize(options.size || this._defaultSizeForMode(nextMode));
    if (options.immediate) {
      this._clearResizeTimer();
      return this._applySizeMode(nextMode, { size: nextSize, snap: options.snap });
    }
    this._clearResizeTimer();
    this.pendingSizeMode = nextMode;
    this.pendingSize = nextSize;
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      const pending = this.pendingSizeMode;
      const pendingSize = this.pendingSize;
      this.pendingSizeMode = null;
      this.pendingSize = null;
      this._applySizeMode(pending, { size: pendingSize, snap: options.snap });
    }, Math.max(0, Number(options.delayMs) || 16));
    if (typeof this.resizeTimer.unref === 'function') this.resizeTimer.unref();
    return null;
  }

  _applySizeMode(mode = 'compact', options = {}) {
    const nextMode = ['medium', 'expanded'].includes(mode) ? mode : 'compact';
    const nextSize = this._normalizeSize(options.size || this._defaultSizeForMode(nextMode));
    this.sizeMode = nextMode;
    this.activeSize = nextSize;
    return this.position(this._currentSize(), { snap: Boolean(options.snap) });
  }

  _clearResizeTimer() {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.pendingSizeMode = null;
    this.pendingSize = null;
  }

  _clearBoundsAnimation() {
    if (this.boundsAnimationTimer) {
      clearTimeout(this.boundsAnimationTimer);
      this.boundsAnimationTimer = null;
    }
  }

  _defaultSizeForMode(mode) {
    if (mode === 'expanded') return this.configuration.expandedSize;
    if (mode === 'medium') return this.configuration.mediumSize;
    return this.configuration.size;
  }

  _normalizeSize(size = {}) {
    const compact = this.configuration.size;
    const expanded = this.configuration.expandedSize;
    return {
      width: Math.max(compact.width, Math.min(expanded.width, Math.round(Number(size.width) || compact.width))),
      height: Math.max(compact.height, Math.min(expanded.height, Math.round(Number(size.height) || compact.height)))
    };
  }

  _sameSize(left, right) {
    return Boolean(left && right && left.width === right.width && left.height === right.height);
  }

  _moveToBounds(bounds, options = {}) {
    const win = this.window;
    if (!win || this._isDestroyed(win) || typeof win.setBounds !== 'function') return;
    this._clearBoundsAnimation();
    const start = this.lastBounds || (typeof win.getBounds === 'function' ? win.getBounds() : null);
    if (options.snap || !start || this._boundsEqual(start, bounds)) {
      win.setBounds(bounds, true);
      this.lastBounds = bounds;
      return;
    }

    const duration = Math.max(90, Math.min(180, Number(this.configuration.animationDurationMs) || 160));
    const startedAt = Date.now();
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const frame = {
        x: Math.round(start.x + ((bounds.x - start.x) * eased)),
        y: Math.round(start.y + ((bounds.y - start.y) * eased)),
        width: Math.round(start.width + ((bounds.width - start.width) * eased)),
        height: Math.round(start.height + ((bounds.height - start.height) * eased))
      };
      win.setBounds(frame, false);
      if (progress < 1) {
        this.boundsAnimationTimer = setTimeout(step, 16);
        if (typeof this.boundsAnimationTimer.unref === 'function') this.boundsAnimationTimer.unref();
        return;
      }
      this.boundsAnimationTimer = null;
      win.setBounds(bounds, true);
      this.lastBounds = bounds;
    };
    step();
  }

  _boundsEqual(left, right) {
    return Boolean(left && right &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height);
  }

  _sizeModeForAssistantResult(payload = {}) {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const resultEntries = Array.isArray(payload.resultEntries) ? payload.resultEntries : [];
    const response = String(payload.response || '');
    if (choices.length > 0 || resultEntries.length > 0 || response.length > 220) return 'expanded';
    if (response.length > 0) return 'medium';
    return 'compact';
  }

  _sizeForAssistantResult(payload = {}, mode = this._sizeModeForAssistantResult(payload)) {
    if (mode === 'compact') return this.configuration.size;
    if (mode === 'medium') return this.configuration.mediumSize;

    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const resultEntries = Array.isArray(payload.resultEntries) ? payload.resultEntries : [];
    const responseLength = String(payload.response || '').trim().length;
    const cardCount = Math.min(4, Math.max(0, choices.length || resultEntries.length));
    if (cardCount > 0) {
      return this._normalizeSize({
        width: choices.length > 0 ? 430 : 420,
        height: 132 + (cardCount * 36)
      });
    }
    return this._normalizeSize({
      width: responseLength > 340 ? 430 : 400,
      height: responseLength > 340 ? 204 : 166
    });
  }

  _shouldCollapseForState(state) {
    return ['LISTENING', 'READY', 'CLOSING', 'CANCELLED', 'IDLE'].includes(String(state || '').toUpperCase());
  }

  /**
   * Check Electron destroyed state.
   * @param {object} win BrowserWindow-like object.
   * @returns {boolean}
   * @private
   */
  _isDestroyed(win) {
    return Boolean(win && typeof win.isDestroyed === 'function' && win.isDestroyed());
  }

  /**
   * Write structured controller logs.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {void}
   * @private
   */
  _log(message, metadata = {}) {
    if (this.logger && typeof this.logger.info === 'function') {
      this.logger.info(`[Voice UI] ${message}`, metadata);
    }
  }
}

module.exports = VoiceWindowController;
