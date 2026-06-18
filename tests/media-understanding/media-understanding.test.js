const assert = require('assert');

describe('Media Understanding', function() {
  it('should normalize platform names and spacing mistakes', function() {
    const { PlatformMapper } = require('../../core/media-understanding/platform-mapper');
    const mapper = new PlatformMapper();

    assert.equal(mapper.normalizePlatform('you tube').platform, 'youtube');
    assert.equal(mapper.normalizePlatform('spoti fy').platform, 'spotify');
    assert.equal(mapper.normalizePlatform('apple musix').platform, 'apple music');
  });

  it('should infer Spotify from running apps and YouTube by default', function() {
    const { PlatformMapper } = require('../../core/media-understanding/platform-mapper');
    const mapper = new PlatformMapper();

    assert.equal(mapper.infer(null, { runningApps: ['Spotify.exe'] }).platform, 'spotify');
    assert.equal(mapper.infer(null, {}).platform, 'youtube');
  });

  it('should preserve typed media names instead of correcting them', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const parsed = parser.parse('play dulander songs', { source: 'chat' });

    assert.equal(parsed.intent, 'media.play');
    assert.equal(parsed.query, 'dulander songs');
    assert.equal(parsed.platform, 'youtube');
  });

  it('should keep playdate as the requested media title when spoken as play date', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const parsed = parser.parse('you have to the play date song', { source: 'chat' });

    assert.equal(parsed.intent, 'media.play');
    assert.equal(parsed.query, 'playdate song');
    assert.equal(parsed.platform, 'youtube');
  });

  it('should preserve voice media names instead of correcting them', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const parsed = parser.parse('play dulander songs', { source: 'voice' });

    assert.equal(parsed.intent, 'media.play');
    assert.equal(parsed.query, 'dulander songs');
    assert.ok(parsed.confidence >= 0.7);
  });

  it('should keep generic song requests generic instead of inventing an artist', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const parsed = parser.parse('play songs');

    assert.equal(parsed.intent, 'media.play');
    assert.equal(parsed.query, 'music');
    assert.equal(parsed.platform, 'youtube');
  });

  it('should parse open-platform-and-play commands', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const parsed = parser.parse('open youtube and play punjabi songs');

    assert.equal(parsed.intent, 'media.play');
    assert.equal(parsed.genre, 'punjabi');
    assert.equal(parsed.query, 'punjabi songs');
    assert.equal(parsed.platform, 'youtube');
  });

  it('should keep Apple Music playback requests on Apple Music', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    const spaced = parser.parse('play songs on apple music');
    const compact = parser.parse('play songs on applemusic');

    assert.equal(spaced.intent, 'media.play');
    assert.equal(spaced.query, 'music');
    assert.equal(spaced.platform, 'apple music');
    assert.equal(compact.platform, 'apple music');
  });

  it('should parse media controls and malformed input safely', function() {
    const { MediaParser } = require('../../core/media-understanding/parser');
    const parser = new MediaParser();

    assert.equal(parser.parse('pause song').intent, 'media.pause');
    assert.equal(parser.parse('resume spotify').platform, 'spotify');
    assert.equal(parser.parse('').intent, null);
    assert.equal(parser.parse('asdf qwerty').confidence, 0);
  });

  it('should route media commands to automation payloads', function() {
    const { MediaUnderstandingRouter } = require('../../core/media-understanding/media-router');
    const router = new MediaUnderstandingRouter();

    const routed = router.route('play music', {
      source: 'voice-command',
      context: { activeApp: 'chrome.exe' }
    });

    assert.equal(routed.success, true);
    assert.equal(routed.payload.action, 'media.play');
    assert.equal(routed.payload.mediaPlatform, 'youtube');
    assert.equal(routed.payload.mediaQuery, 'music');
    assert.equal(routed.payload.source, 'voice-command');
  });
});
