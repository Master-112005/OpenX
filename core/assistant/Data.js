const dataRootModule = (() => {
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

function purgeDeprecatedContactStorage(root) {
  const sourceRoot = String(root || '').trim();
  if (!sourceRoot) return [];
  const resolvedRoot = path.resolve(sourceRoot);
  if (!fs.existsSync(resolvedRoot)) return [];

  const removed = [];
  for (const name of fs.readdirSync(resolvedRoot)) {
    if (!/^contacts\.json(?:\.bak|\.corrupt-.+)?$|^\.contacts\.json\..+\.tmp$/i.test(name)) continue;
    const target = path.resolve(resolvedRoot, name);
    if (path.dirname(target) !== resolvedRoot) continue;
    fs.unlinkSync(target);
    removed.push(target);
  }
  return removed;
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
  purgeDeprecatedContactStorage(paths.root);
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

  purgeDeprecatedContactStorage(legacyRoot);

  copyFileIfMissing(path.join(legacyRoot, 'settings.json'), paths.settingsPath, migrated, skipped);
  copyFileIfMissing(path.join(legacyRoot, 'learning.json'), paths.learningPath, migrated, skipped);

  return { dataRoot: paths.root, legacyRoot, migrated, skipped };
}

return {
  DATA_ROOT_NAME,
  LEGACY_DATA_ROOT_NAME,
  resolveDataRoot,
  resolveLegacyDataRoot,
  buildDataPaths,
  ensureDataRoot,
  purgeDeprecatedContactStorage,
  readJsonFile,
  writeFileAtomic,
  writeJsonAtomic,
  migrateLegacyData
};

})();

const eventsModule = (() => {
const EventEmitter = require('events');

const EVENTS = Object.freeze({
  COMMAND_RECEIVED: 'command.received',
  VOICE_ACTIVATED: 'voice.activated',
  LISTENER_STARTED: 'listener.started',
  LISTENER_STOPPED: 'listener.stopped',
  SPEECH_DETECTED: 'speech.detected',
  UTTERANCE_FINALIZED: 'utterance.finalized',
  STT_COMPLETED: 'stt.completed',
  INTENT_DETECTED: 'intent.detected',
  COMMAND_EXECUTED: 'command.executed',
  RESPONSE_GENERATED: 'response.generated',
  RESPONSE_STARTED: 'response.started',
  RESPONSE_COMPLETED: 'response.completed',
  SCHEDULE_DUE: 'schedule.due',
  UI_STATE_CHANGED: 'ui.state.changed',
  VOICE_STATE_CHANGED: 'voice.state.changed',
  VOICE_SESSION_STARTED: 'voice.sessionStarted',
  VOICE_SESSION_ENDED: 'voice.sessionEnded',
  VOICE_PARTIAL_TRANSCRIPT: 'voice.partialTranscript',
  VOICE_FINAL_TRANSCRIPT: 'voice.finalTranscript',
  VOICE_PROCESSING_STARTED: 'voice.processingStarted',
  VOICE_PROCESSING_FINISHED: 'voice.processingFinished',
  VOICE_ERROR: 'voice.error'
});

class AssistantEventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyLimit = Number(options.historyLimit) > 0 ? Number(options.historyLimit) : 250;
    this.history = [];
  }

  publish(event, payload = {}) {
    const envelope = {
      event,
      payload,
      timestamp: new Date().toISOString()
    };

    this.history.push(envelope);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    this.emit(event, envelope);
    this.emit('*', envelope);
    return envelope;
  }

  subscribe(event, handler) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  getRecentEvents(limit = 50) {
    if (limit <= 0) {
      return [];
    }

    return this.history.slice(-limit);
  }
}

return {
  AssistantEventBus,
  EVENTS
};

})();

