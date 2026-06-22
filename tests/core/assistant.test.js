const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

  it('should continue remaining multi-command steps after confirming a protected first step', async function() {
    const executed = [];
    const automation = {
      execute: async (actionId, entities) => {
        executed.push({ actionId, entities });
        return { success: true, data: { actionId, ...entities } };
      }
    };
    const assistant = new Assistant({
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: true, requiresAuth: false }
        }
      },
      activeLearning: { enabled: false }
    }, {
      automation,
      eventBus: { publish() {} }
    });

    const first = await assistant.processCommand('close chrome and set vol 100');
    assert.equal(first.requiresConfirmation, true);
    assert.equal(first.intent, 'multi.command');
    assert.match(first.response, /Close an application/i);

    const confirmed = await assistant.processCommand('yes');

    assert.equal(confirmed.success, true);
    assert.equal(confirmed.intent, 'multi.command');
    assert.deepEqual(executed.map(step => step.actionId), ['app.close', 'volume.set']);
    assert.equal(executed[0].entities.appName, 'chrome');
    assert.equal(executed[1].entities.value, 100);
    assert.match(confirmed.response, /Completed 2 commands/i);
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

  it('should use the last knowledge topic for explanation follow-up commands', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-${routedInputs.length}`,
          success: true,
          intent: 'browser.search',
          confidence: 1,
          entities: {
            query: String(input).replace(/^search for\s+/i, '')
          },
          response: 'Searched.'
        };
      }
    };

    const assistant = new Assistant({ activeLearning: { enabled: false } }, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('Explain Docker in simple words.', 'chat');
    await assistant.processCommand('Can you make that easier to understand?', 'chat');
    await assistant.processCommand('Give me a real-world example.', 'chat');
    await assistant.processCommand('Summarize that in one minute.', 'chat');

    assert.equal(routedInputs[0], 'Explain Docker in simple words.');
    assert.equal(routedInputs[1], 'search for docker simple beginner explanation');
    assert.equal(routedInputs[2], 'search for docker real world example');
    assert.equal(routedInputs[3], 'search for docker one minute summary');
  });

  it('should use conversation topic memory for natural pronoun follow-ups', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-topic-${routedInputs.length}`,
          success: true,
          intent: 'browser.search',
          confidence: 1,
          entities: {
            query: String(input).replace(/^search for\s+/i, '')
          },
          response: 'Searched.'
        };
      }
    };

    const assistant = new Assistant({ activeLearning: { enabled: false } }, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('Explain Docker in simple words.', 'chat');
    await assistant.processCommand('How does it work?', 'chat');
    await assistant.processCommand('What are its uses?', 'chat');

    assert.deepEqual(routedInputs, [
      'Explain Docker in simple words.',
      'search for how docker works',
      'search for docker uses'
    ]);
  });

  it('should answer recent chat memory questions without routing', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-memory-${routedInputs.length}`,
          success: true,
          intent: 'browser.search',
          confidence: 1,
          entities: { query: input },
          response: 'Searched.'
        };
      }
    };

    const assistant = new Assistant({ activeLearning: { enabled: false } }, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('Explain Kubernetes in simple words.', 'chat');
    const previous = await assistant.processCommand('what did I just say?', 'chat');
    const recap = await assistant.processCommand('what were we talking about?', 'chat');
    const about = await assistant.processCommand('what did I say about Kubernetes?', 'chat');

    assert.match(previous.response, /Explain Kubernetes/i);
    assert.match(recap.response, /Kubernetes/i);
    assert.match(about.response, /Kubernetes/i);
    assert.deepEqual(routedInputs, ['Explain Kubernetes in simple words.']);
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

  it('should treat ya as confirmation for an existing blank-tab prompt', async function() {
    let selectedEntities = null;
    const router = {
      process: async () => ({
        commandId: 'cmd-new-tab',
        success: false,
        needsClarification: true,
        intent: 'browser.open',
        entities: { url: 'about:newtab', browserName: 'chrome', newTab: true },
        data: {
          clarificationType: 'browser.open.blankTabAlreadyOpen',
          confirmEntities: { skipExistingBlankTabCheck: true }
        },
        response: 'A new Chrome tab is already open. Do you need another new tab?'
      }),
      confirmAndExecute: async (commandId, intentId, entities) => {
        selectedEntities = entities;
        return {
          commandId,
          success: true,
          intent: intentId,
          entities,
          response: 'Opening another new tab.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open a new tab in chrome');
    const result = await assistant.processCommand('ya');

    assert.equal(result.success, true);
    assert.equal(selectedEntities.skipExistingBlankTabCheck, true);
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

  it('should retry the last actionable command from natural follow-up language', async function() {
    const seenInputs = [];
    const router = {
      process: async input => {
        seenInputs.push(input);
        return {
          commandId: `cmd-${seenInputs.length}`,
          success: true,
          intent: 'media.resume',
          entities: {},
          response: 'Resumed playback.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('unpause');
    const repeated = await assistant.processCommand('try again');

    assert.equal(repeated.success, true);
    assert.equal(seenInputs[1], 'unpause');
  });

  it('should retry the last failed command before repeating a successful one', async function() {
    const seenInputs = [];
    const router = {
      process: async input => {
        seenInputs.push(input);
        if (input === 'close github tab') {
          return {
            commandId: 'cmd-failed',
            success: false,
            intent: 'browser.closeTab',
            entities: { tabQuery: 'github' },
            response: 'I could not find that tab.',
            error: 'Could not find a github tab'
          };
        }
        return {
          commandId: 'cmd-success',
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
      eventBus: { publish() {} },
      learning: { enabled: false }
    });

    await assistant.processCommand('open chrome');
    await assistant.processCommand('close github tab');
    await assistant.processCommand('try again');

    assert.equal(seenInputs[2], 'close github tab');
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

  it('should not let failed close confirmations poison later app open recovery', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        if (/^close\b/i.test(input)) {
          return {
            commandId: 'cmd-close',
            success: true,
            requiresConfirmation: true,
            intent: 'app.close',
            entities: { appName: 'chrome' },
            response: 'Please confirm close chrome.'
          };
        }
        return {
          commandId: 'cmd-open',
          success: false,
          intent: 'app.open',
          entities: { appName: 'chrome' },
          error: 'Could not open: chrome',
          response: 'Could not open chrome.'
        };
      },
      confirmAndExecute: async (commandId, intentId, entities) => ({
        commandId,
        success: false,
        intent: intentId,
        entities,
        error: 'chrome still appears to be open',
        response: 'chrome still appears to be open'
      })
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('close chrome', 'chat');
    const closeResult = await assistant.processCommand('yes', 'chat');
    const openResult = await assistant.processCommand('open chrome', 'chat');

    assert.equal(closeResult.success, false);
    assert.equal(openResult.success, false);
    assert.match(openResult.response, /could not open chrome/i);
    assert.doesNotMatch(openResult.response, /closed chrome/i);
    assert.deepEqual(routedInputs, ['close chrome', 'open chrome']);
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

  it('should expand compact pronoun commands and open the recent file result', async function() {
    const routedInputs = [];
    const filePath = 'C:\\Users\\rakes\\Documents\\PASSWORDS.txt';
    const router = {
      process: async (input) => {
        routedInputs.push(input);
        if (routedInputs.length === 1) {
          return {
            commandId: 'cmd-file-search',
            success: true,
            intent: 'file.search',
            entities: { query: 'passwords' },
            data: {
              query: 'passwords',
              count: 1,
              results: [filePath],
              entries: [{ name: 'PASSWORDS.txt', type: 'file', path: filePath }]
            },
            response: 'I found 1 matching item: PASSWORDS.txt.'
          };
        }

        return {
          commandId: 'cmd-file-open',
          success: true,
          intent: 'file.open',
          entities: { filename: input.replace(/^open\s+/i, '') },
          data: { path: filePath, filename: 'PASSWORDS.txt' },
          response: 'Opening "PASSWORDS.txt".'
        };
      }
    };

    const assistant = new Assistant({ activeLearning: { enabled: false } }, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('find passwords file', 'chat');
    const opened = await assistant.processCommand('openit', 'chat');

    assert.equal(opened.success, true);
    assert.equal(routedInputs[1], `open ${filePath}`);
  });

  it('should open a named recent file result instead of treating it as an app', async function() {
    const routedInputs = [];
    const filePath = 'C:\\Users\\rakes\\Documents\\PASSWORDS.txt';
    const router = {
      process: async (input) => {
        routedInputs.push(input);
        if (routedInputs.length === 1) {
          return {
            commandId: 'cmd-file-search-2',
            success: true,
            intent: 'file.search',
            entities: { query: 'passwords' },
            data: {
              query: 'passwords',
              count: 1,
              entries: [{ name: 'PASSWORDS.txt', type: 'file', path: filePath }]
            },
            response: 'I found 1 matching item: PASSWORDS.txt.'
          };
        }

        return {
          commandId: 'cmd-file-open-2',
          success: true,
          intent: 'file.open',
          entities: { filename: input.replace(/^open\s+/i, '') },
          data: { path: filePath, filename: 'PASSWORDS.txt' },
          response: 'Opening "PASSWORDS.txt".'
        };
      }
    };

    const assistant = new Assistant({ activeLearning: { enabled: false } }, {
      router,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('find passwords file', 'chat');
    await assistant.processCommand('open passwords', 'chat');

    assert.equal(routedInputs[1], `open ${filePath}`);
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

  it('should ask for feedback after actionable commands and record positive feedback', async function() {
    const feedback = [];
    const learning = {
      enabled: true,
      askForFeedback: true,
      findCorrection: () => null,
      learnFromText: () => null,
      recordFeedback: entry => feedback.push(entry)
    };
    const router = {
      process: async () => ({
        commandId: 'cmd-feedback',
        success: true,
        intent: 'app.open',
        confidence: 1,
        entities: { appName: 'chrome' },
        response: 'Opened chrome.'
      })
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    const first = await assistant.processCommand('open chrome');
    const second = await assistant.processCommand('yes');

    assert.match(first.response, /Did that work correctly/i);
    assert.equal(second.learned, true);
    assert.equal(feedback[0].rating, 'positive');
    assert.equal(assistant.getStatus().awaitingFeedback, false);
  });

  it('should not ask for feedback after verified media playback', async function() {
    const learning = {
      enabled: true,
      askForFeedback: true,
      findCorrection: () => null,
      learnFromText: () => null,
      recordFeedback: () => {
        throw new Error('media playback should not request learning feedback');
      }
    };
    const router = {
      process: async () => ({
        commandId: 'cmd-media-feedback',
        success: true,
        intent: 'media.play',
        confidence: 1,
        entities: { mediaQuery: 'playdate song', mediaPlatform: 'youtube' },
        data: {
          query: 'playdate song',
          platform: 'youtube',
          appName: 'YouTube',
          launchMethod: 'existing-window',
          replacedExisting: true,
          playbackVerification: {
            type: 'media.play',
            valid: true,
            requestedQuery: 'playdate song',
            requestedPlatform: 'youtube'
          }
        },
        response: 'I have replaced the current playback with "playdate song" on YouTube.'
      })
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    const result = await assistant.processCommand('play playdate song');

    assert.doesNotMatch(result.response, /Did that work correctly/i);
    assert.equal(assistant.getStatus().awaitingFeedback, false);
  });

  it('should learn a correction from negative feedback and reuse it later', async function() {
    const corrections = new Map();
    const learning = {
      enabled: true,
      askForFeedback: true,
      findCorrection: input => {
        const key = input.toLowerCase();
        return corrections.has(key) ? { correction: corrections.get(key) } : null;
      },
      rememberCorrection: (input, correction) => {
        corrections.set(input.toLowerCase(), correction);
        return { input, correction };
      },
      learnFromText: () => null,
      recordFeedback: () => {}
    };
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-${routedInputs.length}`,
          success: true,
          intent: input.includes('google photos') ? 'browser.openFirstResult' : 'app.open',
          confidence: 1,
          entities: input.includes('google photos') ? { query: 'google photos' } : { appName: 'photos' },
          response: input.includes('google photos') ? 'Opened Google Photos.' : 'Opened Photos.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open photos');
    await assistant.processCommand('no, open google photos');
    await assistant.processCommand('open photos');

    assert.deepEqual(routedInputs, ['open photos', 'open google photos', 'open google photos']);
  });

  it('should resolve polite references like close that to the last app target', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-ref-${routedInputs.length}`,
          success: true,
          intent: input.startsWith('close') ? 'app.close' : 'app.open',
          confidence: 1,
          entities: { appName: 'instagram' },
          response: input.startsWith('close') ? 'Closed instagram.' : 'Opened instagram.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('can you please open instagram');
    await assistant.processCommand('can please close that');

    assert.deepEqual(routedInputs, ['can you please open instagram', 'close instagram']);
  });

  it('should resolve app status context before window follow-ups', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        if (input === 'is chrome running') {
          return {
            commandId: 'cmd-app-status',
            success: true,
            intent: 'system.processes',
            confidence: 1,
            entities: { target: 'apps', queryApp: 'chrome' },
            response: 'Chrome is open.'
          };
        }
        return {
          commandId: 'cmd-window',
          success: true,
          intent: 'window.maximize',
          confidence: 1,
          entities: { windowName: 'chrome' },
          response: 'Maximized chrome.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('is chrome running');
    await assistant.processCommand('maxmize it');

    assert.deepEqual(routedInputs, ['is chrome running', 'maximize chrome']);
  });

  it('should keep personal email and calendar requests out of blind web search', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: 'cmd-mail',
          success: true,
          intent: 'browser.siteSearch',
          confidence: 1,
          entities: { site: 'gmail', query: 'internship' },
          response: 'Searching Gmail.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    const mail = await assistant.processCommand('search my emails for internship');
    const calendar = await assistant.processCommand('what meetings do I have today');

    assert.equal(mail.intent, 'browser.siteSearch');
    assert.deepEqual(routedInputs, ['search internship in gmail']);
    assert.equal(calendar.intent, 'assistant.context');
    assert.match(calendar.response, /Calendar reading is not connected/i);
  });

  it('should answer session search history and carry topic into year follow-ups', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-search-${routedInputs.length}`,
          success: true,
          intent: 'browser.search',
          confidence: 1,
          entities: { query: input.replace(/^search\s+(?:for\s+)?/i, '') },
          data: { query: input.replace(/^search\s+(?:for\s+)?/i, '') },
          response: 'Search complete.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('search for IPL winners');
    const lastSearch = await assistant.processCommand('what was the last thing I searched');
    await assistant.processCommand('what about 2022');
    await assistant.processCommand('what about the year before that');

    assert.match(lastSearch.response, /IPL winners/i);
    assert.deepEqual(routedInputs, [
      'search for IPL winners',
      'who won IPL in 2022',
      'who won IPL in 2021'
    ]);
  });

  it('should resolve file pronouns to the last discussed file', async function() {
    const routedInputs = [];
    const filePath = 'C:\\Users\\rakes\\Documents\\Resume.docx';
    const router = {
      process: async input => {
        routedInputs.push(input);
        if (input === 'find Resume.docx') {
          return {
            commandId: 'cmd-file-search',
            success: true,
            intent: 'file.search',
            confidence: 1,
            entities: { query: 'Resume.docx' },
            data: { results: [{ name: 'Resume.docx', path: filePath }] },
            response: 'Found Resume.docx.'
          };
        }
        return {
          commandId: 'cmd-file-follow',
          success: true,
          intent: 'file.search',
          confidence: 1,
          entities: { query: filePath },
          response: 'Located file.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('find Resume.docx');
    await assistant.processCommand('where is it located');
    const name = await assistant.processCommand('what is its file name');

    assert.deepEqual(routedInputs, [
      'find Resume.docx',
      `what is the location of ${filePath}`
    ]);
    assert.match(name.response, /Resume\.docx/);
  });

  it('should learn corrective phrasing against the last failed command', async function() {
    const learnedRules = [];
    const routedInputs = [];
    const learning = {
      enabled: true,
      askForFeedback: false,
      findCorrection: () => null,
      learnFromText: () => null,
      rememberCorrection: (input, correction) => {
        learnedRules.push({ input, correction });
        return { input, correction };
      },
      recordFeedback: () => {}
    };
    const router = {
      process: async input => {
        routedInputs.push(input);
        if (input === 'can please close that') {
          return {
            commandId: 'cmd-failed-close',
            success: false,
            intent: 'app.close',
            confidence: 0.99,
            entities: { appName: 'can' },
            response: 'Could not close can.'
          };
        }
        return {
          commandId: 'cmd-fixed-close',
          success: true,
          intent: 'app.close',
          confidence: 1,
          entities: { appName: 'instagram' },
          response: 'Closed instagram.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('can please close that');
    const fixed = await assistant.processCommand('i said to close the instagram');

    assert.equal(fixed.success, true);
    assert.equal(fixed.learned, true);
    assert.deepEqual(routedInputs, ['can please close that', 'close instagram']);
    assert.deepEqual(learnedRules, [{ input: 'can please close that', correction: 'close instagram' }]);
  });

  it('should learn corrective phrasing after an unknown command with no intent', async function() {
    const learnedRules = [];
    const routedInputs = [];
    const learning = {
      enabled: true,
      askForFeedback: false,
      findCorrection: () => null,
      learnFromText: () => null,
      rememberCorrection: (input, correction) => {
        learnedRules.push({ input, correction });
        return { input, correction };
      },
      recordFeedback: () => {}
    };
    const router = {
      process: async input => {
        routedInputs.push(input);
        if (input === 'do the magic thing') {
          return {
            commandId: 'cmd-unknown',
            success: false,
            intent: null,
            confidence: 0,
            entities: {},
            languageUnderstanding: { status: 'failed', reason: 'no-intent' },
            response: 'I could not understand that command.'
          };
        }
        return {
          commandId: 'cmd-open-chrome',
          success: true,
          intent: 'app.open',
          confidence: 1,
          entities: { appName: 'chrome' },
          response: 'Opened chrome.'
        };
      }
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('do the magic thing');
    const fixed = await assistant.processCommand('i meant open chrome');

    assert.equal(fixed.success, true);
    assert.equal(fixed.learned, true);
    assert.deepEqual(routedInputs, ['do the magic thing', 'open chrome']);
    assert.deepEqual(learnedRules, [{ input: 'do the magic thing', correction: 'open chrome' }]);
  });

  it('should not ask for feedback repeatedly after the same confident action', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learning-'));
    const learning = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true, askForFeedback: true }
    });
    const router = {
      process: async () => ({
        commandId: 'cmd-repeat-feedback',
        success: true,
        intent: 'app.open',
        confidence: 1,
        entities: { appName: 'chrome' },
        response: 'Opened chrome.'
      })
    };
    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    const first = await assistant.processCommand('open chrome');
    await assistant.processCommand('yes');
    const second = await assistant.processCommand('open chrome');

    assert.match(first.response, /Did that work correctly/i);
    assert.doesNotMatch(second.response, /Did that work correctly/i);
  });

  it('should handle positive feedback attached to the next command', async function() {
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: `cmd-combined-${routedInputs.length}`,
          success: true,
          intent: 'app.open',
          confidence: 1,
          entities: { appName: 'chrome' },
          response: 'Opened chrome.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      learning: {
        enabled: true,
        askForFeedback: true,
        findCorrection: () => null,
        learnFromText: () => null,
        recordFeedback: () => {},
        shouldAskForFeedback: () => true,
        recordFeedbackPrompt: () => {}
      },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open chrome');
    const result = await assistant.processCommand('yesopen chrome');

    assert.equal(result.success, true);
    assert.deepEqual(routedInputs, ['open chrome', 'open chrome']);
  });

  it('should only remember a correction after the corrected command succeeds', async function() {
    const learnedRules = [];
    const router = {
      process: async input => ({
        commandId: `cmd-${input}`,
        success: input !== 'open missing app',
        intent: 'app.open',
        confidence: 1,
        entities: { appName: input.replace(/^open\s+/, '') },
        response: input === 'open missing app' ? 'Could not open missing app.' : 'Opened app.'
      })
    };
    const assistant = new Assistant({}, {
      router,
      learning: {
        enabled: true,
        askForFeedback: true,
        findCorrection: () => null,
        learnFromText: () => null,
        rememberCorrection: (input, correction) => {
          learnedRules.push({ input, correction });
          return { input, correction };
        },
        recordFeedback: () => {},
        shouldAskForFeedback: () => true,
        recordFeedbackPrompt: () => {}
      },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open photos');
    const result = await assistant.processCommand('no, open missing app');

    assert.equal(result.success, false);
    assert.equal(result.learned, false);
    assert.deepEqual(learnedRules, []);
  });

  it('should turn plain negative outcome reports into active learning recovery', async function() {
    const feedback = [];
    const learnedRules = [];
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        const isCloseTab = /close\s+(?:the\s+)?(?:empty\s+)?tab/i.test(input);
        return {
          commandId: `cmd-${routedInputs.length}`,
          success: true,
          intent: isCloseTab ? 'browser.closeTab' : 'browser.open',
          confidence: 1,
          entities: isCloseTab ? { browserName: 'chrome' } : { url: 'about:blank' },
          response: isCloseTab ? 'Closed tab.' : 'Opened blank tab.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      learning: {
        enabled: true,
        askForFeedback: false,
        findCorrection: () => null,
        learnFromText: () => null,
        recordFeedback: entry => feedback.push(entry),
        rememberCorrection: (input, correction) => {
          learnedRules.push({ input, correction });
          return { input, correction };
        }
      },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('open a new tab in chrome');
    const recovery = await assistant.processCommand('you did wrong');
    const corrected = await assistant.processCommand('close the empty tab in chrome');

    assert.equal(recovery.success, false);
    assert.match(recovery.response, /What should I do instead next time/i);
    assert.equal(corrected.success, true);
    assert.deepEqual(learnedRules, [{
      input: 'open a new tab in chrome',
      correction: 'close empty tab in chrome'
    }]);
    assert.equal(feedback.some(entry => entry.rating === 'negative'), true);
  });

  it('should answer remembered personal facts without web search', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learning-'));
    const learning = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true, askForFeedback: false }
    });
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: 'cmd-search',
          success: true,
          intent: 'browser.search',
          entities: { query: input },
          response: 'Searched web.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    const before = await assistant.processCommand('what is my name');
    const remember = await assistant.processCommand('remember my name is rakes');
    const after = await assistant.processCommand('what is my name');

    assert.equal(before.intent, 'assistant.memory');
    assert.equal(before.success, false);
    assert.match(before.response, /do not know your name/i);
    assert.equal(remember.learned, true);
    assert.match(after.response, /your name is rakes/i);
    assert.deepEqual(routedInputs, []);
  });

  it('should reject password memory while still learning safe personal context before routing', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learning-'));
    const learning = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true, askForFeedback: false }
    });
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: 'cmd-search',
          success: true,
          intent: 'browser.search',
          entities: { query: input },
          response: 'Searched web.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    const rememberPassword = await assistant.processCommand('remember this rakesh112005 as my apple account password');
    const passwordAnswer = await assistant.processCommand('what is my apple account password');
    const rememberFact = await assistant.processCommand('remember my favorite color is blue');
    const factAnswer = await assistant.processCommand('what is my favorite color');

    assert.equal(rememberPassword.learned, false);
    assert.equal(rememberPassword.success, false);
    assert.doesNotMatch(passwordAnswer.response, /rakesh112005/);
    assert.match(passwordAnswer.response, /cannot store or reveal/i);
    assert.equal(rememberFact.learned, true);
    assert.match(factAnswer.response, /favorite color is blue/i);
    assert.deepEqual(routedInputs, []);
  });

  it('should answer broader personal context before routing', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learning-'));
    const learning = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true, askForFeedback: false }
    });
    const routedInputs = [];
    const router = {
      process: async input => {
        routedInputs.push(input);
        return {
          commandId: 'cmd-search',
          success: true,
          intent: 'browser.search',
          entities: { query: input },
          response: 'Searched web.'
        };
      }
    };
    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('remember that I live in Hyderabad');
    await assistant.processCommand('my mobile number is 9876543210');
    await assistant.processCommand('remember that I study at OpenX University');

    const location = await assistant.processCommand('where do I live');
    const phone = await assistant.processCommand('what is my phone number');
    const school = await assistant.processCommand('where do I study');
    const identity = await assistant.processCommand('tell me about myself');

    assert.match(location.response, /Hyderabad/);
    assert.match(phone.response, /9876543210/);
    assert.match(school.response, /OpenX University/);
    assert.match(identity.response, /you live in Hyderabad/);
    assert.deepEqual(routedInputs, []);
  });

  it('should save an explicit compact chat summary for later recall', async function() {
    const ActiveLearningStore = require('../../core/assistant/Active-learning');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-chat-memory-'));
    const learning = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true, askForFeedback: false }
    });
    const router = {
      process: async input => ({
        commandId: `cmd-${input}`,
        success: true,
        intent: 'browser.search',
        confidence: 1,
        entities: { query: input },
        response: 'Searched.'
      })
    };

    const assistant = new Assistant({}, {
      router,
      learning,
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('Explain Docker in simple words');
    await assistant.processCommand('Find Kubernetes beginner course');
    const saved = await assistant.processCommand('remember this chat');
    const recalled = await assistant.processCommand('what did we talk about last time');

    assert.equal(saved.learned, true);
    assert.match(recalled.response, /Docker/i);
    assert.match(recalled.response, /Kubernetes/i);
  });

  it('should vary conversational greetings by user phrasing', async function() {
    const assistant = new Assistant({}, {
      automation: {
        execute: async () => ({ success: true, data: {} })
      },
      eventBus: { publish() {} }
    });

    const morning = await assistant.processCommand('good morning');
    const hello = await assistant.processCommand('hello');
    const hi = await assistant.processCommand('hi');
    const wellbeing = await assistant.processCommand('how are you');

    assert.equal(morning.intent, 'greeting');
    assert.equal(hello.intent, 'greeting');
    assert.equal(hi.intent, 'greeting');
    assert.equal(wellbeing.intent, 'greeting');
    assert.notEqual(morning.response, hello.response);
    assert.notEqual(hello.response, hi.response);
    assert.notEqual(hello.response, wellbeing.response);
  });

  it('should keep validation and verification evidence in command context', async function() {
    const router = {
      process: async () => ({
        commandId: 'cmd-verified-file',
        success: true,
        intent: 'file.create',
        confidence: 1,
        entities: { filename: 'report.txt' },
        languageUnderstanding: { status: 'passed', intent: 'file.create' },
        validation: { status: 'passed', check: 'required-entities' },
        verification: { status: 'passed', check: 'file-exists' },
        response: 'Created report.txt.'
      })
    };
    const assistant = new Assistant({}, {
      router,
      learning: { enabled: false },
      automation: {},
      eventBus: { publish() {} }
    });

    await assistant.processCommand('create report.txt');
    const history = assistant.getContext().getHistory(1);
    const summary = assistant.getContext().getConversationSummary();

    assert.equal(history[0].validation.status, 'passed');
    assert.equal(history[0].languageUnderstanding.status, 'passed');
    assert.equal(history[0].verification.check, 'file-exists');
    assert.equal(summary.verifiedCommands, 1);
    assert.equal(summary.failedVerificationCommands, 0);
  });
});
