'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Assistant = require('../../core/assistant');
const ActiveLearningStore = require('../../core/assistant/Active-learning');
const IntentRegistry = require('../../core/assistant/intents').IntentRegistry;
const InputParser = require('../../core/assistant/parser');
const { CommandFrameParser } = require('../../core/assistant/parser');
const NlpProcessor = require('../../core/assistant/nlp/nlp');
const NaturalLanguageRouter = require('../../core/assistant/nlu');
const NaturalLanguageExecution = require('../../core/assistant/nle');
const ActionRouter = require('../../core/assistant/router');

describe('Incorrect learning repair', function() {
  function createAssistant() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-learning-repair-'));
    const config = {
      app: { dataDir },
      activeLearning: {
        enabled: true,
        askForFeedback: false,
        storePath: path.join(dataDir, 'learning.json')
      }
    };
    const learning = new ActiveLearningStore(config);
    let routedCommands = 0;
    const router = {
      learningStore: learning,
      process: async input => {
        routedCommands += 1;
        return { success: true, intent: 'app.open', entities: {}, response: `Executed ${input}` };
      }
    };
    const assistant = new Assistant(config, {
      learning,
      router,
      automation: {},
      eventBus: { publish() {} }
    });
    return { assistant, learning, routedCount: () => routedCommands };
  }

  it('recognizes repair language consistently across parser, NLP, frames, and NLU', function() {
    const registry = new IntentRegistry();
    const nlp = new NlpProcessor(registry);
    const input = 'no this learning is wrong';

    const parsed = new InputParser({}).parse(input);
    const prepared = nlp.prepare(input);
    const commandFrame = new CommandFrameParser().parse(input, prepared);
    const semantic = new NaturalLanguageRouter({ intentRegistry: registry, nlp }).parse(input, prepared);

    assert.equal(parsed.learningDirective.kind, 'repair-learning');
    assert.equal(prepared.learningDirective.kind, 'repair-learning');
    assert.equal(commandFrame.domain, 'active-learning');
    assert.equal(semantic.frames[0].intentId, 'assistant.learningRepair');
    assert.equal(semantic.frames[0].validation.status, 'passed');
  });

  it('keeps learning repair internal to NLE instead of running automation', async function() {
    let executions = 0;
    const nle = new NaturalLanguageExecution({
      execute() {
        executions += 1;
        return { success: true };
      }
    });

    const result = await nle.execute('assistant.learningRepair', {});

    assert.equal(result.success, true);
    assert.equal(result.needsAssistantHandling, true);
    assert.equal(executions, 0);
  });

  it('routes repair phrases without invoking an automation controller', async function() {
    let executions = 0;
    const config = {
      activeLearning: { enabled: false },
      permissions: { levels: { low: { requiresConfirmation: false, requiresAuth: false } } }
    };
    const router = new ActionRouter(config, {
      execute() {
        executions += 1;
        return { success: true };
      }
    });

    const result = await router.process('what you learned is incorrect');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'assistant.learningRepair');
    assert.match(result.response, /learn instead/i);
    assert.equal(executions, 0);
  });

  it('asks for a correction and replaces only the incorrect learned rule', async function() {
    const { assistant, learning, routedCount } = createAssistant();

    const learned = await assistant.processCommand('when I say code open vscode');
    const rejected = await assistant.processCommand('no this is wrong');
    const corrected = await assistant.processCommand('open visual studio code');

    assert.equal(learned.learned, true);
    assert.equal(rejected.awaitingLearningCorrection, true);
    assert.match(rejected.response, /what should i learn instead/i);
    assert.equal(corrected.relearned, true);
    assert.match(corrected.response, /replaced the incorrect learning/i);
    assert.equal(learning.findCorrection('code').correction, 'open visual studio code');
    assert.equal(routedCount(), 0, 'a replacement must not execute as an action');
  });

  it('can repair a learned preference and rejects sensitive replacements', async function() {
    const { assistant, learning } = createAssistant();

    await assistant.processCommand('remember that I prefer spotify for music');
    await assistant.processCommand('that learning is wrong');
    const sensitive = await assistant.processCommand('my password is hunter2');
    const corrected = await assistant.processCommand('use youtube instead');

    assert.equal(sensitive.success, false);
    assert.match(sensitive.response, /sensitive/i);
    assert.equal(corrected.relearned, true);
    assert.equal(learning.getPreference('mediaPlatform').value, 'youtube');
  });
});
