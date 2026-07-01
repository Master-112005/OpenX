const assert = require('assert');

describe('Media Controller', function() {
  let MediaController;

  before(function() {
    MediaController = require('../../core/automation/media');
  });

  function createController() {
    const controller = new MediaController({});
    controller.sentMediaKeys = [];
    controller._sendGlobalMediaKey = key => {
      controller.sentMediaKeys.push(key);
    };
    return controller;
  }

  it('should prefer a managed YouTube launch over reusing an existing browser tab', async function() {
    const controller = createController();
    controller._fetchFirstYouTubeVideoId = async () => 'rODr5Zfj8RA';

    controller.windowSession.navigateWindowToUrl = () => {
      throw new Error('existing browser tabs should not be reused for requested playback');
    };
    let launchedRequest = null;
    controller._launchYouTubeLocal = async (query, url) => {
      launchedRequest = { query, url };
      return {
        success: true,
        method: 'chrome-pwa',
        url,
        managedWindow: true,
        windowQuery: 'youtube'
      };
    };
    controller.browser.open = () => {
      throw new Error('browser fallback should not be used when managed launch succeeds');
    };

    const result = await controller.play('playdate', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'chrome-pwa');
    assert.deepEqual(controller.sentMediaKeys, [178]);
    assert.equal(result.data.verified, true);
    assert.equal(result.data.playbackVerification.valid, true);
    assert.equal(result.data.playbackVerification.requestedQuery, 'playdate');
    assert.equal(result.data.playbackVerification.stoppedPreviousPlayback, true);
    assert.equal(launchedRequest.query, 'playdate');
    assert.ok(launchedRequest.url.includes('rODr5Zfj8RA'));
  });

  it('should not reuse a plain Chrome tab when no YouTube window is visible', async function() {
    const controller = createController();
    controller._fetchFirstYouTubeVideoId = async () => 'rODr5Zfj8RA';

    controller.windowSession.navigateWindowToUrl = () => {
      throw new Error('plain Chrome tabs should not be inspected for media replacement');
    };

    let launched = false;
    controller._launchYouTubeLocal = async (query, url) => {
      launched = true;
      return {
        success: true,
        method: 'chrome-pwa',
        url,
        managedWindow: true,
        windowQuery: 'youtube'
      };
    };

    const result = await controller.play('dulander songs', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'chrome-pwa');
    assert.deepEqual(controller.sentMediaKeys, [178]);
    assert.equal(result.data.verified, true);
    assert.equal(result.data.playbackVerification.valid, true);
    assert.equal(launched, true);
  });

  it('should close a managed session before launching replacement playback', async function() {
    const controller = createController();
    controller.activeSession = {
      platform: 'youtube',
      managedWindow: true,
      windowQuery: 'youtube'
    };
    controller._fetchFirstYouTubeVideoId = async () => 'Pb2KJlBGids';

    let closeCalled = false;
    controller.windowSession.navigateWindowToUrl = () => {
      throw new Error('managed replacement should close the old media window instead of reusing it');
    };
    controller.windowSession.closeWindow = () => {
      closeCalled = true;
      return { success: true, data: { matchedWindow: 'Old Track - YouTube' } };
    };
    controller._launchYouTubeLocal = async (query, url) => ({
      success: true,
      method: 'chrome-pwa',
      url,
      managedWindow: true,
      windowQuery: 'youtube'
    });

    const result = await controller.play('dulander 2', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'chrome-pwa');
    assert.deepEqual(controller.sentMediaKeys, []);
    assert.equal(closeCalled, true);
  });

  it('should close a managed previous platform before starting requested media', async function() {
    const controller = createController();
    controller.activeSession = {
      platform: 'spotify',
      managedWindow: true,
      windowQuery: 'spotify'
    };
    controller._fetchFirstYouTubeVideoId = async () => 'rODr5Zfj8RA';

    const events = [];
    controller.windowSession.closeWindow = (windowQuery) => {
      events.push(`close:${windowQuery}`);
      return { success: true, data: { matchedWindow: 'Spotify' } };
    };
    controller._launchYouTubeLocal = async (query, url) => {
      events.push('launch');
      return {
        success: true,
        method: 'chrome-pwa',
        url,
        managedWindow: true,
        windowQuery: 'youtube'
      };
    };

    const result = await controller.play('playdate', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'chrome-pwa');
    assert.equal(result.data.closedPreviousPlayback, true);
    assert.deepEqual(controller.sentMediaKeys, []);
    assert.deepEqual(events, ['close:spotify', 'launch']);
  });

  it('should stop an unmanaged previous session before starting requested media', async function() {
    const controller = createController();
    controller.activeSession = {
      platform: 'spotify',
      managedWindow: false,
      windowQuery: 'spotify'
    };
    controller._fetchFirstYouTubeVideoId = async () => 'rODr5Zfj8RA';

    const events = [];
    controller._launchYouTubeLocal = async () => {
      events.push('launch');
      return {
        success: true,
        method: 'chrome-pwa',
        url: 'https://www.youtube.com/watch?v=rODr5Zfj8RA&autoplay=1',
        managedWindow: true,
        windowQuery: 'youtube'
      };
    };

    const result = await controller.play('playdate', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'chrome-pwa');
    assert.equal(result.data.stoppedPreviousPlayback, true);
    assert.deepEqual(controller.sentMediaKeys, [178]);
    assert.deepEqual(events, ['launch']);
  });

  it('should report the last known media session', function() {
    const controller = createController();
    controller.activeSession = {
      query: 'coding focus music',
      platform: 'youtube',
      appName: 'YouTube',
      launchMethod: 'existing-window',
      url: 'https://www.youtube.com/watch?v=test',
      windowQuery: 'youtube'
    };

    const result = controller.status();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'status');
    assert.equal(result.data.query, 'coding focus music');
    assert.equal(result.data.platform, 'youtube');
    assert.equal(result.data.knownPlayback, true);
  });

  it('should pause a playing Windows media session for voice activation', function() {
    const controller = createController();
    controller._tryPauseSystemMediaSession = () => ({
      hasSession: true,
      playbackStatus: 'Playing',
      afterStatus: 'Paused',
      pauseSucceeded: true,
      sourceAppUserModelId: 'SpotifyAB.SpotifyMusic'
    });

    const result = controller.quietForVoiceActivation();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'pause');
    assert.equal(result.data.method, 'system-media-session');
    assert.equal(result.data.sourceAppUserModelId, 'SpotifyAB.SpotifyMusic');
    assert.equal(result.data.restore.action, 'resume');
    assert.deepEqual(controller.sentMediaKeys, []);
  });

  it('should not toggle media controls when Windows reports media is not playing', function() {
    const controller = createController();
    controller._tryPauseSystemMediaSession = () => ({
      hasSession: true,
      playbackStatus: 'Paused',
      pauseSucceeded: false
    });

    const result = controller.quietForVoiceActivation();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'none');
    assert.equal(result.data.reason, 'media-not-playing');
    assert.deepEqual(controller.sentMediaKeys, []);
  });

  it('should use the global media key fallback only when playback was confirmed playing', function() {
    const controller = createController();
    controller._tryPauseSystemMediaSession = () => ({
      hasSession: true,
      playbackStatus: 'Playing',
      pauseSucceeded: false,
      sourceAppUserModelId: 'Video.Player'
    });

    const result = controller.quietForVoiceActivation();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'pause');
    assert.equal(result.data.method, 'global-media-key-fallback');
    assert.equal(result.data.restore.action, 'resume');
    assert.deepEqual(controller.sentMediaKeys, [179]);
  });

  it('should fall back to the known OpenX media session when Windows media state is unavailable', function() {
    const controller = createController();
    controller._tryPauseSystemMediaSession = () => ({ hasSession: false });
    controller.activeSession = {
      platform: 'youtube',
      windowQuery: 'youtube'
    };
    controller.windowSession.sendKeys = () => ({ success: true, data: { matchedWindow: 'Track - YouTube' } });

    const result = controller.quietForVoiceActivation();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'pause');
    assert.equal(result.data.method, 'known-openx-media-session');
    assert.equal(result.data.restore.action, 'resume');
    assert.equal(result.data.fallback, true);
  });

  it('should cool down repeated unavailable Windows media session checks', function() {
    const controller = createController();
    const logs = [];
    let calls = 0;
    controller.logger = { info: message => logs.push(message) };
    controller.systemMediaSessionCooldownMs = 60000;
    controller._runSystemMediaSessionScript = () => {
      calls += 1;
      const error = new Error('Command failed: powershell.exe -NoProfile -Command $ErrorActionPreference = Stop');
      error.stderr = Buffer.from("Cannot find an overload for AsTask\nAt line:1 char:1\n$ErrorActionPreference = 'Stop'");
      throw error;
    };

    const first = controller._tryPauseSystemMediaSession();
    const second = controller._tryPauseSystemMediaSession();

    assert.equal(first.hasSession, false);
    assert.equal(first.error, 'Cannot find an overload for AsTask');
    assert.equal(second.skipped, true);
    assert.equal(calls, 1);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes('$ErrorActionPreference'));
  });

  it('should resume only media that was paused for voice activation', function() {
    const controller = createController();
    const quietingResult = {
      data: {
        action: 'pause',
        method: 'system-media-session',
        restore: {
          action: 'resume',
          method: 'system-media-session',
          sourceAppUserModelId: 'SpotifyAB.SpotifyMusic'
        }
      }
    };
    controller._tryResumeSystemMediaSession = sourceAppUserModelId => ({
      hasSession: true,
      playbackStatus: 'Paused',
      afterStatus: 'Playing',
      playSucceeded: true,
      sourceAppUserModelId
    });

    const result = controller.restoreAfterVoiceActivation(quietingResult);

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'resume');
    assert.equal(result.data.method, 'system-media-session');
    assert.equal(result.data.sourceAppUserModelId, 'SpotifyAB.SpotifyMusic');
  });

  it('should not resume media when voice activation did not pause anything', function() {
    const controller = createController();
    let resumed = false;
    controller._tryResumeSystemMediaSession = () => {
      resumed = true;
      return { playSucceeded: true };
    };

    const result = controller.restoreAfterVoiceActivation({ data: { action: 'none' } });

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'none');
    assert.equal(resumed, false);
  });

  it('should dispatch YouTube player shortcut controls with verification data', function() {
    const controller = createController();
    controller.activeSession = {
      platform: 'youtube',
      windowQuery: 'youtube'
    };

    let shortcut = null;
    controller.windowSession.sendKeys = (windowQuery, keys, options) => {
      shortcut = { windowQuery, keys, options };
      return { success: true, data: { matchedWindow: 'Example - YouTube' } };
    };

    const result = controller.fullscreen();

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'fullscreen');
    assert.equal(result.data.method, 'window-shortcut');
    assert.equal(result.data.matchedWindow, 'Example - YouTube');
    assert.equal(shortcut.windowQuery, 'youtube');
    assert.equal(shortcut.keys, 'f');
  });
});
