'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_ROOT_NAME = 'OpenX_Data';
const LEGACY_DATA_ROOT_NAME = '.jarvis';

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
  fs.copyFileSync(sourcePath, targetPath);
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
  migrateLegacyData
};
