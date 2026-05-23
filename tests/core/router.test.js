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
