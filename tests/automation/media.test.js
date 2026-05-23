const assert = require('assert');

describe('Media Controller', function() {
  let MediaController;

  before(function() {
    MediaController = require('../../core/automation/media/index');
  });

  it('should reuse an existing YouTube window for replacement playback', async function() {
    const controller = new MediaController({});
    controller._fetchFirstYouTubeVideoId = async () => 'rODr5Zfj8RA';

    let reusedRequest = null;
    controller.windowSession.navigateWindowToUrl = (windowQuery, url) => {
      reusedRequest = { windowQuery, url };
      return { success: true, data: { matchedWindow: 'Playdate - YouTube' } };
    };
    controller._launchYouTubeLocal = async () => {
      throw new Error('local launch should not be used when reuse succeeds');
    };
    controller.browser.open = () => {
      throw new Error('browser fallback should not be used when reuse succeeds');
    };

    const result = await controller.play('playdate', 'youtube');

    assert.equal(result.success, true);
    assert.equal(result.data.launchMethod, 'existing-window');
    assert.equal(reusedRequest.windowQuery, 'youtube');
    assert.ok(reusedRequest.url.includes('rODr5Zfj8RA'));
  });

  it('should close a managed session before launching replacement playback', async function() {
    const controller = new MediaController({});
    controller.activeSession = {
      platform: 'youtube',
      managedWindow: true,
      windowQuery: 'youtube'
    };
    controller._fetchFirstYouTubeVideoId = async () => 'Pb2KJlBGids';

    let closeCalled = false;
    controller.windowSession.navigateWindowToUrl = () => ({ success: false });
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
    assert.equal(closeCalled, true);
  });
});
