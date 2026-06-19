'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');
const Logger = require('../../shared/index').Logger;
const BrowserController = require('../browser/index');
const WindowsSessionController = require('../common/windows-session');
const { buildDataPaths } = require('../../shared/data-root');

const DEFAULT_PLATFORM = 'youtube';
const VK_MEDIA_STOP = 178;

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PLATFORM_REGISTRY = {
  youtube: {
    appName: 'YouTube',
    localLauncher: '_launchYouTubeLocal',
    searchUrl: (query) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  },
  spotify: {
    appName: 'Spotify',
    localLauncher: '_launchSpotifyLocal',
    searchUrl: (query) =>
      `https://open.spotify.com/search/${encodeURIComponent(query)}`
  },
  soundcloud: {
    appName: 'SoundCloud',
    localLauncher: null,
    searchUrl: (query) =>
      `https://soundcloud.com/search?q=${encodeURIComponent(query)}`
  },
  'apple music': {
    appName: 'Apple Music',
    localLauncher: '_launchAppleMusicLocal',
    searchUrl: (query) =>
      `https://music.apple.com/search?term=${encodeURIComponent(query)}`
  },
  gaana: {
    appName: 'Gaana',
    localLauncher: null,
    searchUrl: (query) =>
      `https://gaana.com/search/${encodeURIComponent(query)}`
  },
  jiosaavn: {
    appName: 'JioSaavn',
    localLauncher: null,
    searchUrl: (query) =>
      `https://www.jiosaavn.com/search/${encodeURIComponent(query)}`
  },
  'amazon music': {
    appName: 'Amazon Music',
    localLauncher: '_launchAmazonMusicLocal',
    searchUrl: (query) =>
      `https://music.amazon.com/search/${encodeURIComponent(query)}`
  }
};

class MediaController {
  constructor(config) {
    this.config = config || {};
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.browser = new BrowserController(config);
    this.windowSession = new WindowsSessionController(config);
    this.activeSession = null;
  }

