const fs = require('fs');
const path = require('path');
const Logger = require('../../shared/index').Logger;
const Validator = require('../../shared/index').Validator;
const {
  findEntryByName,
  getHomeDirectory,
  getSpecialFolders,
  normalizeLocation,
  resolveDestinationPath,
  resolveDirectory,
  splitNameAndLocation
} = require('../common/path-utils');
const { launchTarget } = require('../common/launcher');

class FolderController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
  }

  _resolveFolderPath(folderName, targetPath = null) {
    if (!folderName) return null;

    if (path.isAbsolute(folderName) && fs.existsSync(folderName) && fs.statSync(folderName).isDirectory()) {
      return path.resolve(folderName);
    }

    const parsed = splitNameAndLocation(folderName);
    const requestedName = parsed.name || folderName;
    const explicitDirectory = targetPath || parsed.location;

    const specialFolders = getSpecialFolders();
    const asSpecialFolder = specialFolders[normalizeLocation(requestedName)];
    if (asSpecialFolder && fs.existsSync(asSpecialFolder)) {
      return asSpecialFolder;
    }

    const safeName = Validator.sanitizePath(requestedName);

    if (explicitDirectory) {
      const baseDir = resolveDirectory(explicitDirectory, { mustExist: true });
      if (!baseDir) return null;

      const candidate = path.join(baseDir, safeName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }

      return null;
    }

    return findEntryByName(safeName, {
      roots: [process.cwd(), getHomeDirectory(), ...Object.values(getSpecialFolders())],
      type: 'directory'
    });
  }

  create(folderName, targetPath) {
    if (!folderName) {
      return { success: false, error: 'No folder name provided' };
    }

    const safeName = Validator.sanitizePath(folderName);
    if (!Validator.isValidFilename(safeName)) {
      return { success: false, error: 'Invalid folder name' };
    }

    const dir = resolveDirectory(targetPath, { mustExist: false }) || getHomeDirectory();
    const fullPath = path.join(dir, safeName);

    try {
      if (fs.existsSync(fullPath)) {
        return { success: false, error: 'Folder already exists' };
      }

      fs.mkdirSync(fullPath, { recursive: true });
      return { success: true, data: { path: fullPath, folderName: safeName } };
    } catch (err) {
      this.logger.error('Failed to create folder', err);
      return { success: false, error: err.message };
    }
  }

  delete(folderName, targetPath = null) {
    if (!folderName) {
      return { success: false, error: 'No folder name provided' };
    }

    try {
      const fullPath = this._resolveFolderPath(folderName, targetPath);
      if (!fullPath) {
        return { success: false, error: 'Folder not found' };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path is a file, use file operations' };
      }

      fs.rmSync(fullPath, { recursive: true, force: true });
      return { success: true, data: { path: fullPath, folderName: path.basename(fullPath) } };
    } catch (err) {
      this.logger.error('Failed to delete folder', err);
      return { success: false, error: err.message };
    }
  }

  move(source, destination) {
    if (!source || !destination) {
      return { success: false, error: 'Source and destination required' };
    }

    try {
      const sourcePath = this._resolveFolderPath(source);
      if (!sourcePath) {
        return { success: false, error: 'Source folder not found' };
      }

      const finalPath = resolveDestinationPath(destination, sourcePath, { type: 'directory' });
      if (!finalPath) {
        return { success: false, error: 'Destination could not be resolved' };
      }

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });

      try {
        fs.renameSync(sourcePath, finalPath);
      } catch (err) {
        fs.cpSync(sourcePath, finalPath, { recursive: true, force: true });
        fs.rmSync(sourcePath, { recursive: true, force: true });
      }

      return { success: true, data: { source: sourcePath, destination: finalPath } };
    } catch (err) {
      this.logger.error('Failed to move folder', err);
      return { success: false, error: err.message };
    }
  }

  open(folderName) {
    if (!folderName) {
      return { success: false, error: 'No folder name provided' };
    }

    try {
      const fullPath = this._resolveFolderPath(folderName);
      if (!fullPath) {
        return { success: false, error: 'Folder not found' };
      }

      launchTarget(fullPath);
      return { success: true, data: { path: fullPath, folderName: path.basename(fullPath) } };
    } catch (err) {
      this.logger.error('Failed to open folder', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = FolderController;
