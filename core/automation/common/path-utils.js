const fs = require('fs');
const os = require('os');
const path = require('path');
const Normalizer = require('../../shared/index').Normalizer;

function cleanEntityName(value, options = {}) {
  const { stripTypeWords = false } = options;
  if (!value || typeof value !== 'string') return null;

  let result = value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '');

  if (stripTypeWords) {
    result = result.replace(/^(?:file|folder|directory)\s+/i, '');
  }

  result = result
    .replace(/\s+(pdf|txt|docx?|xlsx?|pptx?|csv|json|xml|html?|js|ts|py|java|png|jpe?g|gif|webp|mp[34]|wav|zip|rar)$/i, '.$1')
    .trim();

  return result || null;
}

function getHomeDirectory() {
  return process.env.USERPROFILE || os.homedir();
}

function getSpecialFolders() {
  const home = getHomeDirectory();
  return {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos')
  };
}

function normalizeLocation(value) {
  if (!value || typeof value !== 'string') return '';

  return value
    .trim()
    .replace(/^(?:my|the)\s+/i, '')
    .replace(/\s+(?:folder|directory|path)$/i, '')
    .trim()
    .toLowerCase();
}

function dedupe(paths) {
  return Array.from(new Set(paths.filter(Boolean).map(candidate => path.resolve(candidate))));
}

function resolveDirectory(location, options = {}) {
  const {
    baseDir = getHomeDirectory(),
    mustExist = false
  } = options;

  if (!location) {
    return mustExist || fs.existsSync(baseDir) ? path.resolve(baseDir) : null;
  }

  const raw = location.trim();
  const normalized = normalizeLocation(raw);
  const specialFolders = getSpecialFolders();

  if (specialFolders[normalized]) {
    const resolved = specialFolders[normalized];
    return !mustExist || fs.existsSync(resolved) ? resolved : null;
  }

  const fuzzySpecialFolder = Normalizer.findClosestOption(normalized, Object.keys(specialFolders), {
    minSimilarity: 0.65,
    maxDistance: 2
  });
  if (fuzzySpecialFolder) {
    const resolved = specialFolders[fuzzySpecialFolder.normalizedMatch];
    return !mustExist || fs.existsSync(resolved) ? resolved : null;
  }

  const candidatePaths = dedupe([
    path.isAbsolute(raw) ? raw : null,
    path.resolve(baseDir, raw),
    path.resolve(process.cwd(), raw),
    path.resolve(getHomeDirectory(), raw)
  ]);

  for (const candidate of candidatePaths) {
    if (!mustExist) {
      return candidate;
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

function splitNameAndLocation(value) {
  if (!value || typeof value !== 'string') {
    return { name: null, location: null };
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(.*?)(?:\s+(?:from|in|on|at)\s+(.+))?$/i);

  if (!match) {
    return { name: cleanEntityName(trimmed, { stripTypeWords: true }), location: null };
  }

  return {
    name: cleanEntityName(match[1], { stripTypeWords: true }),
    location: match[2] ? match[2].trim() : null
  };
}

function findEntryByName(name, options = {}) {
  if (!name) return null;

  const {
    roots = [],
    type = 'file'
  } = options;

  const wantedDirectory = type === 'directory';
  const wantedName = name.toLowerCase();
  const candidateRoots = dedupe(roots.length > 0 ? roots : [
    process.cwd(),
    getHomeDirectory(),
    ...Object.values(getSpecialFolders())
  ]);

  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) continue;

    const candidate = path.join(root, name);
    if (!fs.existsSync(candidate)) continue;

    const stats = fs.statSync(candidate);
    if (wantedDirectory ? stats.isDirectory() : stats.isFile()) {
      return candidate;
    }
  }

  const queue = candidateRoots
    .filter(root => fs.existsSync(root) && fs.statSync(root).isDirectory())
    .map(root => ({ directory: root, depth: 0 }));
  const maxDepth = options.maxDepth ?? 4;
  const maxDirectories = options.maxDirectories ?? 1500;
  let visitedDirectories = 0;

  while (queue.length > 0 && visitedDirectories < maxDirectories) {
    const { directory, depth } = queue.shift();
    visitedDirectories += 1;

    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const entryName = entry.name.toLowerCase();

      if (entryName === wantedName) {
        if (wantedDirectory ? entry.isDirectory() : entry.isFile()) {
          return entryPath;
        }
      }

      if (
        depth < maxDepth &&
        entry.isDirectory() &&
        !entry.name.startsWith('.')
      ) {
        queue.push({ directory: entryPath, depth: depth + 1 });
      }
    }
  }

  return null;
}

function resolveDestinationPath(destination, sourcePath, options = {}) {
  if (!destination || !sourcePath) return null;

  const {
    type = 'file'
  } = options;

  const raw = destination.trim();
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : null;
  const looksLikeFilePath = type === 'file' && path.extname(raw) !== '';

  if (absolute) {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      return path.join(absolute, path.basename(sourcePath));
    }
    return absolute;
  }

  const asDirectory = resolveDirectory(raw, { mustExist: true });
  if (asDirectory) {
    return path.join(asDirectory, path.basename(sourcePath));
  }

  if (looksLikeFilePath) {
    return path.resolve(raw);
  }

  const fallbackDirectory = resolveDirectory(raw, { mustExist: false });
  if (!fallbackDirectory) {
    return null;
  }

  return type === 'directory'
    ? fallbackDirectory
    : path.join(fallbackDirectory, path.basename(sourcePath));
}

module.exports = {
  findEntryByName,
  getHomeDirectory,
  getSpecialFolders,
  normalizeLocation,
  resolveDestinationPath,
  resolveDirectory,
  splitNameAndLocation,
  cleanEntityName
};
