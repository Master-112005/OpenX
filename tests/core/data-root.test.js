const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Assistant Data Root', function() {
  let dataRoot;

  before(function() {
    dataRoot = require('../../core/shared/data-root');
  });

  it('should default assistant-owned data to OpenX_Data', function() {
    const paths = dataRoot.buildDataPaths({});

    assert.equal(path.basename(paths.root), 'OpenX_Data');
    assert.equal(paths.settingsPath, path.join(paths.root, 'settings.json'));
    assert.equal(paths.contactsPath, path.join(paths.root, 'contacts.json'));
    assert.equal(paths.learningPath, path.join(paths.root, 'learning.json'));
    assert.equal(paths.logsDir, path.join(paths.root, 'logs'));
    assert.equal(paths.mediaProfileDir, path.join(paths.root, 'runtime', 'chrome-media-profile'));
  });

  it('should keep managed paths under a configured data root', function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-root-'));
    const paths = dataRoot.ensureDataRoot({ app: { dataDir: tempDir } });

    assert.equal(paths.root, tempDir);
    assert.ok(fs.existsSync(paths.root));
    assert.ok(fs.existsSync(paths.logsDir));
    assert.ok(fs.existsSync(paths.runtimeDir));
    assert.ok(fs.existsSync(paths.cacheDir));
    assert.ok(fs.existsSync(paths.mediaProfileDir));
  });

  it('should copy legacy assistant files into the managed data root without overwriting', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-new-'));
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-legacy-'));
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"assistant":{"displayName":"Old"}}', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'contacts.json'), '{"dad":{"phone":"1234567"}}', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'learning.json'), '{"version":1}', 'utf8');

    const result = dataRoot.migrateLegacyData({
      app: {
        dataDir,
        legacyDataDir: legacyDir,
        migrateLegacyData: true
      }
    });

    assert.equal(result.migrated.length, 3);
    assert.ok(fs.existsSync(path.join(dataDir, 'settings.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'contacts.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'learning.json')));

    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"assistant":{"displayName":"Changed"}}', 'utf8');
    const second = dataRoot.migrateLegacyData({
      app: {
        dataDir,
        legacyDataDir: legacyDir,
        migrateLegacyData: true
      }
    });

    assert.equal(second.migrated.length, 0);
    assert.match(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'), /Old/);
  });
});
