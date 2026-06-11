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

  it('should close a selected window after an ambiguity prompt', async function() {
    let selectedEntities = null;
    const router = {
      process: async () => ({
        commandId: 'cmd-select',
        success: false,
        needsClarification: true,
        intent: 'app.close',
        entities: { appName: 'chrome' },
        data: {
          choices: [
            { index: 1, id: 101, title: 'Project A - Google Chrome' },
            { index: 2, id: 202, title: 'Project B - Google Chrome' }
          ]
        },
        response: 'Multiple chrome windows are open. Please say which one to close: 1. Project A - Google Chrome; 2. Project B - Google Chrome'
      }),
      confirmAndExecute: async (commandId, intentId, entities) => {
        selectedEntities = entities;
        return {
          commandId,
          success: true,
          intent: intentId,
          entities,
          response: 'Closed Project B - Google Chrome.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    const first = await assistant.processCommand('close chrome');
    assert.equal(first.needsClarification, true);

    const second = await assistant.processCommand('2');
    assert.equal(second.success, true);
    assert.equal(selectedEntities.appName, 'chrome');
    assert.equal(selectedEntities.targetProcessId, 202);
  });

  it('should execute a yes/no clarification with confirm entities', async function() {
    let selectedEntities = null;
    const router = {
      process: async () => ({
        commandId: 'cmd-new-window',
        success: false,
        needsClarification: true,
        intent: 'app.open',
        entities: { appName: 'chrome' },
        data: {
          clarificationType: 'app.open.alreadyOpen',
          confirmEntities: { forceNewWindow: true }
        },
        response: 'chrome is already open. Do you want me to open another window?'
      }),
      confirmAndExecute: async (commandId, intentId, entities) => {
        selectedEntities = entities;
        return {
          commandId,
          success: true,
          intent: intentId,
          entities,
          response: 'Opening chrome now.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    const first = await assistant.processCommand('open chrome');
    assert.equal(first.needsClarification, true);

    const second = await assistant.processCommand('yes');
    assert.equal(second.success, true);
    assert.equal(selectedEntities.appName, 'chrome');
    assert.equal(selectedEntities.forceNewWindow, true);
  });

  it('should open a selected folder after an ambiguity prompt', async function() {
    let selectedEntities = null;
    const router = {
      process: async () => ({
        commandId: 'cmd-folder',
        success: false,
        needsClarification: true,
        intent: 'folder.open',
        entities: { folderName: 'screenshots' },
        data: {
          choices: [
            { index: 1, title: 'Screenshots - C:\\A\\Screenshots', path: 'C:\\A\\Screenshots' },
            { index: 2, title: 'Screenshots - C:\\B\\Screenshots', path: 'C:\\B\\Screenshots' }
          ]
        },
        response: 'I found multiple folders named "screenshots". Please say which one to open.'
      }),
      confirmAndExecute: async (commandId, intentId, entities) => {
        selectedEntities = entities;
        return {
          commandId,
          success: true,
          intent: intentId,
          entities,
          response: 'Opening screenshots.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open screenshots folder');
    const second = await assistant.processCommand('2');

    assert.equal(second.success, true);
    assert.equal(selectedEntities.selectedPath, 'C:\\B\\Screenshots');
  });

  it('should keep file-list context for follow-up references like list them', async function() {
    const seenInputs = [];
    const router = {
      process: async input => {
        seenInputs.push(input);
        if (seenInputs.length === 1) {
          return {
            commandId: 'cmd-list-1',
            success: true,
            intent: 'file.list',
            entities: { path: 'desktop', fileType: null },
            response: 'Desktop contains 3 folders.'
          };
        }

        return {
          commandId: 'cmd-list-2',
          success: true,
          intent: 'file.list',
          entities: { path: 'desktop', fileType: null },
          response: 'Desktop contains 3 folders.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('what folders on desktop');
    const second = await assistant.processCommand('list them');

    assert.equal(second.success, true);
    assert.equal(seenInputs[1], 'list files in desktop');
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

  it('should repeat the app close target while waiting for confirmation', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-close-wait',
        success: true,
        requiresConfirmation: true,
        intent: 'app.close',
        entities: { appName: 'whatsapp' },
        response: 'Please confirm: close whatsapp.'
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

    await assistant.processCommand('close whatsapp', 'chat');
    const followUp = await assistant.processCommand('what?', 'chat');

    assert.equal(followUp.requiresConfirmation, true);
    assert.match(followUp.response, /close whatsapp/i);
    assert.match(followUp.response, /yes/i);
    assert.match(followUp.response, /no/i);
  });

  it('should resolve question follow-ups after file search context', async function() {
    const routedInputs = [];
    const router = {
      process: async (input) => {
        routedInputs.push(input);
        return {
          commandId: `cmd-${routedInputs.length}`,
          success: true,
          intent: 'file.search',
          entities: { query: input.replace(/^find\s+/i, '') },
          response: 'Found matching files.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('find Resume.docx', 'chat');
    await assistant.processCommand('what are they', 'chat');

    assert.deepEqual(routedInputs, ['find Resume.docx', 'find Resume.docx']);
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

  it('should route the repaired command text from noisy voice transcripts', async function() {
    let routedInput = '';
    const router = {
      nlp: {
        prepare: () => ({
          correctedText: 'sglkn open lsg chrome',
          commandText: 'open chrome',
          repairedCommandText: 'open chrome',
          noiseTokenCount: 2,
          actionTokenCount: 1
        })
      },
      process: async (input) => {
        routedInput = input;
        return {
          commandId: 'cmd-5b',
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

    const result = await assistant.processVoiceInput('sglkn open lsg chrome');

    assert.equal(result.success, true);
    assert.equal(routedInput, 'open chrome');
  });

  it('should resolve voice pronouns from recent command context before routing', async function() {
    const routedInputs = [];
    const router = {
      nlp: {
        prepare: (input) => ({
          correctedText: input
        })
      },
      process: async (input) => {
        routedInputs.push(input);
        if (input === 'close youtube') {
          return {
            commandId: 'cmd-6a',
            success: false,
            intent: 'app.close',
            entities: { appName: 'youtube' },
            response: 'Could not close youtube.'
          };
        }
        return {
          commandId: 'cmd-6b',
          success: true,
          intent: 'app.open',
          entities: { appName: 'youtube' },
          response: 'Opened youtube.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processVoiceInput('close youtube');
    const result = await assistant.processVoiceInput('open it');

    assert.equal(result.success, true);
    assert.deepEqual(routedInputs, ['close youtube', 'open youtube']);
  });

  it('should resolve chat pronouns from recent command context before routing', async function() {
    const routedInputs = [];
    const router = {
      process: async (input) => {
        routedInputs.push(input);
        return {
          commandId: `cmd-${routedInputs.length}`,
          success: true,
          intent: input.startsWith('close') ? 'app.close' : 'app.open',
          entities: { appName: 'chrome' },
          response: input.startsWith('close') ? 'Closed chrome.' : 'Opened chrome.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open chrome', 'chat');
    await assistant.processCommand('close it', 'chat');
    await assistant.processCommand('open it again', 'chat');

    assert.deepEqual(routedInputs, ['open chrome', 'close chrome', 'open chrome']);
  });
});
