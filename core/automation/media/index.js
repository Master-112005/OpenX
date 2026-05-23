'use strict';

const fs = require('fs');
const https = require('https');
const { execFileSync, spawn } = require('child_process');
const Logger = require('../../shared/index').Logger;
const BrowserController = require('../browser/index');
const WindowsSessionController = require('../common/windows-session');
const { launchTarget } = require('../common/launcher');

const DEFAULT_PLATFORM = 'youtube';
const YOUTUBE_CHROME_PWA_APP_ID = 'Chrome._crx_agimnkijcamfeangaknmldooml';

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
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
          matchedWindow: reuseResult.data?.matchedWindow || null
        }
      };
    }

    this._closeManagedSession();

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
            url: localResult.url || null
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
        url: fallbackUrl
      }
    };
  }

  getSupportedPlatforms() {
    return Object.keys(PLATFORM_REGISTRY);
  }

  async _launchYouTubeLocal(query, preferredUrl) {
    const playUrl = preferredUrl || PLATFORM_REGISTRY.youtube.searchUrl(query);
    const chromePath = this._findChrome();

    if (chromePath) {
      try {
        const child = spawn(chromePath, [`--app=${playUrl}`], {
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

    try {
      launchTarget('C:\\Windows\\explorer.exe', [
        `shell:AppsFolder\\${YOUTUBE_CHROME_PWA_APP_ID}`
      ]);
      return {
        success: true,
        method: 'shell-app',
        url: playUrl,
        managedWindow: true,
        windowQuery: 'youtube'
      };
    } catch (err) {
      return { success: false, reason: 'no local youtube launcher found' };
    }
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

    return null;
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
    if (platformKey !== 'youtube' || !playUrl) {
      return { success: false };
    }

    const windowQuery = this.activeSession?.platform === 'youtube'
      ? (this.activeSession.windowQuery || 'youtube')
      : 'youtube';

    return this.windowSession.navigateWindowToUrl(
      windowQuery,
      playUrl,
      this._getWindowSearchOptions(platformKey)
    );
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

  _closeManagedSession() {
    if (!this.activeSession?.managedWindow) {
      return;
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
        preferredProcessNames: ['chrome', 'msedge', 'firefox']
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
