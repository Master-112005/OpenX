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
});
