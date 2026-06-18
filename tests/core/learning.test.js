const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Active Learning Store', function() {
  let ActiveLearningStore;

  before(function() {
    ActiveLearningStore = require('../../core/assistant/learning/index');
  });

  function createStore() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-learning-'));
    return {
      tempDir,
      store: new ActiveLearningStore({
        app: { dataDir: tempDir },
        activeLearning: { enabled: true, askForFeedback: true }
      })
    };
  }

  it('should persist learned command corrections', function() {
    const { tempDir, store } = createStore();

    store.rememberCorrection('open photos', 'open google photos');
    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });

    const correction = reloaded.findCorrection('open photos');
    assert.equal(correction.correction, 'open google photos');
  });

  it('should learn explicit correction and preference statements', function() {
    const { store } = createStore();

    const correction = store.learnFromText('when I say maps open google maps');
    const preference = store.learnFromText('remember that I prefer web searches in chrome');

    assert.equal(correction.type, 'correction');
    assert.equal(store.findCorrection('maps').correction, 'open google maps');
    assert.equal(preference.type, 'preference');
    assert.equal(store.getSnapshot().preferences.searchOpenMode.value, 'browser');
  });

  it('should apply browser and media preferences to routed entities', function() {
    const { store } = createStore();

    store.rememberPreference('searchOpenMode', 'browser');
    store.rememberPreference('mediaPlatform', 'spotify');

    const search = store.adaptEntities('browser.search', { query: 'chatgpt', openInBrowser: false });
    const media = store.adaptEntities('media.play', { mediaQuery: 'liked songs' });

    assert.equal(search.openInBrowser, true);
    assert.equal(media.mediaPlatform, 'spotify');
  });

  it('should remember personal photo library preferences', function() {
    const { tempDir, store } = createStore();

    const learned = store.learnFromText('remember my photo library is Google Photos');
    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });

    assert.equal(learned.type, 'preference');
    assert.equal(reloaded.getPreference('photoLibrary').value, 'googlePhotos');
  });

  it('should suppress repeated high-confidence feedback prompts for the same action', function() {
    const { store } = createStore();
    const entry = {
      input: 'open chrome',
      routedInput: 'open chrome',
      intent: 'app.open',
      entities: { appName: 'chrome' },
      confidence: 1
    };

    assert.equal(store.shouldAskForFeedback(entry), true);
    store.recordFeedbackPrompt(entry);
    assert.equal(store.shouldAskForFeedback(entry), false);
    assert.equal(store.shouldAskForFeedback({ ...entry, confidence: 0.6 }), true);
  });

  it('should remember and answer explicit user identity facts', function() {
    const { tempDir, store } = createStore();

    const unknown = store.answerPersonalQuestion('what is my name');
    const learned = store.learnFromText('remember my name is rakes');
    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });
    const answer = reloaded.answerPersonalQuestion('what is my name');

    assert.equal(unknown.known, false);
    assert.equal(learned.type, 'user-fact');
    assert.equal(answer.known, true);
    assert.equal(answer.response, 'Your name is rakes, sir.');
  });

  it('should remember and answer account passwords across service phrasing', function() {
    const { tempDir, store } = createStore();

    const apple = store.learnFromText('remember this rakesh112005 as my apple account password');
    const google = store.learnFromText('remember my gmail account password is hunter2');
    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });

    const appleAnswer = reloaded.answerPersonalQuestion('what is my apple account password');
    const googleAnswer = reloaded.answerPersonalQuestion('what is my google account password');

    assert.equal(apple.type, 'user-fact');
    assert.equal(google.type, 'user-fact');
    assert.equal(appleAnswer.known, true);
    assert.equal(appleAnswer.fact, 'applePassword');
    assert.match(appleAnswer.response, /rakesh112005/);
    assert.equal(googleAnswer.known, true);
    assert.equal(googleAnswer.fact, 'googlePassword');
    assert.match(googleAnswer.response, /hunter2/);
  });

  it('should remember and answer generic personal facts', function() {
    const { tempDir, store } = createStore();

    const learned = store.learnFromText('remember my favorite color is blue');
    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });
    const answer = reloaded.answerPersonalQuestion('what is my favorite color');

    assert.equal(learned.type, 'user-fact');
    assert.equal(answer.known, true);
    assert.equal(answer.fact, 'favorite_color');
    assert.equal(answer.response, 'Your favorite color is blue, sir.');
  });

  it('should normalize and answer broader personal context aliases', function() {
    const { tempDir, store } = createStore();

    assert.equal(store.learnFromText('remember that I live in Hyderabad').type, 'user-fact');
    assert.equal(store.learnFromText('my mobile number is 9876543210').type, 'user-fact');
    assert.equal(store.learnFromText('remember that I study at OpenX University').type, 'user-fact');
    assert.equal(store.learnFromText('remember that I work at Stark Labs').type, 'user-fact');

    const reloaded = new ActiveLearningStore({
      app: { dataDir: tempDir },
      activeLearning: { enabled: true }
    });

    const location = reloaded.answerPersonalQuestion('where do I live');
    const phone = reloaded.answerPersonalQuestion('what is my phone number');
    const school = reloaded.answerPersonalQuestion('where do I study');
    const work = reloaded.answerPersonalQuestion('where do I work');
    const identity = reloaded.answerPersonalQuestion('tell me about myself');
    const summary = reloaded.getUserIdentitySummary();

    assert.equal(location.known, true);
    assert.equal(location.fact, 'location');
    assert.match(location.response, /Hyderabad/);
    assert.equal(phone.known, true);
    assert.equal(phone.fact, 'phone');
    assert.match(phone.response, /9876543210/);
    assert.equal(school.fact, 'school');
    assert.match(school.response, /OpenX University/);
    assert.equal(work.fact, 'workplace');
    assert.match(work.response, /Stark Labs/);
    assert.match(identity.response, /you live in Hyderabad/);
    assert.match(summary, /location: Hyderabad/);
    assert.match(summary, /school: OpenX University/);
  });

  it('should preserve validation and verification evidence on feedback records', function() {
    const { store } = createStore();

    store.recordFeedback({
      input: 'create report.txt',
      routedInput: 'create report.txt',
      intent: 'file.create',
      success: false,
      rating: 'negative',
      note: 'Expected file was not found',
      languageUnderstanding: { status: 'passed', intent: 'file.create' },
      validation: { status: 'passed', check: 'required-entities' },
      verification: { status: 'failed', check: 'file-exists' }
    });

    const snapshot = store.getSnapshot();
    assert.equal(snapshot.feedback[0].languageUnderstanding.intent, 'file.create');
    assert.equal(snapshot.feedback[0].validation.status, 'passed');
    assert.equal(snapshot.feedback[0].verification.status, 'failed');
    assert.equal(snapshot.mistakes[0].verification.check, 'file-exists');
  });
});