  async play(query, platform) {
    if (!query || !String(query).trim()) {
      return { success: false, error: 'No media query provided' };
    }

    const cleanQuery = String(query).trim();
    const platformKey = this._resolvePlatform(platform);
    const definition = PLATFORM_REGISTRY[platformKey];

    if (!definition) {
      return { success: false, error: `Media platform not supported: ${platformKey}` };
    }

    this.logger.info(`MediaController: playing "${cleanQuery}" on ${definition.appName}`);

    let replacement = this._prepareReplacementPlayback(platformKey, { beforeReuse: true });
    const playbackTarget = await this._buildPlaybackTarget(cleanQuery, platformKey, definition);
    const reuseResult = this._tryReuseExistingSession(platformKey, playbackTarget.playUrl);

    if (reuseResult.success) {
      this._rememberSession({
        query: cleanQuery,
        platform: platformKey,
        appName: definition.appName,
        launchMethod: 'existing-window',
        url: playbackTarget.playUrl,
        managedWindow: false
      });

      return {
        success: true,
        data: {
          query: cleanQuery,
          platform: platformKey,
          appName: definition.appName,
          launchMethod: 'existing-window',
          url: playbackTarget.playUrl,
          replacedExisting: true,
          stoppedPreviousPlayback: replacement.stoppedPreviousPlayback,
          closedPreviousPlayback: replacement.closedPreviousPlayback,
          verified: true,
          playbackVerification: this._buildPlaybackVerification({
            query: cleanQuery,
            platform: platformKey,
            appName: definition.appName,
            launchMethod: 'existing-window',
            url: playbackTarget.playUrl,
            replacement
          }),
          matchedWindow: reuseResult.data?.matchedWindow || null
        }
      };
    }

    if (!replacement.replacementAttempted) {
      replacement = this._prepareReplacementPlayback(platformKey, { beforeReuse: false });
    }

    if (definition.localLauncher && typeof this[definition.localLauncher] === 'function') {
      const localResult = await this[definition.localLauncher](cleanQuery, playbackTarget.playUrl);
      if (localResult.success) {
        this.logger.info(
          `MediaController: launched ${definition.appName} locally via ${localResult.method}`
        );
        this._rememberSession({
          query: cleanQuery,
          platform: platformKey,
          appName: definition.appName,
          launchMethod: localResult.method || 'local',
          url: localResult.url || playbackTarget.playUrl || null,
          managedWindow: Boolean(localResult.managedWindow),
          windowQuery: localResult.windowQuery || this._defaultWindowQuery(platformKey)
        });

        return {
          success: true,
          data: {
            query: cleanQuery,
            platform: platformKey,
            appName: definition.appName,
            launchMethod: localResult.method || 'local',
            url: localResult.url || null,
            replacedExisting: replacement.replacementAttempted,
            stoppedPreviousPlayback: replacement.stoppedPreviousPlayback,
            closedPreviousPlayback: replacement.closedPreviousPlayback,
            verified: true,
            playbackVerification: this._buildPlaybackVerification({
              query: cleanQuery,
              platform: platformKey,
              appName: definition.appName,
              launchMethod: localResult.method || 'local',
              url: localResult.url || playbackTarget.playUrl || null,
              replacement
            })
          }
        };
      }

      this.logger.info(
        `MediaController: local launch failed for ${definition.appName}` +
        ` (${localResult.reason}), falling back to browser`
      );
    }

    const fallbackUrl = playbackTarget.playUrl || definition.searchUrl(cleanQuery);
    const browserResult = this.browser.open(fallbackUrl);

    if (!browserResult.success) {
      return {
        success: false,
        error: `Failed to open ${definition.appName}: ${browserResult.error}`
      };
    }

    this._rememberSession({
      query: cleanQuery,
      platform: platformKey,
      appName: definition.appName,
      launchMethod: 'browser',
      url: fallbackUrl,
      managedWindow: false
    });

    return {
      success: true,
      data: {
        query: cleanQuery,
        platform: platformKey,
        appName: definition.appName,
        launchMethod: 'browser',
        url: fallbackUrl,
        replacedExisting: replacement.replacementAttempted,
        stoppedPreviousPlayback: replacement.stoppedPreviousPlayback,
        closedPreviousPlayback: replacement.closedPreviousPlayback,
        verified: false,
        playbackVerification: this._buildPlaybackVerification({
          query: cleanQuery,
          platform: platformKey,
          appName: definition.appName,
          launchMethod: 'browser',
          url: fallbackUrl,
          replacement
        })
      }
    };
  }

  async search(query, platform) {
    return this.play(query, platform);
  }

  getSupportedPlatforms() {
    return Object.keys(PLATFORM_REGISTRY);
  }

  async _launchYouTubeLocal(query, preferredUrl) {
    const playUrl = preferredUrl || PLATFORM_REGISTRY.youtube.searchUrl(query);
    const chromePath = this._findChrome();

    if (chromePath) {
      try {
        const args = [
          `--user-data-dir=${this._ensureChromeMediaProfile()}`,
          '--no-first-run',
          '--autoplay-policy=no-user-gesture-required',
          `--app=${playUrl}`
        ];
        const child = spawn(chromePath, args, {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
        return {
          success: true,
          method: 'chrome-pwa',
          url: playUrl,
          managedWindow: true,
          windowQuery: 'youtube'
        };
      } catch (err) {
        this.logger.info(`MediaController: Chrome PWA launch failed: ${err.message}`);
      }
    }

    return { success: false, reason: 'chrome executable not found for managed playback' };
  }

  async _launchSpotifyLocal(query) {
    const uri = `spotify:search:${encodeURIComponent(query)}`;
    const result = this._launchUri(uri);
    return result.success
      ? { success: true, method: 'uri-protocol', url: uri }
      : { success: false, reason: result.reason };
  }

  async _launchAppleMusicLocal(query) {
    const uri = `musics://music.apple.com/search?term=${encodeURIComponent(query)}`;
    const result = this._launchUri(uri);
    return result.success
      ? { success: true, method: 'uri-protocol', url: uri }
      : { success: false, reason: result.reason };
  }

  async _launchAmazonMusicLocal(query) {
    const uri = `amznmusic://search?q=${encodeURIComponent(query)}`;
    const result = this._launchUri(uri);
    return result.success
      ? { success: true, method: 'uri-protocol', url: uri }
      : { success: false, reason: result.reason };
  }

  _fetchFirstYouTubeVideoId(query) {
    return new Promise((resolve, reject) => {
      const searchPath =
        `/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`;

      const options = {
        hostname: 'www.youtube.com',
        path: searchPath,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000
      };

      const req = https.get(options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          resolve(null);
          return;
        }

        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          try {
            const videoIdRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
            const seen = new Set();
            let match;

            while ((match = videoIdRegex.exec(rawData)) !== null) {
              const videoId = match[1];
              if (seen.has(videoId)) {
                continue;
              }

              seen.add(videoId);
              resolve(videoId);
              return;
            }

            resolve(null);
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('YouTube fetch timed out'));
      });
    });
  }

