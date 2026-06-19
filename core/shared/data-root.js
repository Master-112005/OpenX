'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_ROOT_NAME = 'OpenX_Data';
const LEGACY_DATA_ROOT_NAME = '.jarvis';
const JSON_BACKUP_SUFFIX = '.bak';

function resolveDataRoot(config = {}) {
  const configured = String(config?.app?.dataDir || process.env.OPENX_DATA_DIR || '').trim();
  return path.resolve(configured || path.join(os.homedir(), DATA_ROOT_NAME));
}

function resolveLegacyDataRoot(config = {}) {
  const configured = String(config?.app?.legacyDataDir || '').trim();
  return path.resolve(configured || path.join(os.homedir(), LEGACY_DATA_ROOT_NAME));
}

function buildDataPaths(config = {}) {
  const root = resolveDataRoot(config);
  const runtimeDir = path.join(root, 'runtime');

  return {
    root,
    settingsPath: path.join(root, 'settings.json'),
    contactsPath: path.join(root, 'contacts.json'),
    learningPath: path.join(root, 'learning.json'),
    logsDir: path.join(root, 'logs'),
    runtimeDir,
    cacheDir: path.join(root, 'cache'),
    mediaProfileDir: path.join(runtimeDir, 'chrome-media-profile')
  };
}

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeBackupPath(filePath) {
  return `${filePath}${JSON_BACKUP_SUFFIX}`;
}

function writeFileAtomic(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  let fd = null;
  try {
    fd = fs.openSync(tempPath, 'w');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {
        // Best effort cleanup below handles the temp file.
      }
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_) {
      // Leave cleanup to the next maintenance pass if Windows still holds it.
    }
    throw err;
  }
}

function writeJsonAtomic(filePath, value, options = {}) {
  const spacing = Number.isInteger(options.spacing) ? options.spacing : 2;
  const backup = options.backup !== false;
  ensureDirectory(path.dirname(filePath));

  if (backup && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, safeBackupPath(filePath));
  }

  writeFileAtomic(filePath, `${JSON.stringify(value, null, spacing)}\n`);
}

function readJsonFile(filePath, fallbackValue = {}, options = {}) {
  const fallback = typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue;
  const backupPath = safeBackupPath(filePath);
  const preserveCorrupt = options.preserveCorrupt !== false;

  const parsePath = sourcePath => {
    const source = fs.readFileSync(sourcePath, 'utf8').trim();
    if (!source) {
      return fallback;
    }
    return JSON.parse(source);
  };

  if (!fs.existsSync(filePath)) {
    if (options.createIfMissing !== false) {
      writeJsonAtomic(filePath, fallback, { backup: false, spacing: options.spacing });
    }
    return fallback;
  }

  try {
    return parsePath(filePath);
  } catch (primaryError) {
    if (preserveCorrupt) {
      const corruptPath = `${filePath}.corrupt-${timestampForFilename()}`;
      try {
        fs.renameSync(filePath, corruptPath);
      } catch (_) {
        // If the file is locked, keep going and try the backup.
      }
    }

    if (fs.existsSync(backupPath)) {
      try {
        const recovered = parsePath(backupPath);
        writeJsonAtomic(filePath, recovered, { backup: false, spacing: options.spacing });
        return recovered;
      } catch (_) {
        // Fall through to a clean fallback file.
      }
    }

    writeJsonAtomic(filePath, fallback, { backup: false, spacing: options.spacing });
    return fallback;
  }
}

function ensureDataRoot(config = {}) {
  const paths = buildDataPaths(config);
  [
    paths.root,
    paths.logsDir,
    paths.runtimeDir,
    paths.cacheDir,
    paths.mediaProfileDir
  ].forEach(ensureDirectory);
  return paths;
}

function copyFileIfMissing(sourcePath, targetPath, migrated, skipped) {
  if (!fs.existsSync(sourcePath)) {
    skipped.push({ sourcePath, reason: 'missing-source' });
    return;
  }

  if (fs.existsSync(targetPath)) {
    skipped.push({ sourcePath, targetPath, reason: 'target-exists' });
    return;
  }

  ensureDirectory(path.dirname(targetPath));
  const content = fs.readFileSync(sourcePath, 'utf8');
  writeFileAtomic(targetPath, content);
  migrated.push({ sourcePath, targetPath });
}

function migrateLegacyData(config = {}) {
  const paths = ensureDataRoot(config);
  const legacyRoot = resolveLegacyDataRoot(config);
  const migrated = [];
  const skipped = [];

  if (path.resolve(legacyRoot) === path.resolve(paths.root)) {
    return { dataRoot: paths.root, legacyRoot, migrated, skipped };
  }

  if (!fs.existsSync(legacyRoot)) {
    return { dataRoot: paths.root, legacyRoot, migrated, skipped };
  }

  copyFileIfMissing(path.join(legacyRoot, 'settings.json'), paths.settingsPath, migrated, skipped);
  copyFileIfMissing(path.join(legacyRoot, 'contacts.json'), paths.contactsPath, migrated, skipped);
  copyFileIfMissing(path.join(legacyRoot, 'learning.json'), paths.learningPath, migrated, skipped);

  return { dataRoot: paths.root, legacyRoot, migrated, skipped };
}

module.exports = {
  DATA_ROOT_NAME,
  LEGACY_DATA_ROOT_NAME,
  resolveDataRoot,
  resolveLegacyDataRoot,
  buildDataPaths,
  ensureDataRoot,
  readJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
  migrateLegacyData
};
