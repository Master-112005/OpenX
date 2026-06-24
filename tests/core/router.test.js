const assert = require('assert');

describe('Action Router', function() {
  this.timeout(10000);
  let ActionRouter, AutomationEngine;

  before(function() {
    ActionRouter = require('../../core/assistant/router');
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

  it('should route natural condition commands to executable controllers', async function() {
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
        return { success: true, data: { value: entities?.value || 50, actionId, ...(entities || {}) } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const cases = [
      ['The screen is hurting my eyes', 'brightness.down', 'brightness.down', { value: 35 }],
      ['I can\'t hear anything from the speakers', 'volume.up', 'volume.up'],
      ['It\'s way too loud in here', 'volume.down', 'volume.down'],
      ['Can you make the screen a little brighter?', 'brightness.up', 'brightness.up'],
      ['Everything looks too small to read', 'app.open', 'app.open', { appName: 'ms-settings:easeofaccess-display' }],
      ['Will my laptop survive another couple of hours?', 'system.battery', 'system.battery'],
      ['Get my coding environment ready', 'mode.start', 'mode.start', { modeName: 'development' }],
      ['I\'m in the mood to write something', 'app.open', 'app.open', { appName: 'notepad' }],
      ['I want to calculate some numbers', 'app.open', 'app.open', { appName: 'calculator' }],
      ['I need directions to a nearby restaurant', 'browser.search', 'browser.search'],
      ['Can you help me recover what I just deleted?', 'app.open', 'app.open', { appName: 'shell:RecycleBinFolder' }],
      ['Explain Docker in simple words.', 'browser.search', 'browser.search'],
      ['Find common DevOps interview questions.', 'browser.search', 'browser.search'],
      ['I think my internet is acting up.', 'browser.search', 'browser.search'],
      ['Can you see if I\'m connected to WiFi?', 'app.open', 'app.open', { appName: 'ms-settings:network-wifi' }],
      ['I feel like listening to podcasts.', 'media.play', 'media.play'],
      ['Show me my pending tasks.', 'browser.search', 'browser.search']
    ];

    for (const [command, expectedIntent, expectedAction, expectedEntities] of cases) {
      executed.length = 0;
      const result = await router.process(command, 'chat');

      assert.equal(result.success, true, command);
      assert.equal(result.intent, expectedIntent, command);
      assert.notEqual(result.intent, 'assistant.capability', command);
      assert.equal(executed[0]?.actionId, expectedAction, command);
      for (const [key, value] of Object.entries(expectedEntities || {})) {
        assert.equal(executed[0].entities[key], value, command);
      }
    }
  });

  it('should not let technical knowledge topics fuzzy-match window actions', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...(entities || {}) } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('Explain Docker in simple words.', 'chat');
    const prepared = router.nlp.prepare('Explain Docker in simple words.');

    assert.equal(result.intent, 'browser.search');
    assert.equal(executed[0].actionId, 'browser.search');
    assert.notEqual(result.intent, 'window.minimize');
    assert.notEqual(prepared.semanticFrame.actionVerb, 'minimize');
  });

  it('should not claim generic capability fallback commands were executed', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return {
          success: true,
          data: {
            action: 'capability.recognized',
            capability: entities.capability,
            operation: entities.operation,
            target: entities.target,
            rawCommand: entities.rawCommand
          }
        };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('Save my work before exiting', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'assistant.capability');
    assert.match(result.response, /not connected to an automation controller yet/i);
    assert.doesNotMatch(result.response, /completed/i);
  });

  it('should route fill this from typo as a form fill request', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } },
      learningStore: {
        getAllUserFacts() {
          return { name: 'Rakesh', email: 'rakesh@example.com', phone: '+919876543210' };
        }
      }
    };
    const engine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, engine);
    const result = await router.process('fill this from', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'form.fill');
    assert.equal(result.entities.action, 'fill');
    assert.equal(result.entities.userFacts.email, 'rakesh@example.com');
  });

  it('should pass Google Form URLs into form fill requests', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } },
      learningStore: {
        getAllUserFacts() {
          return { name: 'Rakesh' };
        }
      }
    };
    const engine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, engine);
    const result = await router.process('fill this form https://forms.gle/mKKt1eaLgRQjYpA49', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'form.fill');
    assert.equal(result.entities.url, 'https://forms.gle/mKKt1eaLgRQjYpA49');
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

  it('should route generic video stop controls to media.stop before app.close', async function() {
    const config = {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false }
        }
      }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('stop the video', 'chat');

    assert.equal(result.intent, 'media.stop');
    assert.equal(result.languageUnderstanding.commandFrame.action, 'stop');
    assert.equal(result.languageUnderstanding.commandFrame.domain, 'media');
  });

  it('should execute media stop and volume set in one natural multi-command', async function() {
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
    const result = await router.process('stop the video and set vol to 100', 'chat');

    assert.equal(result.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['media.stop', 'volume.set']);
    assert.equal(executed[1].entities.value, 100);
  });

  it('should split window and volume commands without swallowing the second command', async function() {
    this.timeout(20000);
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

  it('should route folders opened in VS Code as folder.open with editor context', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open java practice folder in vs code', 'chat');

    assert.equal(result.intent, 'folder.open');
    assert.equal(result.entities.folderName, 'java practice');
    assert.equal(result.entities.openWith, 'code');
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

  it('should route bare public knowledge list requests to web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('fifa world cup match list', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'fifa world cup match list');
  });

  it('should route live sports score requests to background web search before app matching', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process("show me today's IPL score", 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, "show me today's ipl score");
    assert.equal(result.entities.openInBrowser, false);
  });

  it('should keep developer file-system example searches on web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('search for node js file system examples', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'node js file system examples');
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

  it('should route external release-date questions to web search, not system.date', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('what is the dune 3 release date', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.entities.query, 'what is the dune 3 release date');
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

  it('should preserve public web entity names in corrected search queries', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const tomCruise = await router.process('what is the tomcures best movies', 'chat');
    const iphone = await router.process('what is the iphone 18 price', 'chat');

    assert.equal(tomCruise.intent, 'browser.search');
    assert.equal(tomCruise.entities.query, 'what is the tom cruise best movies');
    assert.equal(iphone.intent, 'browser.search');
    assert.equal(iphone.entities.query, 'what is the iphone 18 price');
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

  it('should route targeted browser tab close commands with typo repair', async function() {
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

    const photos = await router.process('close the photes tabs in chromem', 'chat');
    const googlePhotos = await router.process('close the google photes tabs in chrome', 'chat');

    assert.equal(photos.intent, 'browser.closeTab');
    assert.equal(photos.entities.browserName, 'chrome');
    assert.equal(photos.entities.tabQuery, 'google photos');
    assert.equal(googlePhotos.intent, 'browser.closeTab');
    assert.equal(googlePhotos.entities.browserName, 'chrome');
    assert.equal(googlePhotos.entities.tabQuery, 'google photos');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.closeTab', 'browser.closeTab']);
  });

  it('should route browser tab listing commands before process status', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, count: 1, tabs: [{ title: 'ChatGPT' }] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const typo = await router.process('what taqbs are open in chromme', 'chat');
    const clean = await router.process('what tabs are open in chrome', 'chat');

    assert.equal(typo.intent, 'browser.listTabs');
    assert.equal(typo.entities.browserName, 'chrome');
    assert.equal(clean.intent, 'browser.listTabs');
    assert.equal(clean.entities.browserName, 'chrome');
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

  it('should route trusted Google web product opens without treating them as desktop apps', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const photos = await router.process('open google phots', 'chat');
    const colab = await router.process('open collab', 'chat');
    const googleColab = await router.process('open google collab', 'chat');

    assert.equal(photos.intent, 'browser.openFirstResult');
    assert.equal(photos.entities.query, 'google photos');
    assert.equal(colab.intent, 'browser.openFirstResult');
    assert.equal(colab.entities.query, 'google colab');
    assert.equal(googleColab.intent, 'browser.openFirstResult');
    assert.equal(googleColab.entities.query, 'google colab');
  });

  it('should route natural web-app open phrasing through trusted web targets', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const photos = await router.process('please pull up google photes website', 'chat');
    const maps = await router.process('show me google maps site', 'chat');

    assert.equal(photos.intent, 'browser.openFirstResult');
    assert.equal(photos.entities.query, 'google photos');
    assert.equal(maps.intent, 'browser.openFirstResult');
    assert.equal(maps.entities.query, 'google maps');
  });

  it('should route local photos requests to the Windows Photos app when the user says laptop', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('open photes on laptop', 'chat');
    const thisLaptop = await router.process('open photos on this laptop', 'chat');

    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'photos');
    assert.equal(thisLaptop.intent, 'app.open');
    assert.equal(thisLaptop.entities.appName, 'photos');
  });

  it('should route spaced unmute and noisy set-volume phrases correctly', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, value: entities?.value ?? 50 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const unmute = await router.process('un mute', 'chat');
    const volume = await router.process('ste it tom 100', 'chat');

    assert.equal(unmute.intent, 'volume.unmute');
    assert.equal(volume.intent, 'volume.set');
    assert.equal(volume.entities.value, 100);
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

  it('should route email compose commands with contact subject and body', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, email: 'rakesh@example.com' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const minimal = await router.process('mail rakesh', 'chat');
    const full = await router.process('send email to rakesh about meeting saying I will join at 5', 'chat');

    assert.equal(minimal.intent, 'email.compose');
    assert.equal(minimal.entities.contactName, 'rakesh');
    assert.equal(full.intent, 'email.compose');
    assert.equal(full.entities.contactName, 'rakesh');
    assert.equal(full.entities.subject, 'meeting');
    assert.equal(full.entities.body, 'I will join at 5');
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

  it('should route add-time language and word durations to timers', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const router = new ActionRouter(config, {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { dueAt: new Date().toISOString(), kind: 'Timer' } };
      }
    });

    const result = await router.process('add time for one minit', 'chat');

    assert.equal(result.intent, 'timer.set');
    assert.equal(result.entities.duration, 1);
    assert.equal(executed[0].actionId, 'timer.set');
  });

  it('should classify common reminder subjects for presentation', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const router = new ActionRouter(config, {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, dueAt: new Date().toISOString(), kind: 'Reminder' } };
      }
    });

    const college = await router.process('remind me in 10 minutes to go to collage', 'chat');
    const water = await router.process('remind me in 20 minutes to drink water', 'chat');
    const exercise = await router.process('remind me in 30 minutes to exercise', 'chat');

    assert.equal(college.entities.reminderCategory, 'education');
    assert.equal(water.entities.reminderCategory, 'water');
    assert.equal(exercise.entities.reminderCategory, 'exercise');
  });

  it('should treat task-at-clock timer wording as a reminder', async function() {
    const config = { permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } } };
    const router = new ActionRouter(config, {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, dueAt: new Date().toISOString() } };
      }
    });

    const result = await router.process('set timer for go to collage at 4 30 pm', 'chat');

    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.timeExpression, '4:30 pm');
    assert.equal(result.entities.reminderText, 'go to college');
    assert.equal(result.entities.reminderCategory, 'education');
  });

  it('should separate alarm time from its label', async function() {
    const config = { permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } } };
    const router = new ActionRouter(config, {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, dueAt: new Date().toISOString() } };
      }
    });

    const spaced = await router.process('set alarm at 4:54 pm to drink water', 'chat');
    const compact = await router.process('set alarm at 4:54pm to drink water', 'chat');

    assert.equal(spaced.intent, 'alarm.set');
    assert.equal(spaced.entities.timeExpression, '4:54 pm');
    assert.equal(spaced.entities.alarmLabel, 'drink water');
    assert.equal(compact.entities.timeExpression, '4:54pm');
    assert.equal(compact.entities.alarmLabel, 'drink water');
  });

  it('should route timer reminder and alarm management commands', async function() {
    const config = { permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } } };
    const router = new ActionRouter(config, {
      execute(actionId) { return { success: true, data: { actionId, count: 0, entries: [] } }; }
    });
    const commands = new Map([
      ['pause the timer', 'timer.pause'], ['resume the timer', 'timer.resume'],
      ['reset the timer', 'timer.reset'], ['how much time is left', 'timer.remaining'],
      ['show active timers', 'timer.list'], ['cancel all active timers', 'timer.clear'],
      ['show all reminders', 'reminder.list'], ['delete this reminder', 'reminder.cancel'],
      ['delete all reminders', 'reminder.clear'], ['snooze this reminder for 10 minutes', 'reminder.snooze'], ['snooze the alarm', 'alarm.snooze'],
      ['show my alarms', 'alarm.list'], ['delete all alarms', 'alarm.clear']
    ]);
    for (const [command, expectedIntent] of commands) {
      const result = await router.process(command, 'chat');
      assert.equal(result.intent, expectedIntent, command);
    }
  });

  it('should generalize countdown pomodoro session and recurring reminder language', async function() {
    const config = { permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } } };
    const router = new ActionRouter(config, {
      execute(actionId, entities) { return { success: true, data: { actionId, ...entities, dueAt: new Date().toISOString() } }; }
    });

    const countdown = await router.process('set a countdown for thirty minutes', 'chat');
    const pomodoro = await router.process('start a Pomodoro timer', 'chat');
    const study = await router.process('start a one-hour study session', 'chat');
    const recurring = await router.process('remind me every hour to drink water', 'chat');

    assert.equal(countdown.intent, 'timer.set');
    assert.equal(countdown.entities.duration, 30);
    assert.equal(pomodoro.entities.duration, 25);
    assert.equal(study.entities.duration, 60);
    assert.equal(recurring.intent, 'reminder.set');
    assert.equal(recurring.entities.recurrence, 'hourly');
    assert.equal(recurring.entities.reminderCategory, 'water');
  });

  it('should route alarm commands to alarm.set instead of timer.set', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const plain = await router.process('set a alarm at 2:43', 'chat');
    const today = await router.process('set a alarm at 2:43 pm today', 'chat');

    assert.equal(plain.intent, 'alarm.set');
    assert.equal(plain.entities.timeExpression, '2:43');
    assert.equal(today.intent, 'alarm.set');
    assert.equal(today.entities.timeExpression, '2:43 pm today');
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

  it('should route direct remind-me-to requests that include a trailing time', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, dueAt: new Date().toISOString(), kind: 'Reminder' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('remind me to sleep at 12 am', 'chat');
    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.timeExpression, '12 am');
    assert.equal(result.entities.reminderText, 'sleep');
  });

  it('should preserve reminder time when "at" is mistyped as "t"', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: false, error: 'Reminder text is required', data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('set reminder t 2:44 pm today', 'chat');

    assert.equal(result.intent, 'reminder.set');
    assert.equal(result.entities.timeExpression, '2:44 pm today');
    assert.equal(result.entities.reminderText, null);
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
    assert.equal(result.entities.mediaQuery, 'playdate song');
    assert.equal(result.entities.mediaPlatform, 'youtube');
  });

  it('should preserve media playback phrases during noisy repair', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('play shape of you on youtube', 'chat');

    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'shape of you');
    assert.equal(result.entities.mediaPlatform, 'youtube');
  });

  it('should preserve playdate title in natural media playback wording', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('you have to the play date song', 'chat');

    assert.equal(result.intent, 'media.play');
    assert.equal(result.entities.mediaQuery, 'playdate song');
    assert.equal(result.entities.mediaPlatform, 'youtube');
  });

  it('should preserve voice media playback names through media handling', async function() {
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
    assert.equal(result.entities.mediaQuery, 'dulander songs');
    assert.equal(result.entities.mediaPlatform, 'youtube');
    assert.equal(Object.prototype.hasOwnProperty.call(result.entities, 'artist'), false);
  });

  it('should route open youtube and play genre requests through media handling', async function() {
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

  it('should route app usage count questions locally instead of web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, count: 2, apps: [] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const singular = await router.process('how many app are in use', 'chat');
    const plural = await router.process('how many apps are in use', 'chat');

    assert.equal(singular.intent, 'system.processes');
    assert.equal(singular.entities.target, 'apps');
    assert.equal(plural.intent, 'system.processes');
    assert.equal(plural.entities.target, 'apps');
    assert.deepEqual(executed.map(step => step.actionId), ['system.processes', 'system.processes']);
  });

  it('should extract clean app names from natural open-status questions', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, isOpen: true } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('is chrome is open', 'chat');

    assert.equal(result.intent, 'system.processes');
    assert.equal(result.entities.target, 'apps');
    assert.equal(result.entities.queryApp, 'chrome');
  });

  it('should route personal-context file discovery commands to smart local file search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, count: 1, entries: [{ name: 'resume.pdf' }] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const newestPdf = await router.process('find the newest PDF in my downloads', 'chat');
    const largest = await router.process('open the largest file in downloads', 'chat');
    const stale = await router.process("show me files I haven't opened in 6 months", 'chat');
    const screenshots = await router.process("show me today's screenshots", 'chat');
    const resume = await router.process('where did I save my resume', 'chat');
    const interview = await router.process('show files related to interviews', 'chat');
    const duplicates = await router.process('find duplicate photos', 'chat');
    const recentDoc = await router.process('find the document I worked on this morning', 'chat');

    assert.equal(newestPdf.intent, 'file.smartFind');
    assert.equal(newestPdf.entities.location, 'downloads');
    assert.equal(newestPdf.entities.fileType, 'pdf');
    assert.equal(newestPdf.entities.sortBy, 'modifiedDesc');
    assert.equal(largest.intent, 'file.smartFind');
    assert.equal(largest.entities.location, 'downloads');
    assert.equal(largest.entities.sortBy, 'sizeDesc');
    assert.equal(largest.entities.openResult, true);
    assert.equal(stale.intent, 'file.smartFind');
    assert.equal(stale.entities.timeFilter, 'olderThan6MonthsAccess');
    assert.equal(screenshots.intent, 'file.smartFind');
    assert.equal(screenshots.entities.query, 'screenshot');
    assert.equal(screenshots.entities.timeFilter, 'today');
    assert.equal(resume.intent, 'file.smartFind');
    assert.equal(resume.entities.query, 'resume');
    assert.equal(interview.intent, 'file.smartFind');
    assert.equal(interview.entities.query, 'interview');
    assert.equal(duplicates.intent, 'file.smartFind');
    assert.equal(duplicates.entities.groupDuplicates, true);
    assert.equal(duplicates.entities.fileType, 'image');
    assert.equal(recentDoc.intent, 'file.smartFind');
    assert.equal(recentDoc.entities.fileType, 'document');
    assert.equal(recentDoc.entities.timeFilter, 'thisMorning');
    assert.ok(executed.every(step => step.actionId === 'file.smartFind'));
  });

  it('should route system insight questions to local system evidence', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, top: { name: 'chrome', memoryMB: 100 } } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const memory = await router.process('which app is using the most memory', 'chat');
    const cpu = await router.process('which process is consuming the most CPU', 'chat');
    const slow = await router.process('what is slowing down my computer', 'chat');
    const fan = await router.process('why is my laptop fan running so fast', 'chat');
    const space = await router.process("show me what's taking up space", 'chat');
    const installs = await router.process('show recently installed applications', 'chat');

    assert.equal(memory.intent, 'system.insight');
    assert.equal(memory.entities.insightType, 'topMemoryApp');
    assert.equal(cpu.intent, 'system.insight');
    assert.equal(cpu.entities.insightType, 'topCpuProcess');
    assert.equal(slow.intent, 'system.insight');
    assert.equal(slow.entities.insightType, 'systemSlowdown');
    assert.equal(fan.intent, 'system.insight');
    assert.equal(fan.entities.insightType, 'systemSlowdown');
    assert.equal(space.intent, 'system.insight');
    assert.equal(space.entities.insightType, 'storageUsage');
    assert.equal(installs.intent, 'system.insight');
    assert.equal(installs.entities.insightType, 'recentlyInstalledApps');
    assert.ok(executed.every(step => step.actionId === 'system.insight'));
  });

  it('should route workspace setup phrases through saved modes or coding app intent', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const codingApp = await router.process('open the app I use most for coding', 'chat');
    const codingMode = await router.process('open everything I need for coding', 'chat');
    const work = await router.process('open my work setup', 'chat');
    const study = await router.process('start my study session', 'chat');
    const focus = await router.process('focus mode', 'chat');
    const comms = await router.process('open my communication apps', 'chat');

    assert.equal(codingApp.intent, 'app.open');
    assert.equal(codingApp.entities.appName, 'code');
    assert.equal(codingMode.intent, 'mode.start');
    assert.equal(codingMode.entities.modeName, 'development');
    assert.equal(work.intent, 'mode.start');
    assert.equal(work.entities.modeName, 'work');
    assert.equal(study.intent, 'mode.start');
    assert.equal(study.entities.modeName, 'study');
    assert.equal(focus.intent, 'mode.start');
    assert.equal(focus.entities.modeName, 'focus');
    assert.equal(comms.intent, 'mode.start');
    assert.equal(comms.entities.modeName, 'communication');
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

  it('should route semantic-frame command phrasing into executable intents', async function() {
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

    const maximize = await router.process('make chrome bigger', 'chat');
    const minimize = await router.process('hide youtube window', 'chat');
    const volume = await router.process('put volume at 35', 'chat');
    const brightness = await router.process('keep brightness at 60', 'chat');
    const localSearch = await router.process('look inside downloads for pdfs', 'chat');
    const minimizeAll = await router.process('Minimize all windows', 'chat');
    const collapseFolders = await router.process('Collapse all folders', 'chat');

    assert.equal(maximize.intent, 'window.maximize');
    assert.equal(maximize.entities.windowName, 'chrome');
    assert.equal(minimize.intent, 'window.minimize');
    assert.equal(minimize.entities.windowName, 'youtube');
    assert.equal(minimizeAll.intent, 'window.minimize');
    assert.equal(minimizeAll.entities.windowName, 'all windows');
    assert.equal(minimizeAll.entities.allWindows, true);
    assert.equal(collapseFolders.intent, 'window.minimize');
    assert.equal(collapseFolders.entities.windowName, 'all windows');
    assert.equal(collapseFolders.entities.allWindows, true);
    assert.equal(volume.intent, 'volume.set');
    assert.equal(volume.entities.value, 35);
    assert.equal(brightness.intent, 'brightness.set');
    assert.equal(brightness.entities.value, 60);
    assert.equal(localSearch.intent, 'file.search');
    assert.equal(localSearch.entities.query, 'pdf');
    assert.deepEqual(executed.map(step => step.actionId), [
      'window.maximize',
      'window.minimize',
      'volume.set',
      'brightness.set',
      'file.search',
      'window.minimize',
      'window.minimize'
    ]);
  });

  it('should route Indian English natural command phrasing through canonical intents', async function() {
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

    const app = await router.process('do one thing open chrome only', 'chat');
    const search = await router.process('tell about indian cricket team', 'chat');
    const wifi = await router.process('put net off', 'chat');
    const message = await router.process('send on whatsapp to Rahul hello bro', 'chat');

    assert.equal(app.intent, 'app.open');
    assert.equal(app.entities.appName, 'chrome');
    assert.equal(search.intent, 'browser.search');
    assert.equal(search.entities.query, 'indian cricket team');
    assert.equal(wifi.intent, 'app.open');
    assert.equal(wifi.entities.appName, 'ms-settings:network-wifi');
    assert.equal(message.intent, 'message.send');
    assert.equal(message.entities.contactName, 'Rahul');
    assert.equal(message.entities.messageText, 'hello bro');
    assert.equal(message.entities.platform, 'whatsapp');
    assert.deepEqual(executed.map(step => step.actionId), [
      'app.open',
      'browser.search',
      'app.open',
      'message.compose'
    ]);
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

  it('should answer personal and assistant-name questions locally without web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId) {
        return { success: true, data: { actionId, name: actionId === 'assistant.identity' ? 'JARVIS' : '' } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const personal = await router.process('what is my name', 'chat');
    const assistantTypo = await router.process('what is your anme', 'chat');

    assert.equal(personal.intent, 'assistant.userName');
    assert.match(personal.response, /do not know your name/i);
    assert.equal(assistantTypo.intent, 'assistant.identity');
    assert.match(assistantTypo.response, /JARVIS/);
  });

  it('should reject incomplete commands instead of inventing targets', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('show me', 'chat');
    const open = await router.process('open', 'chat');
    const searchFor = await router.process('search for', 'chat');
    const normal = await router.process('open chrome', 'chat');

    assert.equal(result.success, false);
    assert.equal(result.intent, undefined);
    assert.equal(open.success, false);
    assert.equal(searchFor.success, false);
    assert.equal(normal.intent, 'app.open');
  });

  it('should keep local system and file requests out of web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, cpu: 10, ram: 50 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const system = await router.process('how is my system doing', 'chat');
    const pdfs = await router.process('find all PDFs downloaded this week', 'chat');
    const duplicates = await router.process('find duplicate files', 'chat');
    const browser = await router.process('open my browser', 'chat');
    const screenshot = await router.process('show my latest screenshot', 'chat');

    assert.equal(system.intent, 'system.status');
    assert.equal(pdfs.intent, 'file.search');
    assert.equal(duplicates.intent, 'file.search');
    assert.equal(browser.intent, 'browser.open');
    assert.equal(browser.entities.url, 'about:blank');
    assert.equal(screenshot.intent, 'file.open');
    assert.equal(screenshot.entities.filename, 'screenshot in pictures');
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
    assert.equal(google.intent, 'browser.siteSearch');
    assert.equal(google.entities.site, 'google photos');
    assert.equal(google.entities.query, 'classmates');
    assert.equal(photosApp.intent, 'app.open');
    assert.equal(photosApp.entities.appName, 'photos');
  });

  it('should apply learned personal photo library preference during routing', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
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

    assert.equal(result.intent, 'browser.siteSearch');
    assert.equal(result.entities.site, 'google photos');
    assert.equal(result.entities.query, 'classmates');
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

  it('should route site-specific browser search commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const photos = await router.process('in google photos search fo class mates', 'chat');
    const youtube = await router.process('search for lo fi beats in youtube', 'chat');
    const settings = await router.process('search privacy in chrome settings', 'chat');

    assert.equal(photos.intent, 'browser.siteSearch');
    assert.equal(photos.entities.site, 'google photos');
    assert.equal(photos.entities.query, 'classmates');
    assert.equal(youtube.intent, 'browser.siteSearch');
    assert.equal(youtube.entities.site, 'youtube');
    assert.equal(youtube.entities.query, 'lo fi beats');
    assert.equal(settings.intent, 'browser.siteSearch');
    assert.equal(settings.entities.site, 'chrome settings');
    assert.equal(settings.entities.query, 'privacy');
  });

  it('should route personal email searches to Gmail site search instead of web search', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('search my emails for internship', 'chat');

    assert.equal(result.intent, 'browser.siteSearch');
    assert.equal(result.entities.site, 'gmail');
    assert.equal(result.entities.query, 'internship');
  });

  it('should keep browser tab language on browser tab actions despite typos', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const executed = [];
    const stubEngine = {
      execute(actionId, entities) {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities, count: 1, tabs: [{ title: 'ChatGPT' }] } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const typoList = await router.process('what taqbs are open in chromme', 'chat');
    const first = await router.process('close the first tab', 'chat');
    const named = await router.process('close the github tab in chrome', 'chat');

    assert.equal(typoList.intent, 'browser.listTabs');
    assert.equal(typoList.entities.browserName, 'chrome');
    assert.equal(first.intent, 'browser.closeTab');
    assert.equal(first.entities.browserName, 'browser');
    assert.equal(first.entities.tabQuery, undefined);
    assert.equal(named.intent, 'browser.closeTab');
    assert.equal(named.entities.browserName, 'chrome');
    assert.equal(named.entities.tabQuery, 'github');
    assert.deepEqual(executed.map(step => step.actionId), ['browser.listTabs', 'browser.closeTab', 'browser.closeTab']);
  });

  it('should attach language understanding evidence to routed commands', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const router = new ActionRouter(config, stubEngine);
    const result = await router.process('search for chatgpt in chrome', 'chat');

    assert.equal(result.intent, 'browser.search');
    assert.equal(result.languageUnderstanding.status, 'passed');
    assert.equal(result.languageUnderstanding.intent, 'browser.search');
    assert.equal(result.languageUnderstanding.validation.status, 'passed');
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
    const tabWithArticle = await router.process('open new tab in the chrome', 'chat');
    const chromeTab = await router.process('open new chrome tab', 'chat');
    const search = await router.process('search for latest cricket news in new tab in chrome', 'chat');

    assert.equal(tab.intent, 'browser.open');
    assert.equal(tab.entities.url, 'about:newtab');
    assert.equal(tab.entities.browserName, 'chrome');
    assert.equal(tab.entities.newTab, true);
    assert.equal(tabWithArticle.intent, 'browser.open');
    assert.equal(tabWithArticle.entities.browserName, 'chrome');
    assert.equal(chromeTab.intent, 'browser.open');
    assert.equal(chromeTab.entities.browserName, 'chrome');
    assert.equal(search.intent, 'browser.search');
    assert.equal(search.entities.query, 'latest cricket news');
    assert.equal(search.entities.openInBrowser, true);
  });

  it('should preserve ordinary-focus and explicit-new app operations', async function() {
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

    const ordinary = await router.process('open notepad', 'chat');
    const newWindow = await router.process('open a new notepad window', 'chat');
    const another = await router.process('launch another calculator app', 'chat');

    assert.equal(ordinary.intent, 'app.open');
    assert.equal(ordinary.entities.requestedOperation || 'open-or-focus', 'open-or-focus');
    assert.equal(ordinary.entities.forceNewWindow, undefined);
    assert.equal(newWindow.entities.appName, 'notepad');
    assert.equal(newWindow.entities.forceNewWindow, true);
    assert.equal(newWindow.entities.requestedOperation, 'open-new-window');
    assert.equal(another.entities.appName, 'calc');
    assert.equal(another.entities.forceNewWindow, true);
    assert.ok(executed.every(entry => entry.actionId === 'app.open'));
  });

  it('should route browser counts, named tabs, another tabs, and joined speech', async function() {
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

    const count = await router.process('how many tabs are in chrome', 'chat');
    const named = await router.process('open jio hotstar tab in chrome', 'chat');
    const another = await router.process('open another new tab in chrome', 'chat');
    const joined = await router.process('open jiohotstarin chrome', 'chat');

    assert.equal(count.intent, 'browser.listTabs');
    assert.equal(count.entities.responseMode, 'count');
    assert.equal(named.intent, 'browser.openTab');
    assert.equal(named.entities.tabQuery, 'jio hotstar');
    assert.equal(another.intent, 'browser.open');
    assert.equal(another.entities.forceNewTab, true);
    assert.equal(joined.intent, 'browser.search');
    assert.equal(joined.entities.query, 'jiohotstar');
    assert.deepEqual(executed.map(entry => entry.actionId), [
      'browser.listTabs',
      'browser.openTab',
      'browser.open',
      'browser.search'
    ]);
  });

  it('should keep application tabs and another website tabs in their correct domains', async function() {
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

    const notepadTab = await router.process('open new tab in notepad', 'chat');
    const youtubeTab = await router.process('open another youtube', 'chat');
    const codeWindow = await router.process('open another visual studio code', 'chat');

    assert.equal(notepadTab.intent, 'app.newTab');
    assert.equal(notepadTab.entities.appName, 'notepad');
    assert.equal(youtubeTab.intent, 'browser.open');
    assert.equal(youtubeTab.entities.url, 'https://www.youtube.com/');
    assert.equal(youtubeTab.entities.newTab, true);
    assert.equal(codeWindow.intent, 'app.open');
    assert.equal(codeWindow.entities.appName, 'visual studio code');
    assert.deepEqual(executed.map(entry => entry.actionId), [
      'app.newTab',
      'browser.open',
      'app.open'
    ]);
  });

  it('should treat open YouTube app as an app command, not an app-list question', async function() {
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

    const result = await router.process('open youtube app', 'chat');

    assert.equal(result.intent, 'app.open');
    assert.equal(result.entities.appName, 'youtube');
    assert.deepEqual(executed.map(entry => entry.actionId), ['app.open']);
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

  it('should clean conversational words from file-open commands', async function() {
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

    const result = await router.process('open my resume file', 'chat');

    assert.equal(result.intent, 'file.open');
    assert.equal(result.entities.filename, 'resume');
    assert.equal(executed[0].actionId, 'file.open');
  });

  it('should route misspelled folder searches through local execution', async function() {
    const config = {
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const stubEngine = {
      execute(actionId, entities) {
        return { success: true, data: { actionId, ...entities, entries: [], count: 0 } };
      }
    };
    const router = new ActionRouter(config, stubEngine);

    const result = await router.process('serch for my projet archve floder', 'chat');

    assert.equal(result.intent, 'folder.search');
    assert.equal(result.entities.query, 'projet archve');
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
