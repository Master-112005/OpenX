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
      this._loadRenderer();
      this.position();
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
  position() {
    const win = this.window;
    if (!win || this._isDestroyed(win)) {
      throw new RendererUnavailable('Voice overlay window is unavailable.');
    }
    const { width, height } = this.configuration.size;
    const display = this._getTargetDisplay();
    const area = display.workArea || display.bounds || { x: 0, y: 0, width: 1280, height: 720 };
    const bounds = {
      x: Math.round(area.x + ((area.width - width) / 2)),
      y: Math.round(area.y + ((area.height - height) / 2) + this.configuration.position.yOffset),
      width,
      height
    };
    if (typeof win.setBounds === 'function') win.setBounds(bounds);
    return bounds;
  }

  /**
   * Show the overlay without stealing permanent focus.
   * @param {object} view Renderer view payload.
   * @returns {{visible: boolean, view: object}}
   */
  show(view = {}) {
    const win = this.createWindow();
    this.position();
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
      this.ipc.send(VoiceOverlayIPC.OPERATIONS.UPDATE_TRANSCRIPT, transcript);
    }
    return { updated: true, transcript };
  }

  /**
   * Display an error payload.
   * @param {object} view Error view payload.
   * @returns {{displayed: boolean, view: object}}
   */
  displayError(view = {}) {
    if (!this.window || this._isDestroyed(this.window)) this.createWindow();
    this.visible = true;
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
:root { --voice-bg: rgba(17,22,36,.82); --voice-text: #f4f7ff; --voice-muted: rgba(244,247,255,.68); --voice-accent: #4488ff; --voice-border: rgba(255,255,255,.16); --voice-blur: 34px; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: Segoe UI, system-ui, sans-serif; color: var(--voice-text); }
#voice-overlay { box-sizing: border-box; height: 100vh; padding: 18px 20px; border: 1px solid var(--voice-border); border-radius: 24px; background: var(--voice-bg); backdrop-filter: blur(var(--voice-blur)) saturate(160%); box-shadow: 0 24px 80px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.16); display: grid; grid-template-columns: 54px 1fr; gap: 14px; align-items: center; }
#icon { width: 50px; height: 50px; border-radius: 16px; display: grid; place-items: center; background: color-mix(in srgb, var(--voice-accent) 22%, transparent); border: 1px solid color-mix(in srgb, var(--voice-accent) 42%, transparent); font-weight: 700; }
#title { font-size: 15px; font-weight: 650; line-height: 1.25; }
#status { color: var(--voice-muted); font-size: 13px; margin-top: 3px; }
#transcript { margin-top: 10px; min-height: 20px; font-size: 14px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.listening #icon { animation: pulse 1.2s ease-in-out infinite; }
.processing #icon { animation: pulse 1.6s ease-in-out infinite; }
.error #icon { color: #ffb1b1; border-color: rgba(255,120,120,.45); }
@keyframes pulse { 0%,100% { transform: scale(1); opacity: .78; } 50% { transform: scale(1.06); opacity: 1; } }
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
