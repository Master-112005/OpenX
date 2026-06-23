'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ActiveLearningManager = require('../../core/assistant/active-learning/ActiveLearningManager');

describe('Active Learning v2', function() {
  function createManager() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-learning-v2-'));
    return {
      dataDir,
      manager: new ActiveLearningManager({
        app: { dataDir },
        activeLearning: { enabled: true }
      })
    };
  }

  it('stores only the five JSON stores under the managed learning directory', function() {
    const { dataDir, manager } = createManager();
    const learningDir = path.join(dataDir, 'learning');

    assert.equal(manager.getLearningPath(), learningDir);
    assert.deepEqual(fs.readdirSync(learningDir).sort(), [
      'aliases.json',
      'corrections.json',
      'preferences.json',
      'usage_stats.json',
      'workflows.json'
    ]);
  });

  it('asks on the third alias occurrence but persists only after approval', function() {
    const { dataDir, manager } = createManager();

    assert.equal(manager.learnAlias('code', 'Code.exe').stage, 'ignored');
    assert.equal(manager.learnAlias('code', 'Code.exe').stage, 'observing');
    assert.equal(manager.learnAlias('code', 'Code.exe').stage, 'ready_to_learn');

    const beforeApproval = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'learning', 'aliases.json'), 'utf8')
    );
    assert.deepEqual(beforeApproval.aliases, {});
    assert.equal(manager.getPendingSuggestions().aliases.length, 1);

    assert.equal(manager.approveAlias('code', 'Code.exe').success, true);
    assert.equal(manager.resolveAlias('code').target, 'Code.exe');
  });

  it('does not overwrite an approved correction without another approval', function() {
    const { manager } = createManager();
    assert.equal(manager.approveCorrection('open code', 'open vscode').success, true);

    manager.recordCorrection('open code', 'open visual studio');
    manager.recordCorrection('open code', 'open visual studio');
    assert.equal(
      manager.recordCorrection('open code', 'open visual studio').stage,
      'ready_to_learn'
    );
    assert.equal(manager.resolveCorrection('open code').resolved, 'open vscode');
  });

  it('blocks sensitive values from every persisted learning category', function() {
    const { manager } = createManager();

    assert.equal(manager.approveAlias('login', 'rakesh@example.com').success, false);
    assert.equal(manager.setPreference('browser', 'my password is hunter2').success, false);
    assert.equal(manager.approveCorrection('contact me', 'email rakesh@example.com').success, false);
    assert.equal(manager.approveWorkflow('private_flow', [
      'open browser',
      'email rakesh@example.com'
    ]).success, false);
    assert.equal(manager.recordUsage('rakesh@example.com').success, false);
  });

  it('quarantines invalid schemas and recreates a usable store', function() {
    const { dataDir } = createManager();
    const aliasPath = path.join(dataDir, 'learning', 'aliases.json');
    fs.writeFileSync(aliasPath, JSON.stringify({ aliases: [] }), 'utf8');

    const reloaded = new ActiveLearningManager({ app: { dataDir } });

    assert.deepEqual(reloaded.getAllAliases(), {});
    assert.ok(fs.readdirSync(path.dirname(aliasPath)).some(name =>
      /^aliases\.json\.corrupt-/.test(name)
    ));
    assert.equal(JSON.parse(fs.readFileSync(aliasPath, 'utf8')).version, 1);
  });

  it('recovers the prior valid state when the primary JSON is corrupted', function() {
    const { dataDir, manager } = createManager();
    manager.approveAlias('code', 'Code.exe');
    manager.approveAlias('browser', 'chrome.exe');
    const aliasPath = path.join(dataDir, 'learning', 'aliases.json');
    fs.writeFileSync(aliasPath, '{bad json', 'utf8');

    const reloaded = new ActiveLearningManager({ app: { dataDir } });

    assert.equal(reloaded.resolveAlias('code').target, 'Code.exe');
    assert.equal(reloaded.resolveAlias('browser'), null);
  });

  it('does not leave temporary files after atomic writes', function() {
    const { dataDir, manager } = createManager();
    manager.setPreference('browser', 'chrome');
    manager.recordUsage('chrome');

    assert.equal(
      fs.readdirSync(path.join(dataDir, 'learning')).some(name => name.endsWith('.tmp')),
      false
    );
  });
});
