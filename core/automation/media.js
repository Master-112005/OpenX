'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');
const Logger = require('../assistant/Data').Logger;
const BrowserController = require('./browser');
const WindowsSessionController = require('./common/windows-session');
const { buildDataPaths } = require('../assistant/Data');

const DEFAULT_PLATFORM = 'youtube';
const VK_MEDIA_STOP = 178;
const VK_MEDIA_PLAY_PAUSE = 179;

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
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.browser = new BrowserController(config);
    this.windowSession = new WindowsSessionController(config);
    this.activeSession = null;
    this.systemMediaSessionCooldownMs = Number(config?.media?.systemSessionCooldownMs) || 60000;
    this.systemMediaSessionPauseUnavailableUntil = 0;
    this.systemMediaSessionResumeUnavailableUntil = 0;
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
      if (browserResult.error === BrowserController.INTERNET_ERROR_MESSAGE) {
        return browserResult;
      }
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

  quietForVoiceActivation(reason = 'voice-activation') {
    const systemSession = this._tryPauseSystemMediaSession();
    if (systemSession.hasSession) {
      const wasPlaying = String(systemSession.playbackStatus || '').toLowerCase() === 'playing';
      if (wasPlaying && systemSession.pauseSucceeded) {
        return {
          success: true,
          data: {
            action: 'pause',
            reason,
            method: 'system-media-session',
            playbackStatus: systemSession.playbackStatus,
            afterStatus: systemSession.afterStatus || null,
            sourceAppUserModelId: systemSession.sourceAppUserModelId || null,
            restore: {
              action: 'resume',
              method: 'system-media-session',
              sourceAppUserModelId: systemSession.sourceAppUserModelId || null
            }
          }
        };
      }

      if (wasPlaying) {
        try {
          this._sendGlobalMediaKey(VK_MEDIA_PLAY_PAUSE);
          return {
            success: true,
            data: {
              action: 'pause',
              reason,
              method: 'global-media-key-fallback',
              playbackStatus: systemSession.playbackStatus,
              sourceAppUserModelId: systemSession.sourceAppUserModelId || null,
              restore: {
                action: 'resume',
                method: 'global-media-key-fallback',
                sourceAppUserModelId: systemSession.sourceAppUserModelId || null
              }
            }
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to pause active media for voice: ${err.message}`,
            data: {
              action: 'pause',
              reason,
              method: 'global-media-key-fallback',
              playbackStatus: systemSession.playbackStatus,
              sourceAppUserModelId: systemSession.sourceAppUserModelId || null
            }
          };
        }
      }

      return {
        success: true,
        data: {
          action: 'none',
          reason: 'media-not-playing',
          method: 'system-media-session',
          playbackStatus: systemSession.playbackStatus || 'unknown',
          sourceAppUserModelId: systemSession.sourceAppUserModelId || null
        }
      };
    }

    if (this.activeSession?.platform) {
      const result = this.pause();
      return {
        success: Boolean(result.success),
        error: result.error,
        data: {
          ...(result.data || {}),
          action: result.data?.action || 'pause',
          reason,
          method: result.data?.method || 'known-openx-media-session',
          platform: this.activeSession.platform,
          fallback: true,
          restore: {
            action: 'resume',
            method: 'known-openx-media-session',
            platform: this.activeSession.platform
          }
        }
      };
    }

    return {
      success: true,
      data: {
        action: 'none',
        reason: 'no-active-media-session',
        method: 'system-media-session'
      }
    };
  }

  restoreAfterVoiceActivation(quietingResult = {}, reason = 'voice-session-closed') {
    const data = quietingResult?.data || quietingResult || {};
    const restore = data.restore || {};
    if (restore.action !== 'resume') {
      return {
        success: true,
        data: {
          action: 'none',
          reason: 'no-voice-media-restore-needed'
        }
      };
    }

    if (restore.method === 'system-media-session') {
      const result = this._tryResumeSystemMediaSession(restore.sourceAppUserModelId || data.sourceAppUserModelId || '');
      if (result.playSucceeded || String(result.playbackStatus || '').toLowerCase() === 'playing') {
        return {
          success: true,
          data: {
            action: result.playSucceeded ? 'resume' : 'none',
            reason,
            method: 'system-media-session',
            playbackStatus: result.playbackStatus || null,
            afterStatus: result.afterStatus || null,
            sourceAppUserModelId: result.sourceAppUserModelId || restore.sourceAppUserModelId || null
          }
        };
      }
      return {
        success: false,
        error: result.error || 'Failed to resume media after voice.',
        data: {
          action: 'resume',
          reason,
          method: 'system-media-session',
          playbackStatus: result.playbackStatus || null,
          sourceAppUserModelId: result.sourceAppUserModelId || restore.sourceAppUserModelId || null
        }
      };
    }

    if (restore.method === 'global-media-key-fallback') {
      try {
        this._sendGlobalMediaKey(VK_MEDIA_PLAY_PAUSE);
        return {
          success: true,
          data: {
            action: 'resume',
            reason,
            method: 'global-media-key-fallback',
            sourceAppUserModelId: restore.sourceAppUserModelId || null
          }
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to resume media after voice: ${err.message}`,
          data: {
            action: 'resume',
            reason,
            method: 'global-media-key-fallback',
            sourceAppUserModelId: restore.sourceAppUserModelId || null
          }
        };
      }
    }

    if (restore.method === 'known-openx-media-session') {
      const result = this.resume();
      return {
        success: Boolean(result.success),
        error: result.error,
        data: {
          ...(result.data || {}),
          action: result.data?.action || 'resume',
          reason,
          method: 'known-openx-media-session',
          platform: restore.platform || data.platform || null
        }
      };
    }

    return {
      success: true,
      data: {
        action: 'none',
        reason: 'unknown-voice-media-restore-method',
        method: restore.method || null
      }
    };
  }

  destroy() {
    if (this.activeSession?.managedWindow) {
      this._closeManagedSession();
      return;
    }

    this.activeSession = null;
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

  _tryPauseSystemMediaSession() {
    if (Date.now() < this.systemMediaSessionPauseUnavailableUntil) {
      return {
        hasSession: false,
        skipped: true,
        error: 'system-media-session-query-cooling-down'
      };
    }

    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
function Wait-WinRtAsyncOperation($operation, [Type]$resultType) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
  }
  foreach ($method in $methods) {
    try {
      $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
      return $task.GetAwaiter().GetResult()
    } catch {}
  }
  throw 'Unable to await WinRT operation.'
}
$operation = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Wait-WinRtAsyncOperation $operation $managerType
$session = $manager.GetCurrentSession()
if ($null -eq $session) {
  @{ hasSession = $false } | ConvertTo-Json -Compress
  exit 0
}
$playbackInfo = $session.GetPlaybackInfo()
$status = if ($playbackInfo -and $playbackInfo.PlaybackStatus) { $playbackInfo.PlaybackStatus.ToString() } else { 'Unknown' }
$pauseSucceeded = $false
$afterStatus = $status
if ($status -eq 'Playing') {
  try {
    $pauseOperation = $session.TryPauseAsync()
    $pauseSucceeded = Wait-WinRtAsyncOperation $pauseOperation ([bool])
    $afterInfo = $session.GetPlaybackInfo()
    if ($afterInfo -and $afterInfo.PlaybackStatus) { $afterStatus = $afterInfo.PlaybackStatus.ToString() }
  } catch {
    $pauseSucceeded = $false
  }
}
@{
  hasSession = $true
  playbackStatus = $status
  afterStatus = $afterStatus
  pauseSucceeded = [bool]$pauseSucceeded
  sourceAppUserModelId = $session.SourceAppUserModelId
} | ConvertTo-Json -Compress
`;

    try {
      const output = this._runSystemMediaSessionScript(script).trim();
      const jsonLine = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .reverse()
        .find(line => line.startsWith('{') && line.endsWith('}'));
      if (!jsonLine) return { hasSession: false, error: 'no-media-session-output' };
      return JSON.parse(jsonLine);
    } catch (err) {
      const error = this._compactSystemMediaSessionError(err);
      this.systemMediaSessionPauseUnavailableUntil = Date.now() + this.systemMediaSessionCooldownMs;
      this.logger.info(`MediaController: system media session query unavailable (${error})`);
      return { hasSession: false, error };
    }
  }

  _tryResumeSystemMediaSession(sourceAppUserModelId = '') {
    if (Date.now() < this.systemMediaSessionResumeUnavailableUntil) {
      return {
        hasSession: false,
        playSucceeded: false,
        skipped: true,
        error: 'system-media-session-resume-cooling-down'
      };
    }

    const safeSource = String(sourceAppUserModelId || '').replace(/'/g, "''");
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
function Wait-WinRtAsyncOperation($operation, [Type]$resultType) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
  }
  foreach ($method in $methods) {
    try {
      $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
      return $task.GetAwaiter().GetResult()
    } catch {}
  }
  throw 'Unable to await WinRT operation.'
}
$operation = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Wait-WinRtAsyncOperation $operation $managerType
$session = $manager.GetCurrentSession()
$sourceAppUserModelId = '${safeSource}'
if ($sourceAppUserModelId) {
  foreach ($candidate in $manager.GetSessions()) {
    if ($candidate.SourceAppUserModelId -eq $sourceAppUserModelId) {
      $session = $candidate
      break
    }
  }
}
if ($null -eq $session) {
  @{ hasSession = $false; playSucceeded = $false } | ConvertTo-Json -Compress
  exit 0
}
$playbackInfo = $session.GetPlaybackInfo()
$status = if ($playbackInfo -and $playbackInfo.PlaybackStatus) { $playbackInfo.PlaybackStatus.ToString() } else { 'Unknown' }
$playSucceeded = $false
$afterStatus = $status
if ($status -ne 'Playing') {
  try {
    $playOperation = $session.TryPlayAsync()
    $playSucceeded = Wait-WinRtAsyncOperation $playOperation ([bool])
    $afterInfo = $session.GetPlaybackInfo()
    if ($afterInfo -and $afterInfo.PlaybackStatus) { $afterStatus = $afterInfo.PlaybackStatus.ToString() }
  } catch {
    $playSucceeded = $false
  }
}
@{
  hasSession = $true
  playbackStatus = $status
  afterStatus = $afterStatus
  playSucceeded = [bool]$playSucceeded
  sourceAppUserModelId = $session.SourceAppUserModelId
} | ConvertTo-Json -Compress
`;

    try {
      const output = this._runSystemMediaSessionScript(script).trim();
      const jsonLine = output
        .split(/\r?\n/)
        .map(line => line.trim())
        .reverse()
        .find(line => line.startsWith('{') && line.endsWith('}'));
      if (!jsonLine) return { hasSession: false, error: 'no-media-session-output' };
      return JSON.parse(jsonLine);
    } catch (err) {
      const error = this._compactSystemMediaSessionError(err);
      this.systemMediaSessionResumeUnavailableUntil = Date.now() + this.systemMediaSessionCooldownMs;
      this.logger.info(`MediaController: system media session resume unavailable (${error})`);
      return { hasSession: false, playSucceeded: false, error };
    }
  }

  _runSystemMediaSessionScript(script) {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      timeout: 2500,
      stdio: 'pipe',
      encoding: 'utf8'
    });
  }

  _compactSystemMediaSessionError(err) {
    const raw = Buffer.isBuffer(err?.stderr)
      ? err.stderr.toString('utf8')
      : String(err?.stderr || err?.message || err || '');
    const message = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean) || 'unknown-error';
    return message.replace(/\s+/g, ' ').slice(0, 220);
  }
}

