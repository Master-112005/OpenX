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

  it('should keep compound close commands on app.close before media resume', async function() {
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
    const result = await router.process('close chrome and continue the video on youtube', 'chat', { allowMulti: false });

    assert.equal(result.intent, 'app.close');
    assert.equal(result.entities.appName, 'chrome');
  });

  it('should execute independent multi-command requests in sequence', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('stop music and open chrome', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['media.stop', 'app.open']);
    assert.equal(executed[1].entities.appName, 'chrome');
  });

  it('should split window and volume commands without swallowing the second command', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('minimize the youtube and set vol to 50', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['window.minimize', 'volume.set']);
    assert.equal(executed[0].entities.windowName, 'youtube');
    assert.equal(executed[1].entities.value, 50);
  });

  it('should execute three or four app commands and carry the verb to bare follow-up apps', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('clouse chrome and open whatsapp and clock', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['app.close', 'app.open', 'app.open']);
    assert.deepEqual(executed.map(step => step.entities.appName), ['chrome', 'whatsapp', 'clock']);
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

  it('should route misspelled screenshot commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { filePath: 'C:\\Users\\user\\Pictures\\Screenshots\\JARVIS-test.png' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('take a screenshort', 'chat');

    assert.equal(result.intent, 'system.screenshot');
    assert.deepEqual(executed.map(step => step.actionId), ['system.screenshot']);
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

  it('should route spoken extension file open commands to file.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open farmcat pdf', 'chat');
    assert.equal(result.intent, 'file.open');
    assert.equal(result.entities.filename, 'farmcat.pdf');
  });

  it('should keep absolute paths and local media files on file.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const image = await router.process('open C:\\Users\\rakes\\Pictures\\Screenshots\\JARVIS-test.png', 'chat');
    const video = await router.process('play The_Gray_Man.mkv on vlc', 'chat');

    assert.equal(image.intent, 'file.open');
    assert.equal(image.entities.filename, 'C:\\Users\\rakes\\Pictures\\Screenshots\\JARVIS-test.png');
    assert.equal(video.intent, 'file.open');
    assert.equal(video.entities.filename, 'The_Gray_Man.mkv');
    assert.equal(video.entities.path, null);
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

  it('should route saved mode commands before generic app opening', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, opened: ['chrome'] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('start gaming mode', 'chat');

    assert.equal(result.intent, 'mode.start');
    assert.equal(result.entities.modeName, 'gaming');
  });

  it('should execute configured commands after starting a saved mode', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        if (actionId === 'mode.start') {
          return {
            success: true,
            data: {
              modeName: entities.modeName,
              opened: ['youtube'],
              failed: [],
              commands: ['play liked songs', 'set volume to 45']
            }
          };
        }
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('start media mode', 'chat');

    assert.equal(result.intent, 'mode.start');
    assert.deepEqual(executed.map(step => step.actionId), ['mode.start', 'media.play', 'volume.set']);
    assert.equal(executed[1].entities.mediaQuery, 'liked songs');
    assert.equal(result.data.commandSteps.length, 2);
  });

  it('should execute app-specific mode instructions after starting a saved mode', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        if (actionId === 'mode.start') {
          return {
            success: true,
            data: {
              modeName: entities.modeName,
              opened: ['youtube', 'chrome'],
              failed: [],
              commands: ['set volume to 100', 'play liked songs', 'search for chatgpt in chrome', 'open first result for chatgpt']
            }
          };
        }
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('start development mode', 'chat');

    assert.equal(result.intent, 'mode.start');
    assert.deepEqual(executed.map(step => step.actionId), ['mode.start', 'volume.set', 'media.play', 'browser.search', 'browser.openFirstResult']);
    assert.equal(executed[3].entities.query, 'chatgpt');
    assert.equal(executed[3].entities.openInBrowser, true);
    assert.equal(executed[4].entities.query, 'chatgpt');
    assert.equal(result.data.commandSteps.length, 4);
  });

  it('should execute search then first-result browser follow-up commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, title: 'ChatGPT', url: 'https://chatgpt.com/' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('search for chatgpt in chrome and click the first link', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.search', 'browser.openFirstResult']);
    assert.equal(executed[0].entities.query, 'chatgpt');
    assert.equal(executed[0].entities.openInBrowser, true);
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

  it('should apply learned browser search preferences before execution', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } },
      learningStore: {
        adaptEntities(intentId, entities) {
          if (intentId === 'browser.search') {
            return { ...entities, openInBrowser: true };
          }
          return entities;
        }
      }
    };
    let executed = null;
    const stubEngine = {
      execute(actionId, entities) {
        executed = { actionId, entities };
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('search for chatgpt', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(executed.entities.openInBrowser, true);
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

  it('should route arithmetic questions to local calculation', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, result: 600 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('what is 20*30', 'chat');

    assert.equal(result.intent, 'system.calculate');
    assert.equal(result.entities.expression, '20*30');
    assert.ok(result.response.includes('600'));
  });

  it('should extract arithmetic from typo-heavy question text', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, result: 9630 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('ehat is teh value of 999+959*9', 'chat');

    assert.equal(result.intent, 'system.calculate');
    assert.equal(result.entities.expression, '999+959*9');
    assert.ok(result.response.includes('9630'));
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

  it('should route local file-type questions to filtered file listing', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId, entries: [], count: 0 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('what are the pdfs on the desktop', 'chat');

    assert.equal(result.intent, 'file.list');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(result.entities.fileType, 'pdf');
  });

  it('should route corrected knowledge questions to background web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const whichWinner = await router.process('which team is the winner of ipl 2020', 'chat');
    const compactWinner = await router.process('who is the winner of ipl2020', 'chat');
    const captain = await router.process('who is the capatin of indian cricket team in 2026', 'chat');
    const capital = await router.process('what is the capitol of india', 'chat');
    const suv = await router.process('what is the cost of a suv in india', 'chat');

    assert.equal(whichWinner.intent, 'browser.search');
    assert.equal(whichWinner.entities.query, 'which team is the winner of ipl 2020');
    assert.equal(compactWinner.intent, 'browser.search');
    assert.equal(compactWinner.entities.query, 'who is the winner of ipl 2020');
    assert.equal(captain.intent, 'browser.search');
    assert.equal(captain.entities.query, 'who is the captain of indian cricket team in 2026');
    assert.equal(capital.entities.query, 'what is the capital of india');
    assert.equal(suv.entities.query, 'what is the cost of a suv in india');
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

  it('should preserve technical terms in explicit search queries', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const background = await router.process('search for node js', 'chat');
    const chrome = await router.process('search for node js in chrome', 'chat');

    assert.equal(background.intent, 'browser.search');
    assert.equal(background.entities.query, 'node js');
    assert.equal(background.entities.openInBrowser, false);
    assert.equal(chrome.intent, 'browser.search');
    assert.equal(chrome.entities.query, 'node js');
    assert.equal(chrome.entities.openInBrowser, true);
  });

  it('should route browser tab close commands before generic app close', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('close empty tab in chrome', 'chat');

    assert.equal(result.intent, 'browser.closeTab');
    assert.equal(result.entities.browserName, 'chrome');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.closeTab']);
  });

  it('should route open target in chrome to first browser result instead of app.open', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('open chatgpt in chrome', 'chat');

    assert.equal(result.intent, 'browser.openFirstResult');
    assert.equal(result.entities.query, 'chatgpt');
  });

  it('should route known web app opens to the first browser result', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, title: 'ChatGPT', url: 'https://chatgpt.com/' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('open chatgpt', 'chat');

    assert.equal(result.intent, 'browser.openFirstResult');
    assert.equal(result.entities.query, 'chatgpt');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.openFirstResult']);
  });

  it('should route typo search commands to browser.search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('serch chatgpt in chrome', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'chatgpt');
    assert.equal(result.entities.openInBrowser, true);
  });

  it('should route first-result follow-up commands before generic app opening', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('open first result for chatgpt', 'chat');

    assert.equal(result.intent, 'browser.openFirstResult');
    assert.equal(result.entities.query, 'chatgpt');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.openFirstResult']);
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

  it('should route reminder commands that still need a time detail', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: false, error: 'Invalid reminder time', data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('remind me to happy birthday to my brother', 'chat');

    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.reminderText, 'happy birthday to my brother');
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

    const typoStopResult = await router.process('stop musc', 'chat');
    assert.equal(typoStopResult.intent, 'media.stop');

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

  it('should route local system questions without web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, count: 12, cpu: 10, ram: 50 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const running = await router.process('what apps are running', 'chat');
    const processes = await router.process('what processes are running', 'chat');
    const chromeStatus = await router.process('check what apps are running and if chrome is opened tell me chrome is opened', 'chat');
    const cpu = await router.process('what is the cpu usage', 'chat');
    const ram = await router.process('what is the ram usage', 'chat');
    const battery = await router.process('how much battery is left', 'chat');
    const storage = await router.process('how much storage space is available', 'chat');
    const followUpMemory = await router.process('what about memory', 'chat');
    const laptop = await router.process('tell about this laptop', 'chat');
    const pcHealth = await router.process('how is my pc doing', 'chat');

    assert.equal(running.intent, 'system.processes');
    assert.equal(running.entities.target, 'apps');
    assert.equal(processes.intent, 'system.processes');
    assert.equal(processes.entities.target, 'processes');
    assert.equal(chromeStatus.intent, 'system.processes');
    assert.equal(chromeStatus.entities.target, 'apps');
    assert.equal(chromeStatus.entities.queryApp, 'chrome');
    assert.equal(cpu.intent, 'system.cpu');
    assert.equal(ram.intent, 'system.memory');
    assert.equal(battery.intent, 'system.battery');
    assert.equal(storage.intent, 'system.disk');
    assert.equal(followUpMemory.intent, 'system.memory');
    assert.equal(laptop.intent, 'system.status');
    assert.equal(pcHealth.intent, 'system.status');
  });

  it('should route system settings commands with typo tolerant bluetooth wording', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const off = await router.process('turn of blue tooth', 'chat');
    const offTrailing = await router.process('turn bluetooth off', 'chat');
    const on = await router.process('enable blutooth', 'chat');
    const onTrailing = await router.process('turn bluetooth on', 'chat');
    const status = await router.process('is bluetooth enabled', 'chat');

    assert.equal(off.intent, 'system.bluetooth');
    assert.equal(off.entities.enabled, false);
    assert.equal(offTrailing.intent, 'system.bluetooth');
    assert.equal(offTrailing.entities.enabled, false);
    assert.equal(on.intent, 'system.bluetooth');
    assert.equal(on.entities.enabled, true);
    assert.equal(onTrailing.intent, 'system.bluetooth');
    assert.equal(onTrailing.entities.enabled, true);
    assert.equal(status.intent, 'system.bluetooth');
    assert.deepEqual(status.entities, {});
  });

  it('should answer assistant identity locally', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId, name: 'JARVIS' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('what is your name', 'chat');

    assert.equal(result.intent, 'assistant.identity');
    assert.match(result.response, /JARVIS/);
  });

  it('should answer assistant conversation and capability questions locally', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const status = await router.process('how are you', 'chat');
    const work = await router.process('what is your work', 'chat');
    const help = await router.process('how do you help me', 'chat');

    assert.equal(status.intent, 'greeting');
    assert.equal(work.intent, 'help');
    assert.equal(help.intent, 'help');
  });

  it('should route personal photo requests through personal context instead of blind web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const local = await router.process('can you find me a pic me with my classmates', 'chat');
    const google = await router.process('find a pic with my classmates in google photos', 'chat');
    const photosApp = await router.process('find my family pictures in the photos app', 'chat');

    assert.equal(local.intent, 'file.search');
    assert.equal(local.entities.query, 'classmates me');
    assert.equal(local.entities.personalSearchType, 'photo');
    assert.equal(google.intent, 'browser.openFirstResult');
    assert.equal(google.entities.query, 'google photos');
    assert.equal(photosApp.intent, 'app.open');
    assert.equal(photosApp.entities.appName, 'photos');
  });

  it('should apply learned personal photo library preference during routing', async function() {
    const ActiveLearningStore = require('../../core/assistant/learning/index');
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const learningStore = new ActiveLearningStore({
      activeLearning: { enabled: true },
      app: { dataDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'jarvis-router-learning-')) }
    });
    learningStore.rememberPreference('photoLibrary', 'googlePhotos');
    const router = new ActionRouter({ ...config, learningStore }, {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    });
    const result = await router.process('find my classmates photo', 'chat');

    assert.equal(result.intent, 'browser.openFirstResult');
    assert.equal(result.entities.query, 'google photos');
  });

  it('should keep reminder requests ahead of media routing', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('remind me tommorow to watch wwdc2026 at 10 pm', 'chat');

    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.reminderText, 'watch wwdc2026');
    assert.equal(result.entities.timeExpression, 'tomorrow 10pm');
  });

  it('should route human reminder date phrases with scheduler-friendly time expressions', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('remind me on next sunday to watch the sunshine movie', 'chat');

    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.timeExpression, 'next sunday');
    assert.equal(result.entities.reminderText, 'watch the sunshine movie');
  });

  it('should not accept bare remind me as a valid reminder', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute() {
        throw new Error('should not execute');
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('remind me', 'chat');

    assert.equal(result.success, false);
  });

  it('should route new tab and new-tab searches without polluting the query', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const tab = await router.process('open a new tab in chrome', 'chat');
    const search = await router.process('search for latest cricket news in new tab in chrome', 'chat');

    assert.equal(tab.intent, 'browser.open');
    assert.equal(tab.entities.url, 'about:blank');
    assert.equal(search.intent, 'browser.search');
    assert.equal(search.entities.query, 'latest cricket news');
    assert.equal(search.entities.openInBrowser, true);
  });

  it('should not carry open into ask-style follow-up clauses', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open copilot and ask what is the weather', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['app.open', 'browser.search']);
    assert.equal(executed[1].entities.query, 'what is the weather');
  });

  it('should route hotspot and bluetooth phrases to Windows settings pages', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const hotspot = await router.process('turn on mobile hotspot', 'chat');
    const bluetooth = await router.process('bluetooth is on', 'chat');
    const bluetoothOff = await router.process('turn off the bluetooth', 'chat');
    const bluetoothQuestion = await router.process('what about the bluetooth', 'chat');

    assert.equal(hotspot.intent, 'app.open');
    assert.equal(hotspot.entities.appName, 'ms-settings:network-mobilehotspot');
    assert.equal(bluetooth.intent, 'system.bluetooth');
    assert.deepEqual(bluetooth.entities, {});
    assert.equal(bluetoothOff.intent, 'system.bluetooth');
    assert.equal(bluetoothOff.entities.enabled, false);
    assert.equal(bluetoothQuestion.intent, 'system.bluetooth');
  });

  it('should route file creation and location commands locally', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, results: [] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const create = await router.process('create a report pdf file on desktop', 'chat');
    const location = await router.process('what is the location of report.md', 'chat');
    const locate = await router.process('locate the report.pdf', 'chat');
    const implicitLocate = await router.process('locate the dlnlp labmanual', 'chat');

    assert.equal(create.intent, 'file.create');
    assert.equal(create.entities.filename, 'report.pdf');
    assert.equal(create.entities.path, 'desktop');
    assert.equal(location.intent, 'file.search');
    assert.equal(location.entities.query, 'report.md');
    assert.equal(locate.intent, 'file.search');
    assert.equal(locate.entities.query, 'report.pdf');
    assert.equal(implicitLocate.intent, 'file.search');
    assert.equal(implicitLocate.entities.query, 'dlnlp labmanual');
  });

  it('should not treat file names containing resume as media resume', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const typoQuestion = await router.process('whare i the Resume.docx file', 'chat');
    const move = await router.process('bring The_Gray_Man.mkv to downlodes', 'chat');

    assert.equal(typoQuestion.intent, 'file.search');
    assert.equal(typoQuestion.entities.query, 'resume.docx');
    assert.equal(move.intent, 'file.move');
    assert.equal(move.entities.source, 'The_Gray_Man.mkv');
    assert.equal(move.entities.destination, 'downloads');
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
