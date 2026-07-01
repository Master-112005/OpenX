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
    this.resizeTimer = null;
    this.pendingSizeMode = null;
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
      this._applySizeMode('compact');
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
  position(size = this._currentSize()) {
    const win = this.window;
    if (!win || this._isDestroyed(win)) {
      throw new RendererUnavailable('Voice overlay window is unavailable.');
    }
    const { width, height } = size;
    const display = this._getTargetDisplay();
    const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1280, height: 720 };
    const bounds = {
      x: Math.round(area.x + ((area.width - width) / 2)),
      y: Math.round(area.y + ((area.height - height) / 2) + this.configuration.position.yOffset),
      width,
      height
    };
    if (this._boundsEqual(this.lastBounds, bounds)) return bounds;
    if (typeof win.setBounds === 'function') win.setBounds(bounds, true);
    this.lastBounds = bounds;
    return bounds;
  }

  /**
   * Show the overlay without stealing permanent focus.
   * @param {object} view Renderer view payload.
   * @returns {{visible: boolean, view: object}}
   */
  show(view = {}) {
    const win = this.createWindow();
    this._setSizeMode('compact', { immediate: true });
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
    this._setSizeMode('compact', { immediate: true });
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
      this._setSizeMode(this._shouldExpandForAssistantResult(payload) ? 'expanded' : 'compact', { immediate: true });
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.DISPLAY_ASSISTANT_RESULT, payload);
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
    this._setSizeMode('compact', { immediate: true });
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
:root { --voice-bg: rgba(17,22,36,.84); --voice-text: #f4f7ff; --voice-muted: rgba(244,247,255,.72); --voice-accent: #4488ff; --voice-border: rgba(255,255,255,.18); --voice-blur: 32px; --voice-ease: cubic-bezier(.16,1,.3,1); }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: Segoe UI, system-ui, sans-serif; color: var(--voice-text); -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
body { animation: overlay-in 240ms var(--voice-ease) both; }
#voice-overlay { box-sizing: border-box; height: 100vh; padding: 18px 20px; border: 1px solid var(--voice-border); border-radius: 24px; background: var(--voice-bg); backdrop-filter: blur(var(--voice-blur)) saturate(160%); box-shadow: 0 24px 80px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.16); display: grid; grid-template-columns: 54px minmax(0,1fr); gap: 14px; align-items: start; contain: layout paint style; transform: translate3d(0,0,0); transition: background-color 180ms var(--voice-ease), border-color 180ms var(--voice-ease), box-shadow 180ms var(--voice-ease); will-change: transform, opacity; }
#icon { width: 50px; height: 50px; border-radius: 16px; display: grid; place-items: center; background: color-mix(in srgb, var(--voice-accent) 22%, transparent); border: 1px solid color-mix(in srgb, var(--voice-accent) 42%, transparent); font-weight: 700; transform: translate3d(0,0,0); transition: transform 180ms var(--voice-ease), opacity 180ms var(--voice-ease), border-color 180ms var(--voice-ease); will-change: transform, opacity; }
#title { font-size: 15px; font-weight: 650; line-height: 1.25; }
#status { color: var(--voice-muted); font-size: 13px; margin-top: 3px; }
#transcript { margin-top: 10px; min-height: 20px; max-width: 100%; font-size: 14px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: translate3d(0,0,0); transition: opacity 160ms var(--voice-ease), transform 160ms var(--voice-ease); will-change: opacity, transform; }
#assistant-response { margin-top: 10px; max-height: 154px; overflow: hidden auto; padding-right: 4px; opacity: 0; transform: translate3d(0, 6px, 0) scale(.992); transform-origin: top center; transition: opacity 180ms var(--voice-ease), transform 180ms var(--voice-ease); will-change: opacity, transform; contain: layout paint style; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--voice-accent) 55%, transparent) transparent; }
#assistant-response.visible { opacity: 1; transform: translate3d(0,0,0); }
.voice-response-text { font-size: 13px; line-height: 1.35; color: var(--voice-text); overflow-wrap: anywhere; }
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
    return this.sizeMode === 'expanded'
      ? this.configuration.expandedSize
      : this.configuration.size;
  }

  _setSizeMode(mode = 'compact', options = {}) {
    const nextMode = mode === 'expanded' ? 'expanded' : 'compact';
    if (!this.window || this._isDestroyed(this.window)) return null;
    if (options.immediate) {
      this._clearResizeTimer();
      return this._applySizeMode(nextMode);
    }
    this.pendingSizeMode = nextMode;
    this._clearResizeTimer();
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      const pending = this.pendingSizeMode;
      this.pendingSizeMode = null;
      this._applySizeMode(pending);
    }, Math.max(0, Number(options.delayMs) || 16));
    if (typeof this.resizeTimer.unref === 'function') this.resizeTimer.unref();
    return null;
  }

  _applySizeMode(mode = 'compact') {
    const nextMode = mode === 'expanded' ? 'expanded' : 'compact';
    this.sizeMode = nextMode;
    return this.position(this._currentSize());
  }

  _clearResizeTimer() {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.pendingSizeMode = null;
  }

  _boundsEqual(left, right) {
    return Boolean(left && right &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height);
  }

  _shouldExpandForAssistantResult(payload = {}) {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const resultEntries = Array.isArray(payload.resultEntries) ? payload.resultEntries : [];
    const response = String(payload.response || '');
    return choices.length > 0 || resultEntries.length > 0 || response.length > 120;
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
