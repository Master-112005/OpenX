const assert = require('assert');

describe('Assistant Confirmation Flow', function() {
  let Assistant;

  before(function() {
    Assistant = require('../../core/assistant/index');
  });

  it('should keep a pending confirmation and execute it on voice confirmation', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-1',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'chrome' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async (commandId, intentId, entities) => ({
        commandId,
        success: true,
        intent: intentId,
        entities,
        response: 'Closed chrome.'
      })
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    const first = await assistant.processVoiceInput('close chrome');
    assert.equal(first.requiresConfirmation, true);
    assert.equal(assistant.getStatus().awaitingConfirmation, true);

    const second = await assistant.processVoiceInput('yes');
    assert.equal(second.success, true);
    assert.equal(second.intent, 'app.close');
    assert.equal(second.entities.appName, 'chrome');
    assert.equal(assistant.getStatus().awaitingConfirmation, false);
  });

  it('should refuse unrelated follow-up speech until confirmation is resolved', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-2',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'chrome' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async () => {
        throw new Error('should not execute');
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close chrome');
    const followUp = await assistant.processVoiceInput('open downloads');

    assert.equal(followUp.requiresConfirmation, true);
    assert.ok(/proceed or cancel/i.test(followUp.response));
    assert.equal(assistant.getStatus().awaitingConfirmation, true);
  });

  it('should allow the user to cancel a pending confirmation', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-3',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'chrome' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async () => {
        throw new Error('should not execute');
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close chrome');
    const cancel = await assistant.processVoiceInput('cancel');

    assert.equal(cancel.cancelled, true);
    assert.ok(/cancelled/i.test(cancel.response));
    assert.equal(assistant.getStatus().awaitingConfirmation, false);
  });

  it('should cancel a pending confirmation when speech recognition misspells cancel', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-3b',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'notepad' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async () => {
        throw new Error('should not execute');
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close notepad');
    const cancel = await assistant.processVoiceInput('canle it');

    assert.equal(cancel.cancelled, true);
    assert.equal(assistant.getStatus().awaitingConfirmation, false);
  });

  it('should treat negative natural language as cancellation before confirmation', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-3c',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'notepad' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async () => {
        throw new Error('should not execute');
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close notepad');
    const cancel = await assistant.processVoiceInput("no don't do it");

    assert.equal(cancel.cancelled, true);
    assert.equal(assistant.getStatus().awaitingConfirmation, false);
  });

  it('should expire a pending confirmation after a timeout', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-4',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'chrome' },
        response: 'Please confirm that I should proceed with: Close an application'
      }),
      confirmAndExecute: async () => {
        throw new Error('should not execute');
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close chrome');
    const expired = assistant.expirePendingConfirmation('timeout', 'voice');

    assert.equal(expired.expired, true);
    assert.ok(/timed out/i.test(expired.response));
    assert.equal(assistant.getStatus().awaitingConfirmation, false);
  });

  it('should prepare voice transcripts with NLP before command routing', async function() {
    let routedInput = '';
    const router = {
      nlp: {
        prepare: () => ({
          correctedText: 'open chrome'
        })
      },
      process: async (input) => {
        routedInput = input;
        return {
          commandId: 'cmd-5',
          success: true,
          intent: 'app.open',
          entities: { appName: 'chrome' },
          response: 'Opened chrome.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    const result = await assistant.processVoiceInput('can you please opne chrmoe');

    assert.equal(result.success, true);
    assert.equal(routedInput, 'open chrome');
  });
});