  _launchUri(uri) {
    try {
      const safeUri = String(uri).replace(/'/g, "''");
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Start-Process '${safeUri}' -ErrorAction Stop`
      ], {
        timeout: 6000,
        stdio: 'pipe'
      });
      return { success: true };
    } catch (err) {
      return { success: false, reason: String(err?.message || 'uri launch failed') };
    }
  }

  _findChrome() {
    for (const chromePath of CHROME_PATHS) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }

    try {
      const discoveredPath = execFileSync('where.exe', ['chrome'], {
        timeout: 3000,
        stdio: 'pipe',
        encoding: 'utf8'
      }).split(/\r?\n/).map(line => line.trim()).find(Boolean);
      if (discoveredPath && fs.existsSync(discoveredPath)) {
        return discoveredPath;
      }
    } catch (err) {
      this.logger.info('MediaController: Chrome was not found on PATH');
    }

    return null;
  }

  _ensureChromeMediaProfile() {
    const profileDir = this.config?.app?.dataPaths?.mediaProfileDir ||
      buildDataPaths(this.config).mediaProfileDir;
    fs.mkdirSync(profileDir, { recursive: true });
    return profileDir;
  }

  _resolvePlatform(raw) {
    if (!raw) return DEFAULT_PLATFORM;

    const normalized = String(raw).trim().toLowerCase();
    if (PLATFORM_REGISTRY[normalized]) return normalized;

    if (normalized.includes('youtube') || normalized === 'yt') return 'youtube';
    if (normalized.includes('spotify')) return 'spotify';
    if (normalized.includes('soundcloud')) return 'soundcloud';
    if (normalized.includes('apple')) return 'apple music';
    if (normalized.includes('gaana')) return 'gaana';
    if (normalized.includes('saavn') || normalized.includes('jio')) return 'jiosaavn';
    if (normalized.includes('amazon')) return 'amazon music';

    return DEFAULT_PLATFORM;
  }

  async _buildPlaybackTarget(query, platformKey, definition) {
    if (platformKey !== 'youtube') {
      return { playUrl: definition.searchUrl(query) };
    }

    try {
      const videoId = await this._fetchFirstYouTubeVideoId(query);
      if (videoId) {
        this.logger.info(`MediaController: resolved YouTube video ID: ${videoId}`);
        return { playUrl: `https://www.youtube.com/watch?v=${videoId}&autoplay=1` };
      }
    } catch (err) {
      this.logger.info(`MediaController: YouTube ID fetch failed (${err.message}), using search URL`);
    }

    return { playUrl: definition.searchUrl(query) };
  }

  _tryReuseExistingSession(platformKey, playUrl) {
    return { success: false, reason: 'managed-launch-required' };
  }

  _rememberSession(session) {
    this.activeSession = {
      query: session.query,
      platform: session.platform,
      appName: session.appName,
      launchMethod: session.launchMethod,
      url: session.url,
      managedWindow: Boolean(session.managedWindow),
      windowQuery: session.windowQuery || this._defaultWindowQuery(session.platform)
    };
  }

