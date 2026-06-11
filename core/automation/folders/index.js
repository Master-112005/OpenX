const fs = require('fs');
const path = require('path');
const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;
const Validator = require('../../shared/index').Validator;
const {
  findEntriesByName,
  findEntryByName,
  getHomeDirectory,
  getSpecialFolders,
  normalizeLocation,
  resolveDestinationPath,
  resolveDirectory,
  splitNameAndLocation
} = require('../common/path-utils');
const { launchTarget } = require('../common/launcher');

const EXCLUDED_SEARCH_DIRECTORIES = new Set([
  '$recycle.bin',
  '.git',
  '.hg',
  '.svn',
  'appdata',
  'application data',
  'cache',
  'cookies',
  'local settings',
  'node_modules',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  'windows'
]);

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths || []) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function searchRoots() {
  return uniquePaths([process.cwd(), getHomeDirectory(), ...Object.values(getSpecialFolders())]);
}

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
      roots: searchRoots(),
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

  open(folderName, options = {}) {
    if (!folderName) {
      return { success: false, error: 'No folder name provided' };
    }

    try {
      const selectedPath = options.selectedPath || options.targetPath;
      if (selectedPath && path.isAbsolute(selectedPath) && fs.existsSync(selectedPath) && fs.statSync(selectedPath).isDirectory()) {
        launchTarget(selectedPath);
        return { success: true, data: { path: selectedPath, folderName: path.basename(selectedPath) } };
      }

      const matches = this._findFolderMatches(folderName);
      if (matches.length > 1) {
        const choices = matches.slice(0, 8).map((folderPath, index) => ({
          index: index + 1,
          title: `${path.basename(folderPath)} - ${folderPath}`,
          path: folderPath,
          entities: { selectedPath: folderPath }
        }));

        return {
          success: false,
          needsClarification: true,
          error: this._buildAmbiguousFolderMessage(folderName, choices),
          data: {
            clarificationType: 'folder.open',
            folderName,
            matchCount: matches.length,
            choices
          }
        };
      }

      if (matches.length === 1) {
        const matchedPath = matches[0];
        launchTarget(matchedPath);
        return { success: true, data: { path: matchedPath, folderName: path.basename(matchedPath) } };
      }

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

  _findFolderMatches(folderName) {
    if (!folderName) {
      return [];
    }

    if (path.isAbsolute(folderName) && fs.existsSync(folderName) && fs.statSync(folderName).isDirectory()) {
      return [path.resolve(folderName)];
    }

    const parsed = splitNameAndLocation(folderName);
    const requestedName = parsed.name || folderName;
    if (parsed.location) {
      const resolved = this._resolveFolderPath(folderName);
      return resolved ? [resolved] : [];
    }

    const specialFolders = getSpecialFolders();
    const asSpecialFolder = specialFolders[normalizeLocation(requestedName)];
    if (asSpecialFolder && fs.existsSync(asSpecialFolder)) {
      return [asSpecialFolder];
    }

    const safeName = Validator.sanitizePath(requestedName);
    const exactMatches = findEntriesByName(safeName, {
      roots: searchRoots(),
      type: 'directory',
      maxDepth: 8,
      maxDirectories: 8000,
      maxMatches: 12
    }) || [];
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    return this._findFuzzyFolderMatches(safeName);
  }

  _findFuzzyFolderMatches(folderName) {
    const results = [];
    const roots = searchRoots();
    const lowerQuery = String(folderName || '').trim().toLowerCase();
    const visitedDirectories = new Set();

    for (const root of roots) {
      this._searchFoldersRecursive(root, lowerQuery, results, {
        maxDepth: 8,
        maxDirectories: 8000,
        maxResults: 12,
        visitedDirectories
      });
      if (results.length >= 12) {
        break;
      }
    }

    return uniquePaths(results).slice(0, 12);
  }

  _searchFoldersRecursive(root, lowerQuery, results, options = {}) {
    if (!root || !fs.existsSync(root) || results.length >= (options.maxResults || 12)) {
      return;
    }

    const queue = [{ directory: root, depth: 0 }];
    const visitedDirectories = options.visitedDirectories || new Set();
    const maxDepth = options.maxDepth ?? 6;
    const maxDirectories = options.maxDirectories ?? 1500;
    let visited = 0;

    while (queue.length > 0 && visited < maxDirectories && results.length < (options.maxResults || 12)) {
      const { directory, depth } = queue.shift();
      const directoryKey = path.resolve(directory).toLowerCase();
      if (visitedDirectories.has(directoryKey)) {
        continue;
      }
      visitedDirectories.add(directoryKey);
      visited += 1;

      let entries = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const entryPath = path.join(directory, entry.name);
        if (this._folderNameMatchesQuery(entry.name, lowerQuery)) {
          results.push(entryPath);
          if (results.length >= (options.maxResults || 12)) {
            break;
          }
        }

        if (depth < maxDepth && this._shouldDescendIntoDirectory(entry.name)) {
          queue.push({ directory: entryPath, depth: depth + 1 });
        }
      }
    }
  }

  _shouldDescendIntoDirectory(name) {
    const normalized = String(name || '').trim().toLowerCase();
    return Boolean(normalized) &&
      !normalized.startsWith('.') &&
      !EXCLUDED_SEARCH_DIRECTORIES.has(normalized);
  }

  _folderNameMatchesQuery(entryName, lowerQuery) {
    const query = String(lowerQuery || '').trim().toLowerCase();
    const name = String(entryName || '').trim().toLowerCase();
    if (!query || !name) {
      return false;
    }

    if (name === query || name.includes(query)) {
      return true;
    }

    const normalizedName = name.replace(/[_-]+/g, ' ');
    const normalizedQuery = query.replace(/[_-]+/g, ' ');
    const compactName = normalizedName.replace(/\s+/g, '');
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (compactQuery.length >= 4 && compactName.includes(compactQuery)) {
      return true;
    }

    return Boolean(normalizedQuery.length >= 4 && Normalizer.findClosestOption(normalizedQuery, [normalizedName], {
      minSimilarity: 0.72,
      maxDistance: normalizedQuery.length >= 8 ? 3 : 2
    }));
  }

  _buildAmbiguousFolderMessage(folderName, choices) {
    const labels = choices.map(choice => `${choice.index}. ${choice.path}`).join('; ');
    return `I found multiple folders named "${folderName}". Please say which one to open: ${labels}`;
  }
}

module.exports = FolderController;