module.exports = MediaController;
module.exports.INTERNET_ERROR_MESSAGE = BrowserController.INTERNET_ERROR_MESSAGE;

const phoneticModule = (() => {
'use strict';

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function encodeToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/^wh/, 'w')
    .replace(/ph/g, 'f')
    .replace(/gh/g, '')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/[aeiou]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function doubleMetaphone(value) {
  const compact = normalize(value).replace(/\s+/g, '');
  if (!compact) {
    return [];
  }

  const encoded = encodeToken(compact).toUpperCase();
  return Array.from(new Set([encoded, encoded.slice(0, 6), encoded.slice(0, 4)].filter(Boolean)));
}

return {
  doubleMetaphone
};

})();
const platformModule = (() => {
'use strict';

const Fuse = require('fuse.js');
const { doubleMetaphone } = phoneticModule;

const DEFAULT_PLATFORM = 'youtube';

const PLATFORMS = Object.freeze([
  {
    id: 'youtube',
    name: 'YouTube',
    aliases: ['youtube', 'you tube', 'yt', 'tube', 'browser playback']
  },
  {
    id: 'spotify',
    name: 'Spotify',
    aliases: ['spotify', 'spoti fy', 'spotyfy', 'spotifie']
  },
  {
    id: 'apple music',
    name: 'Apple Music',
    aliases: ['apple music', 'applemusic', 'apple musix', 'apple muzik', 'apple']
  },
  {
    id: 'amazon music',
    name: 'Amazon Music',
    aliases: ['amazon music', 'amazonmusic', 'amazon']
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    aliases: ['soundcloud', 'sound cloud']
  },
  {
    id: 'gaana',
    name: 'Gaana',
    aliases: ['gaana', 'gana']
  },
  {
    id: 'jiosaavn',
    name: 'JioSaavn',
    aliases: ['jiosaavn', 'jio saavn', 'saavn', 'jio music']
  },
  {
    id: 'local',
    name: 'local media',
    aliases: ['local', 'local media', 'my music', 'offline music']
  },
  {
    id: 'browser',
    name: 'browser playback',
    aliases: ['browser', 'chrome', 'edge', 'firefox']
  }
]);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phonetic(value) {
  return doubleMetaphone(normalize(value)).filter(Boolean);
}

class PlatformMapper {
  constructor(options = {}) {
    this.defaultPlatform = options.defaultPlatform || DEFAULT_PLATFORM;
    this.platforms = options.platforms || PLATFORMS;
    this.entries = this.platforms.flatMap(platform => {
      return [platform.id, platform.name, ...(platform.aliases || [])].map(alias => ({
        platform,
        label: normalize(alias),
        codes: phonetic(alias)
      }));
    });
    this.fuse = new Fuse(this.entries, {
      keys: ['label'],
      includeScore: true,
      threshold: 0.35,
      ignoreLocation: true
    });
  }

  normalizePlatform(input) {
    const source = normalize(input);
    if (!source) return null;

    const exact = this.entries.find(entry => entry.label === source);
    if (exact) {
      return { platform: exact.platform.id, confidence: 1, reason: 'exact' };
    }

    const sourceCodes = phonetic(source);
    const phoneticMatch = this.entries.find(entry => {
      return entry.codes.some(code => sourceCodes.includes(code));
    });
    if (phoneticMatch) {
      return { platform: phoneticMatch.platform.id, confidence: 0.91, reason: 'phonetic' };
    }

    const result = this.fuse.search(source, { limit: 1 })[0];
    if (!result || 1 - result.score < 0.72) {
      return null;
    }

    return {
      platform: result.item.platform.id,
      confidence: Number((1 - result.score).toFixed(2)),
      reason: 'fuzzy'
    };
  }

  infer(explicitPlatform, context = {}) {
    const explicit = this.normalizePlatform(explicitPlatform);
    if (explicit) return explicit;

    const runningApps = Array.isArray(context.runningApps) ? context.runningApps : [];
    const activeApp = normalize(context.activeApp);
    const activeTitle = normalize(context.activeTitle);
    const currentMode = String(context.currentMode || '').toUpperCase();
    const appText = normalize([activeApp, activeTitle, ...runningApps].join(' '));

    if (currentMode === 'MEDIA_MODE') {
      if (appText.includes('spotify')) {
        return { platform: 'spotify', confidence: 0.88, reason: 'media-mode-spotify' };
      }
      if (appText.includes('apple music') || appText.includes('applemusic')) {
        return { platform: 'apple music', confidence: 0.88, reason: 'media-mode-apple-music' };
      }
      if (appText.includes('youtube') || appText.includes('chrome') || appText.includes('msedge')) {
        return { platform: 'youtube', confidence: 0.86, reason: 'media-mode-browser' };
      }
    }

    if (appText.includes('spotify')) {
      return { platform: 'spotify', confidence: 0.86, reason: 'running-app' };
    }

    if (appText.includes('apple music') || appText.includes('applemusic')) {
      return { platform: 'apple music', confidence: 0.86, reason: 'running-app' };
    }

    if (activeApp.includes('chrome') || activeApp.includes('msedge') || activeApp.includes('firefox')) {
      return { platform: 'youtube', confidence: 0.82, reason: 'active-browser' };
    }

    return { platform: this.defaultPlatform, confidence: 0.75, reason: 'default' };
  }
}

return {
  DEFAULT_PLATFORM,
  PLATFORMS,
  PlatformMapper,
  normalize
};

})();
const parserModule = ((platformModule, phoneticModule) => {
'use strict';

const Logger = require('../assistant/Data').Logger;
const { PlatformMapper } = platformModule;

const GENERIC_MEDIA_TERMS = new Set([
  'music',
  'song',
  'songs',
  'track',
  'tracks',
  'video',
  'videos'
]);

const GENRES = new Set([
  'punjabi',
  'hindi',
  'bollywood',
  'lofi',
  'lo-fi',
  'devotional',
  'bhajan',
  'rock',
  'pop',
  'classical',
  'rap'
]);

const CONTROL_PATTERNS = [
  { intent: 'media.next', regex: /\b(?:next|skip|next song|next track|play next)\b/ },
  { intent: 'media.previous', regex: /\b(?:previous|prev|go back|back song|play previous)\b/ },
  { intent: 'media.pause', regex: /\b(?:pause|pause song|pause music|pause playback)\b/ },
  { intent: 'media.resume', regex: /\b(?:resume|continue|unpause|play again|resume playback)\b/ },
  { intent: 'media.stop', regex: /\b(?:stop music|stop song|stop playback|stop media)\b/ }
];

const PLAY_VERB_PATTERN = /\b(?:play|stream|listen\s+to|watch|queue|put\s+on|start\s+playing)\b/;
const SEARCH_VERB_PATTERN = /\b(?:search|find|look\s+up)\b/;

function cleanup(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\bspoti\s+fy\b/g, 'spotify')
    .replace(/\byou\s+tube\b/g, 'youtube')
    .replace(/\bapple\s+musix\b/g, 'apple music')
    .replace(/\bapplemusic\b/g, 'apple music')
    .replace(/\bplay\s+nexr\s+sony\b/g, 'play next song')
    .replace(/\bsony\b/g, 'song')
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPoliteNoise(input) {
  return String(input || '')
    .replace(/\b(?:please|kindly|now|can you|could you|would you|open)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function removePlatformClause(input) {
  return String(input || '')
    .replace(/\b(?:on|in|via|using)\s+(?:youtube|spotify|apple music|amazon music|soundcloud|gaana|jiosaavn|saavn|you tube|spoti fy|browser|chrome|edge|firefox|local media|local)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstPlayTail(input) {
  const match = input.match(PLAY_VERB_PATTERN);
  if (match) {
    return input.slice(match.index + match[0].length).trim();
  }
  return '';
}

function tokenize(input) {
  return String(input || '').split(/\s+/).filter(Boolean);
}

function restoreKnownTitleCompounds(entityText, normalizedText) {
  const entity = String(entityText || '').trim();
  const source = String(normalizedText || '').trim();

  if (/\bplay\s+date(?:\s+(?:song|songs|music|track|tracks|video|videos))?\b/.test(source) &&
    /^date(?:\s+(?:song|songs|music|track|tracks|video|videos))?$/.test(entity)) {
    return entity.replace(/^date\b/, 'playdate');
  }

  return entity;
}

class MediaParser {
  constructor(options = {}) {
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.platformMapper = options.platformMapper || new PlatformMapper(options);
  }

  parse(input, context = {}) {
    const originalText = String(input || '');
    const normalizedText = cleanup(originalText);
    if (!normalizedText) {
      return this._empty(originalText, normalizedText);
    }

    const control = CONTROL_PATTERNS.find(pattern => pattern.regex.test(normalizedText));
    if (control) {
      const explicitPlatform = this._extractPlatformText(normalizedText);
      const platform = this.platformMapper.infer(explicitPlatform, context);
      return this._result({
        intent: control.intent,
        platform: platform.platform,
        platformConfidence: platform.confidence,
        confidence: 0.96,
        originalText,
        normalizedText
      });
    }

    const hasPlayVerb = PLAY_VERB_PATTERN.test(normalizedText);
    const hasSearchVerb = SEARCH_VERB_PATTERN.test(normalizedText);
    const hasMediaTerm = tokenize(normalizedText).some(token => GENERIC_MEDIA_TERMS.has(token));
    if (!hasPlayVerb && !(hasSearchVerb && hasMediaTerm)) {
      return this._empty(originalText, normalizedText);
    }

    const explicitPlatform = this._extractPlatformText(normalizedText);
    const inferredPlatform = this.platformMapper.infer(explicitPlatform, context);
    const tail = removePlatformClause(stripPoliteNoise(firstPlayTail(normalizedText) || normalizedText));
    const entityText = restoreKnownTitleCompounds(this._cleanEntityText(tail), normalizedText);
    const genre = this._extractGenre(entityText);
    const query = this._buildQuery({ genre, entityText });

    const intent = hasPlayVerb ? 'media.play' : 'media.search';
    const confidence = this._score({
      hasPlayVerb,
      platformConfidence: inferredPlatform.confidence,
      query
    });

    return this._result({
      intent,
      genre,
      platform: inferredPlatform.platform,
      platformConfidence: inferredPlatform.confidence,
      query,
      confidence,
      originalText,
      normalizedText
    });
  }

  _empty(originalText, normalizedText) {
    return {
      intent: null,
      genre: null,
      platform: null,
      query: null,
      confidence: 0,
      originalText,
      normalizedText
    };
  }

  _result(result) {
    const parsed = {
      intent: result.intent,
      genre: result.genre || null,
      platform: result.platform || null,
      query: result.query || null,
      confidence: Number(Math.max(0, Math.min(1, result.confidence || 0)).toFixed(2)),
      platformConfidence: Number((result.platformConfidence || 0).toFixed(2)),
      originalText: result.originalText,
      normalizedText: result.normalizedText
    };

    this.logger.info(`[Media] Parsed -> ${parsed.intent || 'none'}`);
    if (parsed.platform) this.logger.info(`[Media] Platform inferred -> ${parsed.platform}`);
    this.logger.info(`[Media] Confidence -> ${parsed.confidence}`);
    return parsed;
  }

  _extractPlatformText(input) {
    const source = cleanup(input);
    const match = source.match(/\b(?:on|in|via|using|open)\s+([a-z\s]+?)(?=\s+(?:and|play|songs?|tracks?|$)|$)/);
    if (match && match[1]) {
      return match[1].trim();
    }

    for (const platform of ['apple music', 'amazon music', 'soundcloud', 'jiosaavn', 'saavn', 'youtube', 'you tube', 'spotify', 'spoti fy', 'gaana', 'chrome', 'browser', 'local media']) {
      if (source.includes(platform)) {
        return platform;
      }
    }

    return null;
  }

  _cleanEntityText(input) {
    return String(input || '')
      .replace(/\b(?:and|play|open|on|in|via|using)\b/g, ' ')
      .replace(/\b(?:the|a|an|called|named)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractGenre(input) {
    const tokens = tokenize(input);
    const genre = tokens.find(token => GENRES.has(token));
    return genre || null;
  }

  _buildQuery({ genre, entityText }) {
    const preferenceMatch = String(entityText || '').match(/\b(?:liked|favorite|favourite)\s+(?:song|songs|music|tracks?)\b/i);
    if (preferenceMatch) return preferenceMatch[0].toLowerCase();

    const original = String(entityText || '').trim();
    const cleaned = String(entityText || '')
      .replace(/\b(?:song|songs|music|tracks?|videos?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned && original) {
      return original;
    }

    if (genre) return `${genre} songs`;

    return cleaned || 'music';
  }

  _score({ hasPlayVerb, platformConfidence, query }) {
    let score = 0.35;
    if (hasPlayVerb) score += 0.24;
    if (query) score += 0.16;
    score += Math.min(0.09, (platformConfidence || 0) * 0.09);
    return score;
  }
}

return {
  MediaParser,
  cleanup
};

})(platformModule, phoneticModule);
const mediaRouterModule = ((parserModule) => {
'use strict';

const Logger = require('../assistant/Data').Logger;
const { MediaParser } = parserModule;

const EXECUTABLE_CONFIDENCE = 0.58;

class MediaCommandRouter {
  constructor(options = {}) {
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.parser = options.parser || new MediaParser(options);
    this.contextProvider = options.contextProvider || null;
  }

  parse(input, context = {}) {
    return this.parser.parse(input, context);
  }

  route(input, options = {}) {
    const source = options.source || 'voice-command';
    const context = {
      ...this._getContext(),
      ...(options.context || {}),
      source
    };
    const parsed = this.parser.parse(input, context);

    if (!parsed.intent || parsed.confidence < EXECUTABLE_CONFIDENCE) {
      return {
        success: false,
        parsed,
        reason: parsed.intent ? 'low-confidence' : 'not-media'
      };
    }

    const payload = this._payloadFor(parsed, source);
    this.logger.info(`[Media] Routed -> ${payload.action}`);
    return {
      success: true,
      parsed,
      payload
    };
  }

  _payloadFor(parsed, source) {
    const payload = {
      action: parsed.intent,
      platform: parsed.platform,
      query: parsed.query,
      source,
      confidence: parsed.confidence
    };

    if (parsed.intent === 'media.play' || parsed.intent === 'media.search') {
      payload.mediaQuery = parsed.query;
      payload.mediaPlatform = parsed.platform;
      payload.genre = parsed.genre;
    }

    return payload;
  }

  _getContext() {
    if (!this.contextProvider) {
      return {};
    }

    try {
      if (typeof this.contextProvider === 'function') {
        return this.contextProvider() || {};
      }
      if (typeof this.contextProvider.getSnapshot === 'function') {
        return this.contextProvider.getSnapshot() || {};
      }
    } catch (err) {
      this.logger.warn('[Media] Context read failed', err.message);
    }

    return {};
  }
}

return {
  MediaCommandRouter,
  EXECUTABLE_CONFIDENCE
};

})(parserModule);
module.exports.MediaCommandRouter = mediaRouterModule.MediaCommandRouter;
module.exports.MediaParser = parserModule.MediaParser;
module.exports.PlatformMapper = platformModule.PlatformMapper;
module.exports.doubleMetaphone = phoneticModule.doubleMetaphone;
