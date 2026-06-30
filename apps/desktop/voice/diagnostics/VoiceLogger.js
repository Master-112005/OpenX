'use strict';

const fs = require('fs');
const path = require('path');
const DiagnosticsConfiguration = require('./DiagnosticsConfiguration');
const { sanitizeMetadata } = require('./privacy');

/**
 * Purpose: Writes local structured Voice diagnostics logs.
 * Responsibility: Record sanitized metadata only, rotate logs, and never store audio or private transcript content.
 * Dependencies: fs/path, DiagnosticsConfiguration, privacy sanitizer.
 * Lifecycle: Owned by DiagnosticsManager or injected into voice components.
 * Future implementation notes: This remains local and must never upload telemetry.
 */
class VoiceLogger {
  constructor(options = {}) {
    this.configuration = options.configuration instanceof DiagnosticsConfiguration
      ? options.configuration
      : new DiagnosticsConfiguration(options.configuration || {});
    this.enabled = options.enabled === true;
    this.logPath = options.logPath || path.join(this.configuration.pathFor('logs'), 'voice.log');
  }

  /**
   * Write an info log entry.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  info(message, metadata = {}) {
    return this._write('info', message, metadata);
  }

  /**
   * Write a warning log entry.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  warn(message, metadata = {}) {
    return this._write('warn', message, metadata);
  }

  /**
   * Write an error log entry.
   * @param {string} message Log message.
   * @param {object} metadata Log metadata.
   * @returns {{logged: boolean}}
   */
  error(message, metadata = {}) {
    return this._write('error', message, metadata);
  }

  rotateIfNeeded() {
    if (!fs.existsSync(this.logPath)) return { rotated: false };
    const stats = fs.statSync(this.logPath);
    if (stats.size < this.configuration.maximumLogSizeBytes) return { rotated: false };
    const rotatedPath = `${this.logPath}.${Date.now()}.bak`;
    fs.renameSync(this.logPath, rotatedPath);
    return { rotated: true, path: rotatedPath };
  }

  _write(level, message, metadata = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message: String(message || ''),
      metadata: sanitizeMetadata(metadata)
    };
    if (!this.enabled) return { logged: false, ...entry };
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      this.rotateIfNeeded();
      fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
      return { logged: true, ...entry };
    } catch (error) {
      return { logged: false, ...entry, error: error.message };
    }
  }
}

module.exports = VoiceLogger;
