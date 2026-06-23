const fs = require('fs');
const path = require('path');
const Logger = require('../assistant/Data').Logger;
const Normalizer = require('../assistant/Data').Normalizer;
const Validator = require('../assistant/Data').Validator;
const {
  findEntriesByName,
  findEntryByName,
  getHomeDirectory,
  getSpecialFolders,
  normalizeLocation,
  requireSafeUserPath,
  resolveDestinationPath,
  resolveDirectory,
  splitNameAndLocation
} = require('./common/path-utils');
const { launchTarget } = require('./common/launcher');

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

const FOLDER_SEARCH_LIMITS = Object.freeze({
  maxDepth: 7,
  maxDirectories: 2500,
  maxElapsedMs: 1200,
  maxResults: 40
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

function searchRoots() {
  return uniquePaths([process.cwd(), getHomeDirectory(), ...Object.values(getSpecialFolders())]);
}

function hasSearchTimeRemaining(startedAt, maxElapsedMs) {
  return !Number.isFinite(maxElapsedMs) || maxElapsedMs <= 0 || Date.now() - startedAt < maxElapsedMs;
}

class FolderController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
  }

  search(query, options = {}) {
    const cleanQuery = this._cleanSearchQuery(query);
    if (!cleanQuery) {
      return { success: false, error: 'No folder search query provided' };
    }

    const roots = searchRoots();
    const results = [];
    const visitedDirectories = new Set();
    const startedAt = Date.now();
    const maxResults = Number.isFinite(options.maxResults) ? options.maxResults : FOLDER_SEARCH_LIMITS.maxResults;
    const limits = {
      maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : FOLDER_SEARCH_LIMITS.maxDepth,
      maxDirectories: Number.isFinite(options.maxDirectories) ? options.maxDirectories : FOLDER_SEARCH_LIMITS.maxDirectories,
      maxElapsedMs: Number.isFinite(options.maxElapsedMs) ? options.maxElapsedMs : FOLDER_SEARCH_LIMITS.maxElapsedMs,
      maxResults: Math.max(100, maxResults * 4),
      visitedDirectories,
      startedAt
    };

    for (const root of roots) {
      this._searchFoldersRecursive(root, cleanQuery.toLowerCase(), results, limits);
      if (!hasSearchTimeRemaining(startedAt, limits.maxElapsedMs) || results.length >= limits.maxResults) {
        break;
      }
    }

    const ranked = uniquePaths(results)
      .map(resultPath => ({
        path: resultPath,
        score: this._folderNameMatchScore(path.basename(resultPath), cleanQuery),
        depth: resultPath.split(path.sep).length
      }))
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.depth - right.depth || left.path.localeCompare(right.path))
      .slice(0, Math.min(maxResults, 20));

    return {
      success: true,
      data: {
        query: cleanQuery,
        results: ranked.map(entry => entry.path),
        entries: ranked.map(entry => ({ name: path.basename(entry.path), type: 'folder', path: entry.path })),
        count: ranked.length,
        searchStats: {
          kind: 'folder.search',
          roots: roots.length,
          visitedDirectories: visitedDirectories.size,
          partial: !hasSearchTimeRemaining(startedAt, limits.maxElapsedMs),
          partialReason: !hasSearchTimeRemaining(startedAt, limits.maxElapsedMs) ? 'time-budget' : null,
          elapsedMs: Date.now() - startedAt
        }
      }
    };
  }

  _resolveFolderPath(folderName, targetPath = null) {
    if (!folderName) return null;

    if (path.isAbsolute(folderName) && fs.existsSync(folderName) && fs.statSync(folderName).isDirectory()) {
      return requireSafeUserPath(folderName, { allowRoot: true });
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

    try {
      const dir = requireSafeUserPath(resolveDirectory(targetPath, { mustExist: false }) || getHomeDirectory(), { allowRoot: true });
      const fullPath = path.join(dir, safeName);
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
      requireSafeUserPath(fullPath);

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
      requireSafeUserPath(sourcePath);

      const finalPath = resolveDestinationPath(destination, sourcePath, { type: 'directory' });
      if (!finalPath) {
        return { success: false, error: 'Destination could not be resolved' };
      }
      requireSafeUserPath(finalPath);

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
        const safeSelectedPath = requireSafeUserPath(selectedPath, { allowRoot: true });
        this._openFolderPath(safeSelectedPath, options);
        return { success: true, data: { path: safeSelectedPath, folderName: path.basename(safeSelectedPath), openWith: options.openWith || null } };
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
        const matchedPath = requireSafeUserPath(matches[0], { allowRoot: true });
        this._openFolderPath(matchedPath, options);
        return { success: true, data: { path: matchedPath, folderName: path.basename(matchedPath), openWith: options.openWith || null } };
      }

      const fullPath = this._resolveFolderPath(folderName);
      if (!fullPath) {
        return { success: false, error: 'Folder not found' };
      }
      requireSafeUserPath(fullPath, { allowRoot: true });

      this._openFolderPath(fullPath, options);
      return { success: true, data: { path: fullPath, folderName: path.basename(fullPath), openWith: options.openWith || null } };
    } catch (err) {
      this.logger.error('Failed to open folder', err);
      return { success: false, error: err.message };
    }
  }

  _openFolderPath(folderPath, options = {}) {
    const openWith = String(options.openWith || '').trim().toLowerCase();
    if (openWith === 'code' || openWith === 'vscode' || openWith === 'vs code') {
      launchTarget('code', [folderPath]);
      return;
    }

    launchTarget(folderPath);
  }

  _findFolderMatches(folderName) {
    if (!folderName) {
      return [];
    }

    if (path.isAbsolute(folderName) && fs.existsSync(folderName) && fs.statSync(folderName).isDirectory()) {
      return [requireSafeUserPath(folderName, { allowRoot: true })];
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
      maxDepth: FOLDER_SEARCH_LIMITS.maxDepth,
      maxDirectories: FOLDER_SEARCH_LIMITS.maxDirectories,
      maxElapsedMs: FOLDER_SEARCH_LIMITS.maxElapsedMs,
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
        ...FOLDER_SEARCH_LIMITS,
        maxResults: 100,
        visitedDirectories
      });
      if (results.length >= 12) {
        break;
      }
    }

    return uniquePaths(results)
      .map(resultPath => ({ path: resultPath, score: this._folderNameMatchScore(path.basename(resultPath), folderName) }))
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, 12)
      .map(entry => entry.path);
  }

  _searchFoldersRecursive(root, lowerQuery, results, options = {}) {
    if (!root || !fs.existsSync(root) || results.length >= (options.maxResults || 12)) {
      return;
    }

    const queue = [{ directory: root, depth: 0 }];
    const visitedDirectories = options.visitedDirectories || new Set();
    const maxDepth = options.maxDepth ?? 6;
    const maxDirectories = options.maxDirectories ?? 1500;
    const maxElapsedMs = options.maxElapsedMs ?? FOLDER_SEARCH_LIMITS.maxElapsedMs;
    const startedAt = options.startedAt || Date.now();
    let visited = 0;

    for (
      let cursor = 0;
      cursor < queue.length && visited < maxDirectories && results.length < (options.maxResults || 12);
      cursor += 1
    ) {
      if (!hasSearchTimeRemaining(startedAt, maxElapsedMs)) {
        break;
      }

      const { directory, depth } = queue[cursor];
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
        if (!this._shouldDescendIntoDirectory(entry.name)) {
          continue;
        }
        if (this._folderNameMatchesQuery(entry.name, lowerQuery)) {
          results.push(entryPath);
          if (results.length >= (options.maxResults || 12)) {
            break;
          }
        }

        if (depth < maxDepth) {
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
    return this._folderNameMatchScore(entryName, lowerQuery) > 0;
  }

  _folderNameMatchScore(entryName, lowerQuery) {
    const query = String(lowerQuery || '').trim().toLowerCase();
    const name = String(entryName || '').trim().toLowerCase();
    if (!query || !name) {
      return 0;
    }

    const normalizedName = Normalizer.normalizeText(name.replace(/[_-]+/g, ' '));
    const normalizedQuery = Normalizer.normalizeText(query.replace(/[_-]+/g, ' '));
    const compactName = normalizedName.replace(/\s+/g, '');
    const compactQuery = normalizedQuery.replace(/\s+/g, '');
    if (normalizedName === normalizedQuery) return 100;
    if (normalizedName.startsWith(normalizedQuery)) return 90;
    if (normalizedName.includes(normalizedQuery)) return 82;
    if (compactQuery.length >= 4 && compactName === compactQuery) return 88;
    if (compactQuery.length >= 4 && compactName.includes(compactQuery)) return 78;

    const nameTokens = normalizedName.split(/\s+/).filter(Boolean);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const matchedTokens = queryTokens.filter(token => (
      nameTokens.some(nameToken => (
        nameToken.includes(token) ||
        (nameToken.length >= 4 && nameToken.length / token.length >= 0.6 && token.includes(nameToken))
      )) ||
      Normalizer.findClosestOption(token, nameTokens, {
        minSimilarity: token.length >= 7 ? 0.64 : 0.7,
        maxDistance: token.length >= 7 ? 3 : 2
      })
    )).length;
    if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
      return 60 + Math.round((matchedTokens / queryTokens.length) * 15);
    }
    if (queryTokens.length >= 3 && matchedTokens >= queryTokens.length - 1) {
      return 50 + matchedTokens;
    }

    return normalizedQuery.length >= 4 && Normalizer.findClosestOption(normalizedQuery, [normalizedName], {
      minSimilarity: normalizedQuery.length >= 8 ? 0.64 : 0.7,
      maxDistance: normalizedQuery.length >= 8 ? 3 : 2
    }) ? 55 : 0;
  }

  _cleanSearchQuery(query) {
    return String(query || '')
      .trim()
      .replace(/^(?:locate|find|search|serch|seach|searh|saerch|serach)(?:\s+for)?\s+/i, '')
      .replace(/^(?:look\s+for)\s+/i, '')
      .replace(/^(?:(?:the|a|an|my)\s+)?(?:folder|foldr|floder|foler|directory|diretory|dirctory)\s+/i, '')
      .replace(/^(?:the|a|an|my)\s+/i, '')
      .replace(/\s+(?:folder|foldr|floder|foler|directory|diretory|dirctory|location|path)$/i, '')
      .trim();
  }

  _buildAmbiguousFolderMessage(folderName, choices) {
    const labels = choices.map(choice => `${choice.index}. ${choice.path}`).join('; ');
    return `I found multiple folders named "${folderName}". Please say which one to open: ${labels}`;
  }
}

module.exports = FolderController;
