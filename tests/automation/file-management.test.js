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

  it('should list files on the desktop from a local question', async function() {
    fs.writeFileSync(path.join(tempProfile, 'Desktop', 'notes.txt'), 'todo', 'utf8');
    fs.mkdirSync(path.join(tempProfile, 'Desktop', 'Projects'), { recursive: true });

    const result = await router.process('what files are on desktop', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.list');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(result.data.count, 2);
    assert.deepEqual(result.data.entries.map(entry => entry.name), ['Projects', 'notes.txt']);
  });

  it('should list only requested file types from a local question', async function() {
    fs.writeFileSync(path.join(tempProfile, 'Desktop', 'report.pdf'), 'pdf', 'utf8');
    fs.writeFileSync(path.join(tempProfile, 'Desktop', 'notes.txt'), 'todo', 'utf8');

    const result = await router.process('what are the pdfs on the desktop', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.list');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(result.entities.fileType, 'pdf');
    assert.equal(result.data.count, 1);
    assert.deepEqual(result.data.entries.map(entry => entry.name), ['report.pdf']);
  });

  it('should delete named files without requiring the word file', async function() {
    const targetPath = path.join(tempProfile, 'Desktop', 'farmcast.pdf');
    fs.writeFileSync(targetPath, 'pdf', 'utf8');

    const result = await router.process('delete farmcast pdf on the desktop', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'file.delete');
    assert.equal(result.entities.filename, 'farmcast.pdf');
    assert.equal(result.entities.path, 'desktop');
    assert.equal(fs.existsSync(targetPath), false);
  });

  it('should preserve multi-word filenames and match partial spoken names', async function() {
    const targetPath = path.join(tempProfile, 'Desktop', 'FarmCast Complete Static Analysis.pdf');
    fs.writeFileSync(targetPath, 'pdf', 'utf8');

    const explicit = await router.process('delete FarmCast Complete Static Analysis.pdf on the desktop', 'chat');

    assert.equal(explicit.success, true);
    assert.equal(explicit.entities.filename, 'FarmCast Complete Static Analysis.pdf');
    assert.equal(fs.existsSync(targetPath), false);

    fs.writeFileSync(targetPath, 'pdf', 'utf8');
    const partial = await router.process('delete the farmcast pdf on the desktop', 'chat');

    assert.equal(partial.success, true);
    assert.equal(partial.entities.filename, 'farmcast.pdf');
    assert.equal(fs.existsSync(targetPath), false);
  });

  it('should fuzzy match spoken pdf names across common folders without an explicit location', function() {
    const targetPath = path.join(tempProfile, 'Desktop', 'FarmCast Complete Static Analysis.pdf');
    fs.writeFileSync(targetPath, 'pdf', 'utf8');

    const resolvedPath = engine.files._resolveFilePath('farmcat.pdf');

    assert.equal(resolvedPath, targetPath);
  });

  it('should open a matching folder when no app is found', async function() {
    const folderPath = path.join(tempProfile, 'OpenX');
    fs.mkdirSync(folderPath, { recursive: true });
    engine.apps.open = () => ({ success: false, error: 'Could not find app: openx' });
    engine.folders.open = (folderName) => {
      assert.equal(folderName, 'openx');
      return { success: true, data: { path: folderPath, folderName: 'OpenX' } };
    };

    const result = await router.process('open openx', 'chat');

    assert.equal(result.success, true);
    assert.equal(result.intent, 'app.open');
    assert.equal(result.data.launchMethod, 'folder');
    assert.equal(result.data.folderName, 'OpenX');
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

  it('should ask which same-name folder to open across subfolders', function() {
    const firstPath = path.join(tempProfile, 'Documents', 'Projects', 'Screenshots');
    const secondPath = path.join(tempProfile, 'Pictures', 'Archive', 'Screenshots');
    fs.mkdirSync(firstPath, { recursive: true });
    fs.mkdirSync(secondPath, { recursive: true });

    const result = engine.folders.open('Screenshots');

    assert.equal(result.success, false);
    assert.equal(result.needsClarification, true);
    assert.equal(result.data.matchCount, 2);
    assert.deepEqual(
      result.data.choices.map(choice => choice.path).sort(),
      [firstPath, secondPath].sort()
    );
  });

  it('should search files recursively inside common folders', function() {
    const nested = path.join(tempProfile, 'Documents', 'Projects', 'Reports');
    fs.mkdirSync(nested, { recursive: true });
    const target = path.join(nested, 'Resume.docx');
    fs.writeFileSync(target, 'resume', 'utf8');

    const result = engine.files.search('Resume.docx');

    assert.equal(result.success, true);
    assert.ok(result.data.results.includes(target));
  });

  it('should skip excluded heavy folders during recursive search', function() {
    const validDir = path.join(tempProfile, 'Documents', 'Projects');
    const excludedDir = path.join(tempProfile, 'Documents', 'node_modules', 'cache');
    fs.mkdirSync(validDir, { recursive: true });
    fs.mkdirSync(excludedDir, { recursive: true });

    const validTarget = path.join(validDir, 'Resume.docx');
    const excludedTarget = path.join(excludedDir, 'Resume.docx');
    fs.writeFileSync(validTarget, 'resume', 'utf8');
    fs.writeFileSync(excludedTarget, 'dependency copy', 'utf8');

    const result = engine.files.search('Resume.docx');

    assert.equal(result.success, true);
    assert.ok(result.data.results.includes(validTarget));
    assert.equal(result.data.results.includes(excludedTarget), false);
    assert.ok(result.data.searchStats.skippedDirectories >= 1);
  });

  it('should return bounded partial search stats instead of scanning forever', function() {
    const result = engine.files.search('file-that-does-not-exist.docx', {
      maxDirectories: 1,
      maxElapsedMs: 10000
    });

    assert.equal(result.success, true);
    assert.equal(result.data.searchStats.partial, true);
    assert.equal(result.data.searchStats.partialReason, 'directory-limit');
    assert.ok(result.data.searchStats.visitedDirectories >= 1);
  });

  it('should include smart file search stats for validation feedback', function() {
    const targetDir = path.join(tempProfile, 'Downloads');
    const target = path.join(targetDir, 'Latest Notes.pdf');
    fs.writeFileSync(target, 'pdf', 'utf8');

    const result = engine.files.smartFind({
      location: 'downloads',
      fileType: 'pdf',
      sortBy: 'createdDesc'
    });

    assert.equal(result.success, true);
    assert.equal(result.data.entries[0].path, target);
    assert.equal(result.data.searchStats.kind, 'file.smartFind');
    assert.ok(result.data.searchStats.visitedDirectories >= 1);
  });

  it('should match compact and spaced file search names', function() {
    const nested = path.join(tempProfile, 'Documents', 'College');
    fs.mkdirSync(nested, { recursive: true });
    const target = path.join(nested, 'DLNLP Lab Manual.docx');
    fs.writeFileSync(target, 'manual', 'utf8');

    const compact = engine.files.search('dlnlp labmanual');
    const spaced = engine.files.search('dlnlp lab manual.docx');

    assert.equal(compact.success, true);
    assert.ok(compact.data.results.includes(target));
    assert.equal(compact.data.entries.find(entry => entry.path === target).type, 'file');
    assert.ok(spaced.data.results.includes(target));
  });

  it('should fuzzy match unique folder open requests without exact folder names', function() {
    const target = path.join(tempProfile, 'Documents', 'Projects', 'DLNLP Node Folder');
    fs.mkdirSync(target, { recursive: true });

    const result = engine.folders.open('dlnlpnode');

    assert.equal(result.success, true);
    assert.equal(result.data.path, target);
    assert.equal(result.data.folderName, 'DLNLP Node Folder');
  });

  it('should block deleting absolute files outside the user profile', function() {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outside-file-'));
    const outsideFile = path.join(outsideDir, 'do-not-delete.txt');
    fs.writeFileSync(outsideFile, 'keep', 'utf8');

    try {
      const result = engine.files.delete(outsideFile);

      assert.equal(result.success, false);
      assert.match(result.error, /outside allowed user folders|protected system paths|not allowed/i);
      assert.equal(fs.existsSync(outsideFile), true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('should block recursive folder deletion outside the user profile', function() {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-outside-folder-'));
    fs.writeFileSync(path.join(outsideDir, 'do-not-delete.txt'), 'keep', 'utf8');

    try {
      const result = engine.folders.delete(outsideDir);

      assert.equal(result.success, false);
      assert.match(result.error, /outside allowed user folders|protected system paths|not allowed/i);
      assert.equal(fs.existsSync(outsideDir), true);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('should ask which same-name file to open across subfolders', function() {
    const firstDir = path.join(tempProfile, 'Documents', 'Jobs');
    const secondDir = path.join(tempProfile, 'Downloads', 'Backup');
    fs.mkdirSync(firstDir, { recursive: true });
    fs.mkdirSync(secondDir, { recursive: true });
    const firstPath = path.join(firstDir, 'Resume.docx');
    const secondPath = path.join(secondDir, 'Resume.docx');
    fs.writeFileSync(firstPath, 'one', 'utf8');
    fs.writeFileSync(secondPath, 'two', 'utf8');

    const result = engine.files.open('Resume.docx');

    assert.equal(result.success, false);
    assert.equal(result.needsClarification, true);
    assert.equal(result.data.matchCount, 2);
    assert.deepEqual(
      result.data.choices.map(choice => choice.path).sort(),
      [firstPath, secondPath].sort()
    );
  });
});
