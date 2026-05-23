const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const Validator = require('../../shared/index').Validator;
const {
  findEntryByName,
  getHomeDirectory,
  getSpecialFolders,
  resolveDestinationPath,
  resolveDirectory,
  splitNameAndLocation
} = require('../common/path-utils');
const { launchTarget } = require('../common/launcher');

const SEARCH_ROOTS = () => [
  process.cwd(),
  ...Object.values(getSpecialFolders()),
  getHomeDirectory()
].filter(Boolean);

class FileController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
  }

  _resolveFilePath(filename, targetPath = null) {
    if (!filename) return null;

    if (path.isAbsolute(filename) && fs.existsSync(filename) && fs.statSync(filename).isFile()) {
      return path.resolve(filename);
    }

    const source = splitNameAndLocation(filename);
    const safeName = Validator.sanitizePath(source.name || filename);
    const explicitDirectory = targetPath || source.location;

    if (explicitDirectory) {
      const dir = resolveDirectory(explicitDirectory, { mustExist: true });
      if (!dir) return null;

      const candidate = path.join(dir, safeName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }

      return null;
    }

    return findEntryByName(safeName, {
      roots: SEARCH_ROOTS(),
      type: 'file'
    });
  }

  create(filename, targetPath) {
    if (!filename) {
      return { success: false, error: 'Invalid filename' };
    }

    const safeName = Validator.sanitizePath(filename);
    if (!Validator.isValidFilename(safeName)) {
      return { success: false, error: 'Invalid filename' };
    }

    const dir = resolveDirectory(targetPath, { mustExist: false }) || getHomeDirectory();
    const fullPath = path.join(dir, safeName);

    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      if (fs.existsSync(fullPath)) {
        return { success: false, error: 'File already exists' };
      }

      fs.writeFileSync(fullPath, '', 'utf8');
      return { success: true, data: { path: fullPath, filename: safeName } };
    } catch (err) {
      this.logger.error('Failed to create file', err);
      return { success: false, error: err.message };
    }
  }

  open(filename, targetPath = null) {
    if (!filename) {
      return { success: false, error: 'No filename provided' };
    }

    try {
      const fullPath = this._resolveFilePath(filename, targetPath);
      if (!fullPath) {
        return { success: false, error: 'File not found' };
      }

      launchTarget(fullPath);
      return { success: true, data: { path: fullPath, filename: path.basename(fullPath) } };
    } catch (err) {
      this.logger.error('Failed to open file', err);
      return { success: false, error: err.message };
    }
  }

  delete(filename, targetPath = null) {
    if (!filename) {
      return { success: false, error: 'No filename provided' };
    }

    try {
      const fullPath = this._resolveFilePath(filename, targetPath);
      if (!fullPath) {
        return { success: false, error: 'File not found' };
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) {
        return { success: false, error: 'Path is a directory, use folder operations' };
      }

      fs.unlinkSync(fullPath);
      return { success: true, data: { path: fullPath, filename: path.basename(fullPath) } };
    } catch (err) {
      this.logger.error('Failed to delete file', err);
      return { success: false, error: err.message };
    }
  }

  rename(oldName, newName) {
    if (!oldName || !newName) {
      return { success: false, error: 'Both old and new names required' };
    }

    const safeNew = Validator.sanitizePath(newName);
    if (!Validator.isValidFilename(safeNew)) {
      return { success: false, error: 'Invalid new filename' };
    }

    try {
      const oldPath = this._resolveFilePath(oldName);
      if (!oldPath) {
        return { success: false, error: 'File not found' };
      }

      const newPath = path.join(path.dirname(oldPath), safeNew);
      fs.renameSync(oldPath, newPath);
      return { success: true, data: { oldPath, newPath } };
    } catch (err) {
      this.logger.error('Failed to rename file', err);
      return { success: false, error: err.message };
    }
  }

  copy(source, destination) {
    if (!source || !destination) {
      return { success: false, error: 'Source and destination required' };
    }

    try {
      const srcPath = this._resolveFilePath(source);
      if (!srcPath) {
        return { success: false, error: 'Source not found' };
      }

      const finalPath = resolveDestinationPath(destination, srcPath, { type: 'file' });
      if (!finalPath) {
        return { success: false, error: 'Destination could not be resolved' };
      }

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.copyFileSync(srcPath, finalPath);
      return { success: true, data: { source: srcPath, destination: finalPath } };
    } catch (err) {
      this.logger.error('Failed to copy file', err);
      return { success: false, error: err.message };
    }
  }

  move(source, destination) {
    if (!source || !destination) {
      return { success: false, error: 'Source and destination required' };
    }

    try {
      const srcPath = this._resolveFilePath(source);
      if (!srcPath) {
        return { success: false, error: 'Source not found' };
      }

      const finalPath = resolveDestinationPath(destination, srcPath, { type: 'file' });
      if (!finalPath) {
        return { success: false, error: 'Destination could not be resolved' };
      }

      fs.mkdirSync(path.dirname(finalPath), { recursive: true });

      try {
        fs.renameSync(srcPath, finalPath);
      } catch (err) {
        fs.copyFileSync(srcPath, finalPath);
        fs.unlinkSync(srcPath);
      }

      return { success: true, data: { source: srcPath, destination: finalPath } };
    } catch (err) {
      this.logger.error('Failed to move file', err);
      return { success: false, error: err.message };
    }
  }

  search(query) {
    if (!query) {
      return { success: false, error: 'No search query provided' };
    }

    const results = [];
    const searchDirs = SEARCH_ROOTS().slice(0, 4);

    for (const dir of searchDirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            results.push(path.join(dir, entry.name));
          }
        }
      } catch (err) {
        continue;
      }
    }

    try {
      const result = execSync(
        `powershell -Command "Get-ChildItem -Path '${searchDirs[0]}' -Filter '*${query}*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName"`,
        { encoding: 'utf8', timeout: 10000 }
      );
      const powerShellResults = result.trim().split('\n').filter(Boolean);
      powerShellResults.forEach(found => {
        const trimmed = found.trim();
        if (!results.includes(trimmed)) {
          results.push(trimmed);
        }
      });
    } catch (err) {
      // PowerShell search failed, keep the direct search results.
    }

    return {
      success: true,
      data: {
        results: results.slice(0, 20),
        count: results.length,
        query
      }
    };
  }
}

module.exports = FileController;
