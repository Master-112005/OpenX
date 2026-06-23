const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Assistant Data Root', function() {
  let dataRoot;

  before(function() {
    dataRoot = require('../../core/assistant/Data');
  });

  it('should default assistant-owned data to OpenX_Data', function() {
    const paths = dataRoot.buildDataPaths({});

    assert.equal(path.basename(paths.root), 'OpenX_Data');
    assert.equal(paths.settingsPath, path.join(paths.root, 'settings.json'));
    assert.equal(paths.learningPath, path.join(paths.root, 'learning.json'));
    assert.equal(paths.learningDir, path.join(paths.root, 'learning'));
    assert.equal(paths.logsDir, path.join(paths.root, 'logs'));
    assert.equal(paths.mediaProfileDir, path.join(paths.root, 'runtime', 'chrome-media-profile'));
  });

  it('should keep managed paths under a configured data root', function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-root-'));
    const paths = dataRoot.ensureDataRoot({ app: { dataDir: tempDir } });

    assert.equal(paths.root, tempDir);
    assert.ok(fs.existsSync(paths.root));
    assert.ok(fs.existsSync(paths.logsDir));
    assert.ok(fs.existsSync(paths.learningDir));
    assert.ok(fs.existsSync(paths.runtimeDir));
    assert.ok(fs.existsSync(paths.cacheDir));
    assert.ok(fs.existsSync(paths.mediaProfileDir));
  });

  it('should purge deprecated contact-store files from managed data', function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-contact-purge-'));
    fs.writeFileSync(path.join(tempDir, 'contacts.json'), '{"old":true}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'contacts.json.bak'), '{"old":true}', 'utf8');

    dataRoot.ensureDataRoot({ app: { dataDir: tempDir } });

    assert.equal(fs.existsSync(path.join(tempDir, 'contacts.json')), false);
    assert.equal(fs.existsSync(path.join(tempDir, 'contacts.json.bak')), false);
  });

  it('should copy legacy assistant files into the managed data root without overwriting', function() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-new-'));
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-data-legacy-'));
    fs.writeFileSync(path.join(legacyDir, 'settings.json'), '{"assistant":{"displayName":"Old"}}', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'learning.json'), '{"version":1}', 'utf8');

    const result = dataRoot.migrateLegacyData({
      app: {
        dataDir,
        legacyDataDir: legacyDir,
        migrateLegacyData: true
      }
    });

    assert.equal(result.migrated.length, 2);
    assert.ok(fs.existsSync(path.join(dataDir, 'settings.json')));
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

  it('should recover JSON files from backup when the primary file is corrupt', function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-json-recover-'));
    const filePath = path.join(tempDir, 'settings.json');

    dataRoot.writeJsonAtomic(filePath, { assistant: { displayName: 'Stable' } });
    dataRoot.writeJsonAtomic(filePath, { assistant: { displayName: 'Current' } });
    fs.writeFileSync(filePath, '{bad json', 'utf8');

    const recovered = dataRoot.readJsonFile(filePath, {});

    assert.equal(recovered.assistant.displayName, 'Stable');
    assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).assistant.displayName, 'Stable');
    assert.ok(fs.readdirSync(tempDir).some(name => /^settings\.json\.corrupt-/.test(name)));
  });

  it('should quarantine corrupt JSON and recreate a fallback when no backup can be used', function() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-json-fallback-'));
    const filePath = path.join(tempDir, 'state.json');

    fs.writeFileSync(filePath, '{bad json', 'utf8');
    const recovered = dataRoot.readJsonFile(filePath, { items: [] });

    assert.deepEqual(recovered, { items: [] });
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), { items: [] });
    assert.ok(fs.readdirSync(tempDir).some(name => /^state\.json\.corrupt-/.test(name)));
  });
});
