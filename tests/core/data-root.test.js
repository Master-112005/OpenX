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
    assert.equal(paths.schedulesPath, path.join(paths.root, 'schedules.json'));
    assert.equal(paths.plannerPath, path.join(paths.root, 'planner.json'));
    assert.equal(paths.screenshotsDir, path.join(paths.root, 'screenshots'));
    assert.equal(paths.learningDir, path.join(paths.root, 'learning'));
    assert.equal(paths.logsDir, path.join(paths.root, 'logs'));
    assert.equal(paths.mediaProfileDir, path.join(paths.root, 'runtime', 'chrome-media-profile'));
    assert.equal(paths.voiceDir, path.join(paths.root, 'voice'));
    assert.equal(paths.voiceDiagnosticsDir, path.join(paths.voiceDir, 'diagnostics'));
    assert.equal(paths.phoneDir, path.join(paths.root, 'phone'));
    assert.equal(paths.phoneReceivedDir, path.join(paths.phoneDir, 'received'));
    assert.equal(paths.phoneTempDir, path.join(paths.root, 'runtime', 'phone-transfer'));
    assert.equal(paths.phoneDevicesPath, path.join(paths.phoneDir, 'devices.json'));
    assert.equal(paths.phonePairingPath, path.join(paths.phoneDir, 'pairing.json'));
    assert.equal(paths.phonePermissionsPath, path.join(paths.phoneDir, 'permissions.json'));
    assert.equal(paths.phoneTransferHistoryPath, path.join(paths.phoneDir, 'transfer-history.json'));
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
    assert.ok(fs.existsSync(paths.screenshotsDir));
    assert.ok(fs.existsSync(paths.voiceDiagnosticsDir));
    assert.ok(fs.existsSync(paths.phoneDir));
    assert.ok(fs.existsSync(paths.phoneReceivedDir));
    assert.ok(fs.existsSync(paths.phoneTempDir));
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
    fs.writeFileSync(path.join(legacyDir, 'schedules.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'planner.json'), '[]', 'utf8');

    const result = dataRoot.migrateLegacyData({
      app: {
        dataDir,
        legacyDataDir: legacyDir,
        migrateLegacyData: true
      }
    });

    assert.equal(result.migrated.length, 4);
    assert.ok(fs.existsSync(path.join(dataDir, 'settings.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'learning.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'schedules.json')));
    assert.ok(fs.existsSync(path.join(dataDir, 'planner.json')));

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

  it('should merge accidental root JSON arrays into managed data and remove the source', function() {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-source-json-'));
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-target-json-'));
    const sourcePath = path.join(sourceDir, 'schedules.json');
    const targetPath = path.join(targetDir, 'schedules.json');
    dataRoot.writeJsonAtomic(targetPath, [{ id: 'existing' }], { backup: false });
    fs.writeFileSync(sourcePath, JSON.stringify([{ id: 'legacy' }, { id: '' }]), 'utf8');

    const result = dataRoot.migrateJsonArrayFile(sourcePath, targetPath, {
      limit: 5,
      normalizeItem: item => item?.id ? item : null
    });

    assert.equal(result.migrated.length, 1);
    assert.equal(fs.existsSync(sourcePath), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), [
      { id: 'existing' },
      { id: 'legacy' }
    ]);
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
