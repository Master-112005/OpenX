const assert = require('assert');
const ActionRouter = require('../../core/assistant/router');

const MEDIA_YOUTUBE_COMMANDS = [
  'Open YouTube',
  'Go to YouTube',
  'Launch YouTube',
  'Open my YouTube homepage',
  'Search YouTube for music',
  'Search YouTube for coding tutorials',
  'Search YouTube for funny videos',
  'Play the first YouTube result',
  'Open my YouTube subscriptions',
  'Show my YouTube watch history',
  'Open Watch Later playlist',
  'Play a YouTube video',
  'Pause the YouTube video',
  'Resume the YouTube video',
  'Skip to the next video',
  'Mute the YouTube video',
  'Unmute the YouTube video',
  'Increase YouTube volume',
  'Decrease YouTube volume',
  'Switch YouTube to fullscreen',
  'Exit fullscreen mode',
  'Like this YouTube video',
  'Subscribe to this channel',
  'Show trending videos',
  'Play the latest video from this channel',
  'Play music',
  'Pause music',
  'Resume music',
  'Stop music',
  'Next song',
  'Previous song',
  'Increase volume',
  'Decrease volume',
  'Mute audio',
  'Unmute audio',
  'Play my playlist',
  'Shuffle songs',
  'Repeat current song',
  'Play relaxing music',
  'Play workout music',
  'Play coding music',
  'Play jazz music',
  'Play pop music',
  'Play rock music',
  'Show currently playing song',
  'Add this song to favorites',
  'Open Spotify',
  'Open VLC Media Player',
  'Play this video file',
  'I want to watch something interesting on YouTube.',
  'Can you find a good programming tutorial on YouTube?',
  'Show me the latest videos from channels I follow.',
  'I feel like watching something funny.',
  'Find a video that explains Docker.',
  'Can you play the first video that comes up?',
  'Take me to my Watch Later list.',
  "Show me what's trending on YouTube today.",
  "I'm looking for a good Java tutorial.",
  'Can you find a Kubernetes course for beginners?',
  'Play the newest upload from this channel.',
  'I missed a few videos from my subscriptions.',
  'Find me a video about AI.',
  'Can you show me popular tech videos?',
  'I want to continue watching where I left off.',
  "Skip this video, I don't like it.",
  'Make this video fill the whole screen.',
  'Turn the sound down on this video.',
  'This video is too quiet.',
  'Can you replay that part?',
  'Show me videos related to this one.',
  'Find something educational to watch.',
  'I want to learn something new on YouTube.',
  'Take me back to the previous video.',
  'Show me videos people are watching right now.',
  "I'm in the mood for some music.",
  'Play something relaxing while I work.',
  'Can you put on my favorite playlist?',
  'I need background music for coding.',
  'Play something energetic.',
  'Find music that helps me focus.',
  'Skip this song.',
  "I don't feel like listening to this track.",
  'Turn the music up a little.',
  'The music is too loud.',
  'Pause the music for a moment.',
  'Resume whatever was playing.',
  'Play the next song.',
  'Go back to the previous song.',
  'Shuffle everything.',
  'Keep this song on repeat.',
  'What song is playing right now?',
  'I really like this song.',
  'Add this track to my favorites.',
  'Play some music similar to this.',
  'Can you find something calmer?',
  'Play workout music for me.',
  'I want something upbeat and motivating.',
  'Stop the music when this song ends.',
  'Continue playing music from where I stopped.'
];

function createRouter() {
  const config = {
    logging: { level: 'error' },
    permissions: {
      userLevel: 'critical',
      levels: {
        low: { requiresConfirmation: false, requiresAuth: false },
        medium: { requiresConfirmation: false, requiresAuth: false },
        high: { requiresConfirmation: false, requiresAuth: false },
        critical: { requiresConfirmation: false, requiresAuth: false }
      }
    }
  };
  return new ActionRouter(config, {
    execute(actionId, entities) {
      return { success: true, data: { actionId, ...(entities || {}) } };
    }
  });
}

describe('Media and YouTube natural-language routing', function() {
  this.timeout(20000);

  it('should route every supplied media and YouTube command without unsafe fallbacks', async function() {
    const router = createRouter();
    const failures = [];
    const localSteals = [];

    for (const command of MEDIA_YOUTUBE_COMMANDS) {
      const result = await router.process(command, 'chat');
      if (!result.success || !result.intent || result.intent === 'assistant.capability') {
        failures.push({ command, intent: result.intent, error: result.error, entities: result.entities });
      }
      if (/(youtube|video|music|song|playlist|track)/i.test(command) &&
        /^(folder\.|file\.|assistant\.capability)$/.test(result.intent || '')) {
        localSteals.push({ command, intent: result.intent, entities: result.entities });
      }
    }

    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
    assert.equal(localSteals.length, 0, JSON.stringify(localSteals, null, 2));
  });

  it('should route key YouTube page and player controls to concrete actions', async function() {
    const router = createRouter();
    const cases = [
      ['Open my YouTube subscriptions', 'browser.open', { url: 'https://www.youtube.com/feed/subscriptions' }],
      ['Show my YouTube watch history', 'browser.open', { url: 'https://www.youtube.com/feed/history' }],
      ['Open Watch Later playlist', 'browser.open', { url: 'https://www.youtube.com/playlist?list=WL' }],
      ['Search YouTube for coding tutorials', 'browser.siteSearch', { site: 'youtube', query: 'coding tutorials' }],
      ['Switch YouTube to fullscreen', 'media.fullscreen', {}],
      ['Exit fullscreen mode', 'media.exitFullscreen', {}],
      ['Mute the YouTube video', 'media.mute', {}],
      ['Unmute the YouTube video', 'media.unmute', {}],
      ['This video is too quiet.', 'media.volumeUp', {}],
      ["Skip this video, I don't like it.", 'media.next', {}],
      ['What song is playing right now?', 'media.status', {}],
      ['I want something upbeat and motivating.', 'media.play', { mediaQuery: 'upbeat motivating music' }]
    ];

    for (const [command, intent, expectedEntities] of cases) {
      const result = await router.process(command, 'chat');
      assert.equal(result.intent, intent, command);
      Object.entries(expectedEntities).forEach(([key, value]) => {
        assert.equal(result.entities[key], value, command);
      });
    }
  });

  it('should preserve typed song and artist names in media playback queries', async function() {
    const router = createRouter();

    const result = await router.process('play dulander songs', 'chat');

    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'dulander songs');
    assert.equal(Object.prototype.hasOwnProperty.call(result.entities, 'artist'), false);
  });
});
