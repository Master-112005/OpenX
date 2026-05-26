const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AutomationEngine = require('../../core/automation/index');
const ActionRouter = require('../../core/assistant/router/index');

describe('File Management Automation', function() {
  this.timeout(10000);

  const originalUserProfile = process.env.USERPROFILE;
  let tempProfile;
  let engine;
  let router;

  function makeConfig() {
    return {
      permissions: {
        levels: {
          low: { requiresConfirmation: false, requiresAuth: false },
          medium: { requiresConfirmation: false, requiresAuth: false },
          high: { requiresConfirmation: false, requiresAuth: false },
          critical: { requiresConfirmation: false, requiresAuth: false }
        }
      },
      logging: { level: 'error' }
    };
  }

  beforeEach(function() {
    tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-files-'));
    process.env.USERPROFILE = tempProfile;

    ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'].forEach(folder => {
      fs.mkdirSync(path.join(tempProfile, folder), { recursive: true });
    });

    engine = new AutomationEngine(makeConfig());
    router = new ActionRouter(makeConfig(), engine);
    router.permissionValidator.setUserLevel('high');
  });

  afterEach(function() {
    process.env.USERPROFILE = originalUserProfile;
    fs.rmSync(tempProfile, { recursive: true, force: true });
  });

  it('should create a file on the desktop from a natural-language command', async function() {
    const result = await router.process('Create file report.pdf on desktop', 'chat');
    const expectedPath = path.join(tempProfile, 'Desktop', 'report.pdf');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.create');
    assert.equal(result.entities.filename, 'report.pdf');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(fs.existsSync(expectedPath), true);
  });

  it('should delete a file from the desktop from a natural-language command', async function() {
    const targetPath = path.join(tempProfile, 'Desktop', 'practice.java');
    fs.writeFileSync(targetPath, 'class Practice {}', 'utf8');

    const result = await router.process('delete practice.java file from desktop', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.delete');
    assert.equal(result.entities.filename, 'practice.java');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(fs.existsSync(targetPath), false);
  });

  it('should move a file between special folders', async function() {
    const sourcePath = path.join(tempProfile, 'Desktop', 'notes.txt');
    const destinationPath = path.join(tempProfile, 'Downloads', 'notes.txt');
    fs.writeFileSync(sourcePath, 'todo', 'utf8');

    const result = await router.process('move notes.txt from desktop to downloads', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.move');
    assert.equal(fs.existsSync(sourcePath), false);
    assert.equal(fs.existsSync(destinationPath), true);
  });

  it('should move a file when the command includes a leading article', async function() {
    const sourcePath = path.join(tempProfile, 'Desktop', 'practice.java');
    const destinationPath = path.join(tempProfile, 'Downloads', 'practice.java');
    fs.writeFileSync(sourcePath, 'class Practice {}', 'utf8');

    const result = await router.process('move the practice.java from desktop into downloads', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.move');
    assert.equal(fs.existsSync(sourcePath), false);
    assert.equal(fs.existsSync(destinationPath), true);
  });

  it('should create a folder on the desktop', async function() {
    const result = await router.process('create folder Projects on desktop', 'chat');
    const expectedPath = path.join(tempProfile, 'Desktop', 'Projects');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'folder.create');
    assert.equal(result.entities.folderName, 'Projects');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(fs.existsSync(expectedPath), true);
    assert.equal(fs.statSync(expectedPath).isDirectory(), true);
  });

  it('should delete a folder from the desktop', async function() {
    const targetPath = path.join(tempProfile, 'Desktop', 'Practice');
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'notes.txt'), 'content', 'utf8');

    const result = await router.process('delete folder Practice from desktop', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'folder.delete');
    assert.equal(result.entities.folderName, 'Practice');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(fs.existsSync(targetPath), false);
  });

  it('should move a folder between special folders', async function() {
    const sourcePath = path.join(tempProfile, 'Desktop', 'Archive');
    const destinationPath = path.join(tempProfile, 'Documents', 'Archive');
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(path.join(sourcePath, 'keep.txt'), 'data', 'utf8');

    const result = await router.process('move folder Archive from desktop to documents', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'folder.move');
    assert.equal(fs.existsSync(sourcePath), false);
    assert.equal(fs.existsSync(destinationPath), true);
    assert.equal(fs.existsSync(path.join(destinationPath, 'keep.txt')), true);
  });
});
