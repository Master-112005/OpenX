const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Natural Language Router', function() {
  let NaturalLanguageRouter;
  let NlpProcessor;
  let EntityExtractor;
  let IntentRegistry;
  let ActiveLearningStore;

  before(function() {
    NaturalLanguageRouter = require('../../core/assistant/nlu/index');
    NlpProcessor = require('../../core/assistant/nlp/index');
    EntityExtractor = require('../../core/assistant/entities/index');
    IntentRegistry = require('../../core/assistant/intents/index').IntentRegistry;
    ActiveLearningStore = require('../../core/assistant/learning/index');
  });

  function createRouter() {
    const intentRegistry = new IntentRegistry();
    const nlp = new NlpProcessor(intentRegistry);
    return new NaturalLanguageRouter({
      intentRegistry,
      entityExtractor: new EntityExtractor({}),
      nlp
    });
  }

  it('should parse multi-command utterances into validated word-level frames', function() {
    const router = createRouter();
    const result = router.parse('stop the video and set vol to 100');

    assert.equal(result.multiIntent, true);
    assert.equal(result.validation.status, 'passed');
    assert.deepEqual(result.frames.map(frame => frame.intentId), ['media.stop', 'volume.set']);
    assert.deepEqual(result.frames.map(frame => frame.domain), ['media', 'volume']);
    assert.equal(result.frames[1].entities.value, 100);
    assert.equal(result.frames[0].tokenRoles.some(role => role.token === 'stop' && role.role === 'action'), true);
    assert.equal(result.frames[1].tokenRoles.some(role => role.token === '100' && role.role === 'value'), true);
  });

  it('should distinguish media volume from system volume when a media platform is named', function() {
    const router = createRouter();
    const media = router.parse('increase youtube volume');
    const system = router.parse('increase volume');

    assert.equal(media.frames[0].intentId, 'media.volumeUp');
    assert.equal(media.frames[0].domain, 'media');
    assert.equal(system.frames[0].intentId, 'volume.up');
    assert.equal(system.frames[0].domain, 'volume');
  });

  it('should store compact routing evidence for active learning', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-nlu-learning-'));
    const store = new ActiveLearningStore({
      activeLearning: { enabled: true },
      app: { dataDir }
    });

    const semanticParse = createRouter().parse('pause the video');
    store.recordRoutingEvidence({
      input: 'pause the video',
      source: 'chat',
      intent: 'media.pause',
      success: true,
      routeSource: 'natural-language-router',
      semanticParse
    });

    const evidence = store.getRoutingEvidence(1);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].intent, 'media.pause');
    assert.equal(evidence[0].frames[0].domain, 'media');
    assert.equal(evidence[0].frames[0].validationStatus, 'passed');
  });
});