  _prepareReplacementPlayback(platformKey, options = {}) {
    const replacement = {
      replacementAttempted: false,
      stoppedPreviousPlayback: false,
      closedPreviousPlayback: false
    };

    const hasKnownSession = Boolean(this.activeSession?.platform);
    const samePlatform = this.activeSession?.platform === platformKey;

    if (options.beforeReuse && (!hasKnownSession || samePlatform)) {
      return replacement;
    }

    replacement.replacementAttempted = true;

    if (this.activeSession?.managedWindow) {
      const closeResult = this._closeManagedSession();
      if (closeResult.success) {
        replacement.closedPreviousPlayback = true;
        return replacement;
      }
    }

    const stopResult = this._stopPreviousPlayback();
    replacement.stoppedPreviousPlayback = stopResult.success;
    return replacement;
  }

  _buildPlaybackVerification({ query, platform, appName, launchMethod, url, replacement }) {
    return {
      type: 'media.play',
      valid: Boolean(query && platform && url && launchMethod !== 'browser'),
      requestedQuery: query,
      requestedPlatform: platform,
      appName,
      launchMethod,
      targetUrl: url,
      replacedExisting: Boolean(replacement?.replacementAttempted),
      stoppedPreviousPlayback: Boolean(replacement?.stoppedPreviousPlayback),
      closedPreviousPlayback: Boolean(replacement?.closedPreviousPlayback)
    };
  }

  _closeManagedSession() {
    if (!this.activeSession?.managedWindow) {
      return { success: false, skipped: true };
    }

    const closeResult = this.windowSession.closeWindow(
      this.activeSession.windowQuery,
      this._getWindowSearchOptions(this.activeSession.platform)
    );

    if (!closeResult.success) {
      this.logger.info(
        `MediaController: unable to close prior managed session (${closeResult.error})`
      );
    }

    this.activeSession = null;
    return closeResult;
  }

  _stopPreviousPlayback() {
    try {
      this._sendGlobalMediaKey(VK_MEDIA_STOP);
      return { success: true };
    } catch (err) {
      this.logger.info(`MediaController: unable to stop previous playback (${err.message})`);
      return { success: false, error: err.message };
    }
  }

  _defaultWindowQuery(platformKey) {
    if (platformKey === 'youtube') return 'youtube';
    if (platformKey === 'spotify') return 'spotify';
    if (platformKey === 'apple music') return 'apple music';
    return platformKey || DEFAULT_PLATFORM;
  }

  _getWindowSearchOptions(platformKey) {
    if (platformKey === 'youtube') {
      return {
        preferredTitleTokens: ['youtube'],
        preferredProcessNames: ['chrome', 'msedge', 'firefox'],
        requireTitleTokenMatch: true
      };
    }

    return {};
  }

  next() {
    try {
      this._sendMediaControl('+n', 176);
      return { success: true, data: { action: 'next' } };
    } catch (err) {
      return { success: false, error: `Failed to play next track: ${err.message}` };
    }
  }

  previous() {
    try {
      this._sendMediaControl('+p', 177);
      return { success: true, data: { action: 'previous' } };
    } catch (err) {
      return { success: false, error: `Failed to play previous track: ${err.message}` };
    }
  }

  pause() {
    try {
      this._sendMediaControl('k', 179);
      return { success: true, data: { action: 'pause' } };
    } catch (err) {
      return { success: false, error: `Failed to pause playback: ${err.message}` };
    }
  }

  resume() {
    try {
      this._sendMediaControl('k', 179);
      return { success: true, data: { action: 'resume' } };
    } catch (err) {
      return { success: false, error: `Failed to resume playback: ${err.message}` };
    }
  }

  stop() {
    try {
      this._sendMediaControl('k', 179);
      return { success: true, data: { action: 'stop' } };
    } catch (err) {
      return { success: false, error: `Failed to stop playback: ${err.message}` };
    }
  }

  mute() {
    return this._sendPlayerShortcut('mute', 'm');
  }

  unmute() {
    return this._sendPlayerShortcut('unmute', 'm');
  }

  volumeUp() {
    return this._sendPlayerShortcut('volumeUp', '{UP}');
  }

  volumeDown() {
    return this._sendPlayerShortcut('volumeDown', '{DOWN}');
  }

  fullscreen() {
    return this._sendPlayerShortcut('fullscreen', 'f');
  }

  exitFullscreen() {
    return this._sendPlayerShortcut('exitFullscreen', '{ESC}');
  }

  replay() {
    return this._sendPlayerShortcut('replay', 'j');
  }

