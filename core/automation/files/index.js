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

const FILE_TYPE_EXTENSIONS = {
  document: ['.doc', '.docx', '.pdf', '.txt', '.rtf', '.odt', '.md'],
  pdf: ['.pdf'],
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'],
  video: ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv'],
  audio: ['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg'],
  presentation: ['.ppt', '.pptx', '.key'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz']
};

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

const FILE_SEARCH_LIMITS = Object.freeze({
  maxDepth: 7,
  maxDirectories: 2500,
  maxElapsedMs: 1500,
  maxResults: 40
});

const SMART_FIND_LIMITS = Object.freeze({
  maxDepth: 7,
  maxDirectories: 3500,
  maxElapsedMs: 1800,
  maxResults: 1200
});

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

function createSearchStats(kind, roots) {
  return {
    kind,
    roots,
    visitedDirectories: 0,
    skippedDirectories: 0,
    matchedEntries: 0,
    partial: false,
    partialReason: null,
    elapsedMs: 0
  };
}

function markPartial(stats, reason) {
  if (!stats || stats.partial) return;
  stats.partial = true;
  stats.partialReason = reason;
}

function hasSearchTimeRemaining(startedAt, maxElapsedMs) {
  return !Number.isFinite(maxElapsedMs) || maxElapsedMs <= 0 || Date.now() - startedAt < maxElapsedMs;
}

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

  search(query, options = {}) {
    if (!query) {
      return { success: false, error: 'No search query provided' };
    }

    const cleanQuery = this._cleanSearchQuery(query);
    const results = [];
    const searchDirs = uniquePaths(SEARCH_ROOTS());
    const lowerQuery = cleanQuery.toLowerCase();
    const visitedDirectories = new Set();
    const startedAt = Date.now();
    const limits = this._resolveSearchLimits(FILE_SEARCH_LIMITS, options);
    const stats = createSearchStats('file.search', searchDirs.length);

    for (const dir of searchDirs) {
      if (!hasSearchTimeRemaining(startedAt, limits.maxElapsedMs)) {
        markPartial(stats, 'time-budget');
        break;
      }
      if (!dir || !fs.existsSync(dir)) continue;
      try {
        this._searchDirectoryRecursive(dir, lowerQuery, results, {
          ...limits,
          includeFolders: true,
          visitedDirectories,
          stats,
          startedAt
        });
      } catch (err) {
        stats.skippedDirectories += 1;
        continue;
      }
    }

    const uniqueResults = Array.from(new Set(results)).slice(0, 20);
    stats.elapsedMs = Date.now() - startedAt;

    return {
      success: true,
      data: {
        results: uniqueResults,
        entries: uniqueResults.map(resultPath => ({
          name: path.basename(resultPath),
          type: fs.existsSync(resultPath) && fs.statSync(resultPath).isDirectory() ? 'folder' : 'file',
          path: resultPath
        })),
        count: uniqueResults.length,
        query: cleanQuery,
        searchStats: stats
      }
    };
  }

  smartFind(options = {}) {
    const location = String(options.location || '').trim();
    const fileType = String(options.fileType || '').trim().toLowerCase();
    const query = this._cleanSearchQuery(options.query || '');
    const sortBy = String(options.sortBy || 'modifiedDesc').trim();
    const timeFilter = String(options.timeFilter || '').trim();
    const openResult = Boolean(options.openResult);
    const groupDuplicates = Boolean(options.groupDuplicates);
    const roots = location
      ? [resolveDirectory(location, { mustExist: true })].filter(Boolean)
      : uniquePaths(SEARCH_ROOTS());

    if (roots.length === 0) {
      return { success: false, error: 'Folder not found' };
    }

    const files = [];
    const visitedDirectories = new Set();
    const startedAt = Date.now();
    const limits = this._resolveSearchLimits(SMART_FIND_LIMITS, {
      ...options,
      maxDepth: options.maxDepth ?? (location ? 10 : SMART_FIND_LIMITS.maxDepth),
      maxDirectories: options.maxDirectories ?? (location ? 2500 : SMART_FIND_LIMITS.maxDirectories),
      maxElapsedMs: options.maxElapsedMs ?? (location ? 1600 : SMART_FIND_LIMITS.maxElapsedMs)
    });
    const stats = createSearchStats('file.smartFind', roots.length);
    for (const root of roots) {
      if (!hasSearchTimeRemaining(startedAt, limits.maxElapsedMs)) {
        markPartial(stats, 'time-budget');
        break;
      }
      this._collectFilesRecursive(root, files, {
        ...limits,
        visitedDirectories,
        stats,
        startedAt
      });
    }
    stats.elapsedMs = Date.now() - startedAt;

    const filtered = files
      .filter(file => this._matchesSmartFileType(file, fileType))
      .filter(file => this._matchesSmartQuery(file, query))
      .filter(file => this._matchesSmartTime(file, timeFilter));

    const duplicates = groupDuplicates ? this._findDuplicateFileGroups(filtered) : [];
    const sorted = this._sortSmartFiles(filtered, sortBy);
    const results = sorted.slice(0, 20).map(file => this._fileEntry(file));

    if (openResult && sorted[0]) {
      launchTarget(sorted[0].path);
    }

    return {
      success: true,
      data: {
        action: openResult ? 'openSmartFile' : 'smartFind',
        query: query || null,
        location: location || null,
        fileType: fileType || null,
        sortBy,
        timeFilter: timeFilter || null,
        openResult,
        groupDuplicates,
        count: filtered.length,
        results: results.map(entry => entry.path),
        entries: results,
        duplicates,
        opened: openResult && sorted[0] ? this._fileEntry(sorted[0]) : null,
        searchStats: stats
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
      maxDepth: 7,
      maxDirectories: 2500,
      maxElapsedMs: 1200,
      maxMatches: 12
    }) || [];
    if (exactMatches.length > 1) {
      return exactMatches;
    }

    if (exactMatches.length === 1) {
      return exactMatches;
    }

    const fuzzyMatches = [];
    const visitedDirectories = new Set();
    for (const root of uniquePaths(SEARCH_ROOTS())) {
      this._searchDirectoryRecursive(root, path.basename(safeName).toLowerCase(), fuzzyMatches, {
        maxDepth: 7,
        maxDirectories: 2500,
        maxElapsedMs: 1200,
        maxResults: 12,
        filesOnly: true,
        fuzzyName: safeName,
        visitedDirectories
      });
    }
    return Array.from(new Set(fuzzyMatches)).slice(0, 12);
  }

  _searchDirectoryRecursive(root, lowerQuery, results, options = {}) {
    if (!root || !fs.existsSync(root) || results.length >= (options.maxResults || 40)) {
      return;
    }

    const queue = [{ directory: root, depth: 0 }];
    const visitedDirectories = options.visitedDirectories || new Set();
    const maxDepth = options.maxDepth ?? 6;
    const maxDirectories = options.maxDirectories ?? 1500;
    const maxElapsedMs = options.maxElapsedMs ?? FILE_SEARCH_LIMITS.maxElapsedMs;
    const startedAt = options.startedAt || Date.now();
    let visited = 0;

    for (
      let cursor = 0;
      cursor < queue.length && visited < maxDirectories && results.length < (options.maxResults || 40);
      cursor += 1
    ) {
      if (!hasSearchTimeRemaining(startedAt, maxElapsedMs)) {
        markPartial(options.stats, 'time-budget');
        break;
      }

      const { directory, depth } = queue[cursor];
      const resolvedDirectory = path.resolve(directory);
      const directoryKey = resolvedDirectory.toLowerCase();
      if (visitedDirectories.has(directoryKey)) {
        continue;
      }
      visitedDirectories.add(directoryKey);
      visited += 1;
      if (options.stats) {
        options.stats.visitedDirectories += 1;
      }

      let entries = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (err) {
        if (options.stats) {
          options.stats.skippedDirectories += 1;
        }
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        const isDirectory = entry.isDirectory();
        const isMatch = options.fuzzyName && entry.isFile()
          ? this._fileNameLooksLike(entry.name, options.fuzzyName)
          : this._entryNameMatchesQuery(entry.name, lowerQuery);

        if (isMatch && (!options.filesOnly || entry.isFile()) && (options.includeFolders || !isDirectory)) {
          results.push(entryPath);
          if (options.stats) {
            options.stats.matchedEntries += 1;
          }
          if (results.length >= (options.maxResults || 40)) {
            break;
          }
        }

        if (depth < maxDepth && isDirectory && this._shouldDescendIntoDirectory(entry.name)) {
          queue.push({ directory: entryPath, depth: depth + 1 });
        } else if (isDirectory && !this._shouldDescendIntoDirectory(entry.name) && options.stats) {
          options.stats.skippedDirectories += 1;
        }
      }
    }

    if (visited >= maxDirectories && results.length < (options.maxResults || 40)) {
      markPartial(options.stats, 'directory-limit');
    }
  }

  _collectFilesRecursive(root, results, options = {}) {
    if (!root || !fs.existsSync(root) || results.length >= (options.maxResults || 2000)) {
      return;
    }

    const queue = [{ directory: root, depth: 0 }];
    const visitedDirectories = options.visitedDirectories || new Set();
    const maxDepth = options.maxDepth ?? 6;
    const maxDirectories = options.maxDirectories ?? 1500;
    const maxElapsedMs = options.maxElapsedMs ?? SMART_FIND_LIMITS.maxElapsedMs;
    const startedAt = options.startedAt || Date.now();
    let visited = 0;

    for (
      let cursor = 0;
      cursor < queue.length && visited < maxDirectories && results.length < (options.maxResults || 2000);
      cursor += 1
    ) {
      if (!hasSearchTimeRemaining(startedAt, maxElapsedMs)) {
        markPartial(options.stats, 'time-budget');
        break;
      }

      const { directory, depth } = queue[cursor];
      const resolvedDirectory = path.resolve(directory);
      const directoryKey = resolvedDirectory.toLowerCase();
      if (visitedDirectories.has(directoryKey)) {
        continue;
      }
      visitedDirectories.add(directoryKey);
      visited += 1;
      if (options.stats) {
        options.stats.visitedDirectories += 1;
      }

      let entries = [];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch (err) {
        if (options.stats) {
          options.stats.skippedDirectories += 1;
        }
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        const entryPath = path.join(directory, entry.name);
        if (entry.isFile()) {
          try {
            const stats = fs.statSync(entryPath);
            results.push({
              path: entryPath,
              name: entry.name,
              ext: path.extname(entry.name).toLowerCase(),
              size: stats.size,
              modifiedAt: stats.mtimeMs,
              accessedAt: stats.atimeMs,
              createdAt: stats.birthtimeMs
            });
          } catch (err) {
            continue;
          }
        } else if (entry.isDirectory() && depth < maxDepth && this._shouldDescendIntoDirectory(entry.name)) {
          queue.push({ directory: entryPath, depth: depth + 1 });
        } else if (entry.isDirectory() && !this._shouldDescendIntoDirectory(entry.name) && options.stats) {
          options.stats.skippedDirectories += 1;
        }
      }
    }

    if (visited >= maxDirectories && results.length < (options.maxResults || 2000)) {
      markPartial(options.stats, 'directory-limit');
    }
  }

  _resolveSearchLimits(defaults, options = {}) {
    return {
      maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : defaults.maxDepth,
      maxDirectories: Number.isFinite(options.maxDirectories) ? options.maxDirectories : defaults.maxDirectories,
      maxElapsedMs: Number.isFinite(options.maxElapsedMs) ? options.maxElapsedMs : defaults.maxElapsedMs,
      maxResults: Number.isFinite(options.maxResults) ? options.maxResults : defaults.maxResults
    };
  }

  _matchesSmartFileType(file, fileType) {
    if (!fileType) {
      return true;
    }
    const extensions = FILE_TYPE_EXTENSIONS[fileType] || [];
    return extensions.length === 0 ? true : extensions.includes(file.ext);
  }

  _matchesSmartQuery(file, query) {
    const normalizedQuery = Normalizer.normalizeText(query || '');
    if (!normalizedQuery) {
      return true;
    }

    const name = Normalizer.normalizeText(file.name || '');
    const fullPath = Normalizer.normalizeText(file.path || '');
    if (name.includes(normalizedQuery) || fullPath.includes(normalizedQuery)) {
      return true;
    }

    const queryTokens = normalizedQuery.split(/\s+/).filter(token => token.length >= 2);
    if (queryTokens.length === 0) {
      return true;
    }

    return queryTokens.every(token => (
      name.includes(token) ||
      fullPath.includes(token) ||
      Normalizer.findClosestOption(token, name.split(/\s+/), {
        minSimilarity: 0.74,
        maxDistance: token.length >= 8 ? 3 : 2
      })
    ));
  }

  _matchesSmartTime(file, timeFilter) {
    const filter = String(timeFilter || '').trim().toLowerCase();
    if (!filter) {
      return true;
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const modified = file.modifiedAt || 0;
    const accessed = file.accessedAt || 0;

    if (filter === 'today') {
      return modified >= startOfToday || file.createdAt >= startOfToday;
    }
    if (filter === 'yesterday') {
      return modified >= startOfToday - dayMs && modified < startOfToday;
    }
    if (filter === 'thisMorning') {
      const noon = startOfToday + (12 * 60 * 60 * 1000);
      return modified >= startOfToday && modified < noon;
    }
    if (filter === 'lastWeek') {
      return modified >= now - (7 * dayMs);
    }
    if (filter === 'olderThan6MonthsAccess') {
      return accessed > 0 && accessed < now - (183 * dayMs);
    }

    return true;
  }

  _sortSmartFiles(files, sortBy) {
    const key = String(sortBy || '').trim();
    const sorted = [...files];
    sorted.sort((left, right) => {
      if (key === 'sizeDesc') return (right.size || 0) - (left.size || 0);
      if (key === 'accessedAsc') return (left.accessedAt || 0) - (right.accessedAt || 0);
      if (key === 'createdDesc') return (right.createdAt || 0) - (left.createdAt || 0);
      return (right.modifiedAt || 0) - (left.modifiedAt || 0);
    });
    return sorted;
  }

  _fileEntry(file) {
    return {
      name: file.name,
      type: 'file',
      path: file.path,
      size: file.size,
      sizeMB: Number((Number(file.size || 0) / 1024 / 1024).toFixed(2)),
      modifiedAt: new Date(file.modifiedAt || 0).toISOString(),
      accessedAt: new Date(file.accessedAt || 0).toISOString(),
      createdAt: new Date(file.createdAt || 0).toISOString()
    };
  }

  _findDuplicateFileGroups(files) {
    const buckets = new Map();
    for (const file of files) {
      const key = `${file.name.toLowerCase()}:${file.size}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key).push(this._fileEntry(file));
    }

    return Array.from(buckets.values())
      .filter(group => group.length > 1)
      .slice(0, 10);
  }

  _shouldDescendIntoDirectory(name) {
    const normalized = String(name || '').trim().toLowerCase();
    return Boolean(normalized) &&
      !normalized.startsWith('.') &&
      !EXCLUDED_SEARCH_DIRECTORIES.has(normalized);
  }

  _entryNameMatchesQuery(entryName, lowerQuery) {
    const query = String(lowerQuery || '').trim().toLowerCase();
    const name = String(entryName || '').trim().toLowerCase();
    if (!query || !name) {
      return false;
    }

    if (name.includes(query)) {
      return true;
    }

    const normalizedName = Normalizer.normalizeText(name);
    const normalizedQuery = Normalizer.normalizeText(query);
    const compactName = normalizedName.replace(/\s+/g, '');
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (compactQuery.length >= 4 && compactName.includes(compactQuery)) {
      return true;
    }

    const queryTokens = normalizedQuery.split(/\s+/).filter(token => token.length >= 2);
    if (queryTokens.length === 0) {
      return false;
    }

    const matchedTokens = queryTokens.filter(token => (
      normalizedName.includes(token) ||
      compactName.includes(token) ||
      Normalizer.findClosestOption(token, normalizedName.split(/\s+/), {
        minSimilarity: 0.74,
        maxDistance: token.length >= 8 ? 3 : 2
      })
    ));

    return matchedTokens.length === queryTokens.length ||
      (queryTokens.length >= 3 && matchedTokens.length >= queryTokens.length - 1);
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
