const assert = require('assert');

describe('Action Router', function() {
  this.timeout(10000);
  let ActionRouter, AutomationEngine;

  before(function() {
    ActionRouter = require('../../core/assistant/router/index');
    AutomationEngine = require('../../core/automation/index');
  });

  it('should route volume up command', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('increase volume', 'chat');
    assert.equal(result.intent, 'volume.up');
    assert.ok(result.confidence >= 0.5);
  });

  it('should route open app command', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('open chrome', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.ok(result.entities.appName);
  });

  it('should route close app commands through the explicit app resolver', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('close chrome', 'voice');
    assert.equal(result.intent, 'app.close');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should tolerate misordered close app phrasing', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('chrome close please', 'voice');
    assert.equal(result.intent, 'app.close');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should tolerate close-like speech recognition errors for app closing', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('rose chrome', 'voice');
    assert.equal(result.intent, 'app.close');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should not infer terminal from "close to terminal"', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute() {
        throw new Error('should not execute');
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('close to terminal', 'voice');

    assert.equal(result.success, false);
    assert.notEqual(result.entities?.appName, 'cmd');
  });

  it('should route close power paint to PowerPoint closing', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('close power paint', 'voice');

    assert.equal(result.intent, 'app.close');
    assert.equal(result.entities.appName, 'powerpoint');
  });

  it('should route system status command', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('system status', 'chat');
    assert.equal(result.intent, 'system.status');
  });

  it('should tolerate spelling mistakes in intent detection', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('increse the volum please', 'chat');
    assert.equal(result.intent, 'volume.up');
    assert.ok(result.confidence >= 0.5);
  });

  it('should tolerate spelling mistakes in app names', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('opne chrmoe', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should salvage app commands from noisy STT tokens', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const misspelled = await router.process('ope chrome', 'voice');
    const noisy = await router.process('sglkn open lsg chrome', 'voice');
    const noisyMisspelled = await router.process('sglkn ope lsg chrome', 'voice');

    assert.equal(misspelled.intent, 'app.open');
    assert.equal(misspelled.entities.appName, 'chrome');
    assert.equal(noisy.intent, 'app.open');
    assert.equal(noisy.entities.appName, 'chrome');
    assert.equal(noisyMisspelled.intent, 'app.open');
    assert.equal(noisyMisspelled.entities.appName, 'chrome');
  });

  it('should salvage utility commands from noisy STT tokens', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('sglkn increse lsg volum', 'voice');

    assert.equal(result.intent, 'volume.up');
  });

  it('should extract commands from conversational lead-ins', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('i was just talking but please open chrome now', 'voice');

    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should extract search, timer, and reminder commands from surrounding speech', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const search = await router.process('i was saying please search for java tutorial okay', 'voice');
    const timer = await router.process('there is background speech set timer for 5 minutes', 'voice');
    const reminder = await router.process('i was talking remind me in 10 minutes to stand up', 'voice');

    assert.equal(search.intent, 'browser.search');
    assert.equal(search.entities.query, 'java tutorial');
    assert.equal(timer.intent, 'timer.set');
    assert.equal(timer.entities.duration, 5);
    assert.equal(reminder.intent, 'reminder.set');
    assert.equal(reminder.entities.duration, 10);
    assert.equal(reminder.entities.reminderText, 'stand up');
  });

  it('should preserve media commands when extracting from surrounding speech', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('i was saying stop music now', 'voice');

    assert.equal(result.intent, 'media.stop');
  });

  it('should not execute pure conversation without an action frame', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('i was just talking about chrome today', 'voice');

    assert.equal(result.success, false);
    assert.equal(result.error, 'Could not determine intent');
  });

  it('should route repaired polite app openings through the explicit app resolver', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('could you please go ahead and opne notpad', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'notepad');
  });

  it('should route explicit file open commands to file.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open practice.java', 'chat');
    assert.equal(result.intent, 'file.open');
    assert.equal(result.entities.filename, 'practice.java');
  });

  it('should route special folders in open commands to folder.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open downloads', 'chat');
    assert.equal(result.intent, 'folder.open');
    assert.equal(result.entities.folderName, 'downloads');
  });

  it('should route explicit suffix folder openings to folder.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open rakesh folder', 'chat');
    assert.equal(result.intent, 'folder.open');
    assert.equal(result.entities.folderName, 'rakesh');
  });

  it('should keep multi-word app names on app.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open apple music', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'apple music');
  });

  it('should route unknown app names to app.open for app discovery', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open google chat', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'google chat');
  });

  it('should route web searches to browser.search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('search for yesterdays ipl score', 'chat');
    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'yesterdays ipl score');
  });

  it('should route question-style queries to browser.search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('what is the ipl score yesterday', 'chat');
    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'what is the ipl score yesterday');
  });

  it('should route local time and date questions to system answers', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const time = await router.process('what si the time', 'chat');
    const day = await router.process('what is the day', 'chat');

    assert.equal(time.intent, 'system.time');
    assert.equal(day.intent, 'system.date');
  });

  it('should route event questions to background web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('when apple wwdc event', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'when apple wwdc event');
    assert.equal(result.entities.openInBrowser, false);
  });

  it('should keep brand names inside event question search queries', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('when google io event', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'when google io event');
    assert.equal(result.entities.openInBrowser, false);
  });

  it('should route local desktop file questions to file listing', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('what files are on desktop', 'chat');

    assert.equal(result.intent, 'file.list');
    assert.equal(result.entities.path, 'desktop');
  });

  it('should mark search queries for browser opening only when explicit', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('search for apple wwdc in chrome', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'apple wwdc');
    assert.equal(result.entities.openInBrowser, true);
  });

  it('should route whatsapp message commands to message.send', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('say hi to daddy on whatsapp', 'chat');
    assert.equal(result.intent, 'message.send');
    assert.equal(result.entities.contactName, 'daddy');
    assert.equal(result.entities.messageText, 'hi');
    assert.equal(result.entities.platform, 'whatsapp');
  });

  it('should route call commands to call.start', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('call bunty', 'chat');
    assert.equal(result.intent, 'call.start');
    assert.equal(result.entities.contactName, 'bunty');
  });

  it('should route ask-style contact requests to message.send', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('ask daddy to call me', 'chat');
    assert.equal(result.intent, 'message.send');
    assert.equal(result.entities.contactName, 'daddy');
    assert.equal(result.entities.messageText, 'call me');
  });

  it('should route common message verb typos to message.send', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('massage daddy to call me', 'chat');
    assert.equal(result.intent, 'message.send');
    assert.equal(result.entities.contactName, 'daddy');
    assert.equal(result.entities.messageText, 'call me');
  });

  it('should route polite web searches to browser.search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('could you please search for the latest java tutorial', 'chat');
    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'the latest java tutorial');
  });

  it('should tolerate simple word misplacement in open commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('chrome open please', 'chat');
    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should route timer commands to timer.set', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('set timer for 5 min', 'chat');
    assert.equal(result.intent, 'timer.set');
    assert.equal(result.entities.duration, 5);
  });

  it('should route reminder commands to reminder.set', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('remind at 1 pm to eat lunch', 'chat');
    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.timeExpression, '1 pm');
    assert.equal(result.entities.reminderText, 'eat lunch');
  });

  it('should route play next song to media.next', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('play next song', 'chat');
    assert.equal(result.intent, 'media.next');
  });

  it('should correct typo and route play nexr sony to media.next', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('play nexr sony', 'chat');
    assert.equal(result.intent, 'media.next');
  });

  it('should route pause command to media.pause', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('pause music', 'chat');
    assert.equal(result.intent, 'media.pause');
  });

  it('should route resume command to media.resume', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('resume', 'chat');
    assert.equal(result.intent, 'media.resume');
  });

  it('should route continue and unpause to media.resume', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const continueResult = await router.process('continue', 'chat');
    assert.equal(continueResult.intent, 'media.resume');

    const unpauseResult = await router.process('unpause', 'chat');
    assert.equal(unpauseResult.intent, 'media.resume');
  });

  it('should route natural playback requests to media.play', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('put on the playdate song on youtube', 'chat');
    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'playdate');
    assert.equal(result.entities.mediaPlatform, 'youtube');
  });

  it('should route STT-corrupted artist playback through media understanding', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('play dulander songs', 'voice');

    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'Daler Mehndi songs');
    assert.equal(result.entities.mediaPlatform, 'youtube');
    assert.equal(result.entities.artist, 'Daler Mehndi');
  });

  it('should route open youtube and play genre requests through media understanding', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open youtube and play punjabi songs', 'voice');

    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'punjabi songs');
    assert.equal(result.entities.mediaPlatform, 'youtube');
    assert.equal(result.entities.genre, 'punjabi');
  });

  it('should route media stop and search intents', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const stopResult = await router.process('stop music', 'chat');
    assert.equal(stopResult.intent, 'media.stop');

    const searchResult = await router.process('search music arijit', 'chat');
    assert.equal(searchResult.intent, 'media.search');
    assert.equal(searchResult.entities.mediaPlatform, 'youtube');
  });

  it('should route window commands with word misplacement to window.maximize', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('youtube maximize please', 'chat');
    assert.equal(result.intent, 'window.maximize');
    assert.equal(result.entities.windowName, 'youtube');
  });

  it('should return error for unknown commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('asdfghjkl qwerty', 'chat');
    assert.equal(result.success, false);
  });

  it('should handle empty input gracefully', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const engine = new AutomationEngine(config);
    const router = new ActionRouter(config, engine);
    const result = await router.process('', 'chat');
    assert.equal(result.success, false);
  });
});
