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
    NaturalLanguageRouter = require('../../core/assistant/nlu');
    NlpProcessor = require('../../core/assistant/nlp/nlp');
    EntityExtractor = require('../../core/assistant/entities');
    IntentRegistry = require('../../core/assistant/intents').IntentRegistry;
    ActiveLearningStore = require('../../core/assistant/Active-learning');
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
    assert.equal(
      result.relations.some(relation =>
        relation.type === 'sequence' &&
        relation.marker === 'and' &&
        relation.from === 'video' &&
        relation.to === 'set'
      ),
      true
    );
    assert.equal(
      result.frames[0].relations.some(relation =>
        relation.type === 'action-target' &&
        relation.from === 'stop' &&
        relation.to === 'video'
      ),
      true
    );
    assert.equal(
      result.frames[1].relations.some(relation =>
        relation.type === 'value-of' &&
        relation.from === '100' &&
        relation.to === 'volume'
      ),
      true
    );
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
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-nlu-learning-'));
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

  it('should resolve new-tab language to a native browser action', function() {
    const router = createRouter();
    const result = router.resolveIntent('open a fresh tab in chrome');

    assert.equal(result.intent.id, 'browser.open');
    assert.equal(result.semanticFrame.domain, 'browser-tab');
    assert.equal(result.entities.url, 'about:newtab');
    assert.equal(result.entities.browserName, 'chrome');
    assert.equal(result.entities.newTab, true);
  });

  it('should distinguish typo-tolerant local file and folder searches', function() {
    const router = createRouter();
    const fileResult = router.resolveIntent('serch for my quaterly reprt file');
    const folderResult = router.resolveIntent('find my projet archve floder');

    assert.equal(fileResult.intent.id, 'file.search');
    assert.equal(fileResult.entities.query, 'quaterly reprt');
    assert.equal(folderResult.intent.id, 'folder.search');
    assert.equal(folderResult.entities.query, 'projet archve');
  });

  it('should understand natural timer language with spelling mistakes', function() {
    const router = createRouter();
    const result = router.resolveIntent('add time for one minit');

    assert.equal(result.intent.id, 'timer.set');
    assert.equal(result.entities.duration, 1);
    assert.equal(result.entities.routeSource, 'natural-language-router');
  });

  it('should understand notify and alert reminder language', function() {
    const router = createRouter();
    const notify = router.resolveIntent('notify me in ten minits to sign the sheet');
    const alert = router.resolveIntent('alert me to submit the form at 5 pm');

    assert.equal(notify.intent.id, 'reminder.set');
    assert.equal(notify.entities.duration, 10);
    assert.equal(notify.entities.reminderText, 'sign the sheet');
    assert.equal(notify.entities.routeSource, 'natural-language-router');
    assert.equal(alert.intent.id, 'reminder.set');
    assert.equal(alert.entities.timeExpression, '5 pm');
    assert.equal(alert.entities.reminderText, 'submit the form');
  });
});