const sharedModule = ((eventsModule, dataRootModule) => {
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AssistantEventBus, EVENTS } = eventsModule;
const { buildDataPaths } = dataRootModule;

const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_LOG_FILES = 5;
const SENSITIVE_KEY_PATTERN = /(?:password|passcode|token|secret|authorization|cookie|credential|api[_-]?key)/i;

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function ensureDirectory(dir) {
  if (!dir || fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
}

class Logger {
  constructor(config) {
    this.level = config?.level || 'info';
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const configuredDirectory = config?.directory || config?.logsDir || process.env.OPENX_LOG_DIR;
    this.directory = configuredDirectory || buildDataPaths(config).logsDir;
    this.maxFileSize = Number(config?.maxFileSize || DEFAULT_MAX_LOG_SIZE);
    this.maxFiles = Number(config?.maxFiles || DEFAULT_MAX_LOG_FILES);
    this.console = config?.console !== false;
    this.file = config?.file === true || (config?.file !== false && Boolean(configuredDirectory));
    this.lastCleanupByType = new Map();
    this.rotationSequence = 0;
  }

  _log(level, message, data) {
    if (this.levels[level] > this.levels[this.level]) return;
    const redactedData = this._redact(data || null);
    const suffix = this._formatData(redactedData);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: redactedData
    };
    if (this.console) {
      if (level === 'error') {
        console.error(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
      } else {
        console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
      }
    }
    this._writeEntry(level === 'error' ? 'error' : 'app', entry);
  }

  _formatData(data) {
    if (data === undefined || data === null || data === '') {
      return '';
    }

    if (typeof data === 'string') {
      return ` ${data}`;
    }

    try {
      const compact = JSON.stringify(data);
      if (!compact || compact === '{}') {
        return '';
      }
      return ` ${compact.length > 400 ? `${compact.slice(0, 397)}...` : compact}`;
    } catch (error) {
      return ` ${String(data)}`;
    }
  }

  _redact(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (depth > 6) return '[MaxDepth]';
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: typeof value.stack === 'string' ? value.stack.slice(0, 4000) : null
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map(item => this._redact(item, depth + 1));
    }
    if (typeof value === 'object') {
      const output = {};
      for (const [key, child] of Object.entries(value)) {
        output[key] = SENSITIVE_KEY_PATTERN.test(key)
          ? '[REDACTED]'
          : this._redact(child, depth + 1);
      }
      return output;
    }
    if (typeof value === 'string' && value.length > 2000) {
      return `${value.slice(0, 2000)}...[truncated]`;
    }
    return value;
  }

  _writeEntry(type, entry) {
    if (!this.file || !this.directory) return;
    try {
      ensureDirectory(this.directory);
      const logPath = path.join(this.directory, `${type}-${dateStamp()}.log`);
      const rotated = this._rotateIfNeeded(logPath, type);
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
      this._cleanupOldLogs(type, rotated);
    } catch (_) {
      // Logging must never break assistant execution.
    }
  }

  _rotateIfNeeded(logPath, type) {
    if (!fs.existsSync(logPath)) return false;
    const maxFileSize = Number.isFinite(this.maxFileSize) && this.maxFileSize > 0
      ? this.maxFileSize
      : DEFAULT_MAX_LOG_SIZE;
    const stats = fs.statSync(logPath);
    if (stats.size < maxFileSize) return false;

    let rotatedPath;
    do {
      rotatedPath = path.join(
        this.directory,
        `${type}-${dateStamp()}-${Date.now()}-${this.rotationSequence++}.log`
      );
    } while (fs.existsSync(rotatedPath));
    fs.renameSync(logPath, rotatedPath);
    return true;
  }

  _cleanupOldLogs(type, force = false) {
    const today = dateStamp();
    if (!force && this.lastCleanupByType.get(type) === today) return;
    this.lastCleanupByType.set(type, today);

    const maxFiles = Number.isFinite(this.maxFiles) && this.maxFiles > 0
      ? this.maxFiles
      : DEFAULT_MAX_LOG_FILES;
    const prefix = `${type}-`;
    const files = fs.readdirSync(this.directory)
      .filter(name => name.startsWith(prefix) && name.endsWith('.log'))
      .map(name => {
        const filePath = path.join(this.directory, name);
        const stats = fs.statSync(filePath);
        return { filePath, mtimeMs: stats.mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    for (const stale of files.slice(maxFiles)) {
      try {
        fs.unlinkSync(stale.filePath);
      } catch (_) {
        // Ignore locked files; the next cleanup pass can retry.
      }
    }
  }

  static writeCrashSync(error, context = {}, config = {}) {
    const logger = new Logger({ ...config, console: false });
    try {
      ensureDirectory(logger.directory);
      const payload = {
        timestamp: new Date().toISOString(),
        level: 'crash',
        message: error?.message || String(error || 'Unknown crash'),
        stack: error?.stack || null,
        context: logger._redact(context)
      };
      const logPath = path.join(logger.directory, `crash-${dateStamp()}.log`);
      const rotated = logger._rotateIfNeeded(logPath, 'crash');
      fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
      logger._cleanupOldLogs('crash', rotated);
    } catch (_) {
      // Last-resort crash logging cannot throw.
    }
  }

  error(message, data) { this._log('error', message, data); }
  warn(message, data) { this._log('warn', message, data); }
  info(message, data) { this._log('info', message, data); }
  debug(message, data) { this._log('debug', message, data); }
}

class Validator {
  static isString(value) {
    return typeof value === 'string';
  }

  static isNumber(value) {
    return typeof value === 'number' && !Number.isNaN(value);
  }

  static isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  static isInRange(value, min, max) {
    return value >= min && value <= max;
  }

  static isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  static sanitizePath(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>:"|?*]/g, '').trim();
  }

  static sanitizeCommand(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[;&|`$(){}\n\r]/g, '').trim();
  }

  static isValidFilename(name) {
    if (typeof name !== 'string') return false;
    if (name.length === 0 || name.length > 255) return false;
    return !/[<>:"/\\|?*\x00-\x1f]/.test(name);
  }
}

class IdGenerator {
  static generate() {
    return crypto.randomUUID();
  }

  static short() {
    return crypto.randomBytes(4).toString('hex');
  }
}

class Normalizer {
  static normalizeWhitespace(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/\s+/g, ' ').trim();
  }

  static normalizeText(input) {
    if (typeof input !== 'string') return '';
    return this.normalizeWhitespace(
      input
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
    );
  }

  static extractNumber(text) {
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  static extractPercentage(text) {
    const match = text.match(/(\d+)\s*%/);
    return match ? parseInt(match[0], 10) : null;
  }

  static tokenize(text) {
    const normalized = this.normalizeText(text);
    if (!normalized) return [];
    return normalized.split(/\s+/).filter(Boolean);
  }

  static expandContractions(text) {
    if (typeof text !== 'string') return '';

    const contractions = {
      "can't": 'cannot',
      "won't": 'will not',
      "don't": 'do not',
      "didn't": 'did not',
      "doesn't": 'does not',
      "i'm": 'i am',
      "it's": 'it is',
      "that's": 'that is',
      "what's": 'what is',
      "whats": 'what is',
      "you're": 'you are',
      "couldn't": 'could not',
      "shouldn't": 'should not',
      "wouldn't": 'would not'
    };

    let result = text;
    for (const [from, to] of Object.entries(contractions)) {
      result = result.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), to);
    }
    return result;
  }

  static damerauLevenshtein(a, b) {
    const source = a || '';
    const target = b || '';

    if (source === target) return 0;
    if (!source.length) return target.length;
    if (!target.length) return source.length;

    const matrix = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));

    for (let i = 0; i <= source.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= target.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= source.length; i += 1) {
      for (let j = 1; j <= target.length; j += 1) {
        const cost = source[i - 1] === target[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );

        if (
          i > 1 &&
          j > 1 &&
          source[i - 1] === target[j - 2] &&
          source[i - 2] === target[j - 1]
        ) {
          matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
        }
      }
    }

    return matrix[source.length][target.length];
  }

  static similarity(a, b) {
    const source = this.normalizeText(a);
    const target = this.normalizeText(b);

    if (!source && !target) return 1;
    if (!source || !target) return 0;

    const distance = this.damerauLevenshtein(source, target);
    return 1 - (distance / Math.max(source.length, target.length));
  }

  static findClosestOption(input, options, config = {}) {
    const normalizedInput = this.normalizeText(input);
    if (!normalizedInput || !Array.isArray(options) || options.length === 0) {
      return null;
    }

    const minSimilarity = config.minSimilarity ?? 0.72;
    const maxDistance = config.maxDistance ?? (normalizedInput.length >= 7 ? 2 : 1);
    let best = null;

    for (const option of options) {
      const normalizedOption = this.normalizeText(option);
      if (!normalizedOption) continue;

      const distance = this.damerauLevenshtein(normalizedInput, normalizedOption);
      const similarity = 1 - (distance / Math.max(normalizedInput.length, normalizedOption.length));

      if (distance > maxDistance || similarity < minSimilarity) {
        continue;
      }

      if (
        !best ||
        similarity > best.similarity ||
        (similarity === best.similarity && distance < best.distance)
      ) {
        best = {
          match: option,
          normalizedMatch: normalizedOption,
          similarity,
          distance
        };
      }
    }

    return best;
  }
}

return {
  Logger,
  Validator,
  IdGenerator,
  Normalizer,
  AssistantEventBus,
  EVENTS
};

})(eventsModule, dataRootModule);

module.exports = {
  ...sharedModule,
  ...eventsModule,
  ...dataRootModule
};
