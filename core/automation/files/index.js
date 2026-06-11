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
    const explicitDirectory = typeof targetPath === 'string' ? targetPath : source.location;

    if (explicitDirectory) {
      const dir = resolveDirectory(explicitDirectory, { mustExist: true });
      if (!dir) return null;

      const candidate = path.join(dir, safeName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }

      return this._findFuzzyFileInDirectory(dir, safeName);
    }

    const exactMatch = findEntryByName(safeName, {
      roots: SEARCH_ROOTS(),
      type: 'file'
    });
    if (exactMatch) {
      return exactMatch;
    }

    for (const root of SEARCH_ROOTS()) {
      const fuzzyMatch = this._findFuzzyFileInDirectory(root, safeName);
      if (fuzzyMatch) {
        return fuzzyMatch;
      }
    }

    return null;
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
      const selectedPath = targetPath?.selectedPath || targetPath?.targetPath;
      if (selectedPath && path.isAbsolute(selectedPath) && fs.existsSync(selectedPath) && fs.statSync(selectedPath).isFile()) {
        launchTarget(selectedPath);
        return { success: true, data: { path: selectedPath, filename: path.basename(selectedPath) } };
      }

      const matches = this._findFileMatches(filename, targetPath);
      if (matches.length > 1) {
        const choices = matches.slice(0, 8).map((filePath, index) => ({
          index: index + 1,
          title: `${path.basename(filePath)} - ${filePath}`,
          path: filePath,
          entities: { selectedPath: filePath, path: null }
        }));

        return {
          success: false,
          needsClarification: true,
          error: this._buildAmbiguousFileMessage(filename, choices),
          data: {
            clarificationType: 'file.open',
            filename,
            matchCount: matches.length,
            choices
          }
        };
      }

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

    const cleanQuery = this._cleanSearchQuery(query);
    const results = [];
    const searchDirs = SEARCH_ROOTS();
    const lowerQuery = cleanQuery.toLowerCase();

    for (const dir of searchDirs) {
      if (!dir || !fs.existsSync(dir)) continue;
      try {
        this._searchDirectoryRecursive(dir, lowerQuery, results, {
          maxDepth: 8,
          maxDirectories: 8000,
          maxResults: 40
        });
      } catch (err) {
        continue;
      }
    }

    return {
      success: true,
      data: {
        results: Array.from(new Set(results)).slice(0, 20),
        count: results.length,
        query: cleanQuery
      }
    };
  }

  list(targetPath = 'home', options = {}) {
    const dir = resolveDirectory(targetPath || 'home', { mustExist: true });
    if (!dir) {
      return { success: false, error: 'Folder not found' };
    }

    try {
      const fileType = String(options?.fileType || '').trim().toLowerCase();
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          path: path.join(dir, entry.name)
        }))
        .filter(entry => this._matchesListFilter(entry, fileType))
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === 'folder' ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });

      return {
        success: true,
        data: {
          path: dir,
          location: targetPath || 'home',
          fileType: fileType || null,
          entries: entries.slice(0, 30),
          count: entries.length,
          fileCount: entries.filter(entry => entry.type === 'file').length,
          folderCount: entries.filter(entry => entry.type === 'folder').length
        }
      };
    } catch (err) {
      this.logger.error('Failed to list files', err);
      return { success: false, error: err.message };
    }
  }

  _matchesListFilter(entry, fileType) {
    if (!fileType) {
      return true;
    }

    if (fileType === 'pdf') {
      return entry.type === 'file' && /\.pdf$/i.test(entry.name);
    }
    if (fileType === 'image') {
      return entry.type === 'file' && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(entry.name);
    }
    if (fileType === 'video') {
      return entry.type === 'file' && /\.(mp4|mkv|mov|avi|webm|wmv)$/i.test(entry.name);
    }
    if (fileType === 'audio') {
      return entry.type === 'file' && /\.(mp3|wav|m4a|flac|aac|ogg)$/i.test(entry.name);
    }

    return true;
  }

  _findFuzzyFileInDirectory(dir, requestedName) {
    if (!dir || !requestedName || !fs.existsSync(dir)) {
      return null;
    }

    const requestedExt = path.extname(requestedName).toLowerCase();
    const requestedBase = path.basename(requestedName, requestedExt).toLowerCase();
    const requestedTokens = requestedBase
      .split(/[^a-z0-9]+/i)
      .map(token => token.trim())
      .filter(Boolean);

    if (requestedTokens.length === 0 && !requestedExt) {
      return null;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return null;
    }

    const matches = entries
      .filter(entry => entry.isFile())
      .map(entry => {
        const entryExt = path.extname(entry.name).toLowerCase();
        if (requestedExt && entryExt !== requestedExt) {
          return null;
        }

        const entryBase = path.basename(entry.name, entryExt).toLowerCase();
        const entryTokens = entryBase
          .split(/[^a-z0-9]+/i)
          .map(token => token.trim())
          .filter(Boolean);
        const tokenScore = requestedTokens.filter(token => (
          entryBase.includes(token) ||
          entryTokens.some(entryToken => entryToken.includes(token) || token.includes(entryToken) || Normalizer.findClosestOption(token, [entryToken], {
            minSimilarity: 0.74,
            maxDistance: 2
          }))
        )).length;
        const exactSubstring = requestedBase && entryBase.includes(requestedBase);
        const score = (exactSubstring ? 10 : 0) + tokenScore;
        return score > 0 ? { entry, score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));

    if (matches.length === 0) {
      return null;
    }

    return path.join(dir, matches[0].entry.name);
  }

  _findFileMatches(filename, targetPath = null) {
    if (!filename) {
      return [];
    }

    const selectedPath = targetPath?.selectedPath || targetPath?.targetPath;
    if (selectedPath && path.isAbsolute(selectedPath) && fs.existsSync(selectedPath) && fs.statSync(selectedPath).isFile()) {
      return [path.resolve(selectedPath)];
    }

    if (path.isAbsolute(filename) && fs.existsSync(filename) && fs.statSync(filename).isFile()) {
      return [path.resolve(filename)];
    }

    const source = splitNameAndLocation(filename);
    const safeName = Validator.sanitizePath(source.name || filename);
    const explicitDirectory = typeof targetPath === 'string' ? targetPath : source.location;
    if (explicitDirectory) {
      const resolved = this._resolveFilePath(filename, explicitDirectory);
      return resolved ? [resolved] : [];
    }

    const exactMatches = findEntriesByName(safeName, {
      roots: SEARCH_ROOTS(),
      type: 'file',
      maxDepth: 8,
      maxDirectories: 8000,
      maxMatches: 12
    }) || [];
    if (exactMatches.length > 1) {
      return exactMatches;
    }

    if (exactMatches.length === 1) {
      return exactMatches;
    }

    const fuzzyMatches = [];
    for (const root of SEARCH_ROOTS()) {
      this._searchDirectoryRecursive(root, path.basename(safeName).toLowerCase(), fuzzyMatches, {
        maxDepth: 8,
        maxDirectories: 8000,
        maxResults: 12,
        filesOnly: true,
        fuzzyName: safeName
      });
    }
    return Array.from(new Set(fuzzyMatches)).slice(0, 12);
  }

  _searchDirectoryRecursive(root, lowerQuery, results, options = {}) {
    if (!root || !fs.existsSync(root) || results.length >= (options.maxResults || 40)) {
      return;
    }

    const queue = [{ directory: root, depth: 0 }];
    const maxDepth = options.maxDepth ?? 6;
    const maxDirectories = options.maxDirectories ?? 1500;
    let visited = 0;

    while (queue.length > 0 && visited < maxDirectories && results.length < (options.maxResults || 40)) {
      const { directory, depth } = queue.shift();
      visited += 1;

      let entries = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (err) {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        const entryName = entry.name.toLowerCase();
        const isMatch = options.fuzzyName
          ? this._fileNameLooksLike(entry.name, options.fuzzyName)
          : entryName.includes(lowerQuery);

        if (isMatch && (!options.filesOnly || entry.isFile())) {
          results.push(entryPath);
          if (results.length >= (options.maxResults || 40)) {
            break;
          }
        }

        if (depth < maxDepth && entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push({ directory: entryPath, depth: depth + 1 });
        }
      }
    }
  }

  _fileNameLooksLike(entryName, requestedName) {
    const requestedExt = path.extname(requestedName).toLowerCase();
    const entryExt = path.extname(entryName).toLowerCase();
    if (requestedExt && requestedExt !== entryExt) {
      return false;
    }

    const requestedBase = path.basename(requestedName, requestedExt).toLowerCase();
    const entryBase = path.basename(entryName, entryExt).toLowerCase();
    if (!requestedBase) {
      return false;
    }

    if (entryBase.includes(requestedBase) || requestedBase.includes(entryBase)) {
      return true;
    }

    return Boolean(Normalizer.findClosestOption(requestedBase, [entryBase], {
      minSimilarity: 0.72,
      maxDistance: requestedBase.length >= 8 ? 3 : 2
    }));
  }

  _cleanSearchQuery(query) {
    return String(query || '')
      .trim()
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/\s+(?:file|folder|directory|location|path)$/i, '')
      .replace(/\b([a-z0-9_-]+)\s+(pdf|txt|docx?|xlsx?|pptx?|csv|json|xml|html?|js|ts|py|java|md|png|jpe?g|gif|webp|mp[34]|mkv|wav|zip|rar)$/i, '$1.$2')
      .trim();
  }

  _buildAmbiguousFileMessage(filename, choices) {
    const labels = choices.map(choice => `${choice.index}. ${choice.path}`).join('; ');
    return `I found multiple files named "${filename}". Please say which one to open: ${labels}`;
  }
}

module.exports = FileController;