  repeat() {
    return this._sendPlayerShortcut('repeat', 'r', {
      limitation: 'Repeat support depends on the active media player shortcut support.'
    });
  }

  shuffle() {
    return this._sendPlayerShortcut('shuffle', 's', {
      limitation: 'Shuffle support depends on the active media player shortcut support.'
    });
  }

  favorite() {
    return this._sendPlayerShortcut('favorite', '+l', {
      limitation: 'Favorite/like support depends on the active media player shortcut support.'
    });
  }

  like() {
    return this._sendPlayerShortcut('like', '+l', {
      limitation: 'YouTube may require the page like button to be focused before the shortcut works.'
    });
  }

  subscribe() {
    return this._sendPlayerShortcut('subscribe', '', {
      limitation: 'YouTube does not expose a reliable global subscribe shortcut; the video window was focused for manual confirmation.'
    });
  }

  status() {
    if (this.activeSession) {
      return {
        success: true,
        data: {
          action: 'status',
          query: this.activeSession.query || null,
          platform: this.activeSession.platform || null,
          appName: this.activeSession.appName || null,
          url: this.activeSession.url || null,
          launchMethod: this.activeSession.launchMethod || null,
          knownPlayback: true
        }
      };
    }

    const target = this.windowSession.findWindow('youtube', this._getWindowSearchOptions('youtube')) ||
      this.windowSession.findWindow('spotify', { preferredTitleTokens: ['spotify'] });
    if (target) {
      return {
        success: true,
        data: {
          action: 'status',
          matchedWindow: target.title,
          processName: target.processName,
          knownPlayback: false
        }
      };
    }

    return {
      success: true,
      data: {
        action: 'status',
        knownPlayback: false,
        message: 'No active media session is known yet'
      }
    };
  }

  _sendPlayerShortcut(action, keys, detail = {}) {
    try {
      const result = keys
        ? this.windowSession.sendKeys(
            this.activeSession?.platform === 'youtube'
              ? (this.activeSession.windowQuery || 'youtube')
              : this._defaultWindowQuery(this.activeSession?.platform || 'youtube'),
            keys,
            this._getWindowSearchOptions(this.activeSession?.platform || 'youtube')
          )
        : this.windowSession.focusWindow('youtube', this._getWindowSearchOptions('youtube'));

      if (!result.success) {
        this._sendGlobalMediaFallback(action);
        return {
          success: true,
          data: {
            action,
            method: 'global-media-fallback',
            ...detail
          }
        };
      }

      return {
        success: true,
        data: {
          action,
          method: 'window-shortcut',
          matchedWindow: result.data?.matchedWindow,
          keys,
          ...detail
        }
      };
    } catch (err) {
      return { success: false, error: `Failed to run media ${action}: ${err.message}` };
    }
  }

  _sendGlobalMediaFallback(action) {
    const fallbackKeys = {
      mute: 173,
      unmute: 173,
      volumeUp: 175,
      volumeDown: 174,
      replay: 177,
      next: 176,
      previous: 177
    };
    const virtualKeyCode = fallbackKeys[action];
    if (virtualKeyCode) {
      this._sendGlobalMediaKey(virtualKeyCode);
    }
  }

  _sendMediaControl(youtubeKey, virtualKeyCode) {
    const targetWindow = this.windowSession.sendKeys(
      this.activeSession?.platform === 'youtube'
        ? (this.activeSession.windowQuery || 'youtube')
        : 'youtube',
      youtubeKey,
      this._getWindowSearchOptions('youtube')
    );

    if (targetWindow.success) {
      return;
    }

    this._sendGlobalMediaKey(virtualKeyCode);
  }

  _sendGlobalMediaKey(virtualKeyCode) {
    const script = `
$signature = @'
using System;
using System.Runtime.InteropServices;
public static class Win32MediaKeyApi {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
}
'@
Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
[Win32MediaKeyApi]::keybd_event(${virtualKeyCode}, 0, 0, 0)
[Win32MediaKeyApi]::keybd_event(${virtualKeyCode}, 0, 2, 0)
`;

    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 5000,
      stdio: 'pipe'
    });
  }
}

module.exports = MediaController;
