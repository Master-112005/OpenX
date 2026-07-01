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
    this.format = options.format || 'human';
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
      component: this._componentFromMessage(message),
      message: this._messageWithoutComponent(message),
      metadata: sanitizeMetadata(metadata)
    };
    const line = this._formatLine(entry);
    if (!this.enabled) return { logged: false, ...entry };
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      this.rotateIfNeeded();
      fs.appendFileSync(this.logPath, `${line}\n`, 'utf8');
      return { logged: true, line, ...entry };
    } catch (error) {
      return { logged: false, line, ...entry, error: error.message };
    }
  }

  _formatLine(entry) {
    if (this.format === 'json') {
      return JSON.stringify(entry);
    }
    const level = String(entry.level || 'info').toUpperCase().padEnd(5, ' ');
    const component = String(entry.component || 'Voice').padEnd(17, ' ');
    const summary = this._formatMetadata(entry.metadata);
    return summary
      ? `${entry.timestamp}  ${level}  ${component}  ${entry.message}  | ${summary}`
      : `${entry.timestamp}  ${level}  ${component}  ${entry.message}`;
  }

  _componentFromMessage(message) {
    const match = String(message || '').match(/^\[([^\]]+)\]\s*(.*)$/);
    return match ? match[1] : 'Voice';
  }

  _messageWithoutComponent(message) {
    const raw = String(message || '').trim();
    const match = raw.match(/^\[[^\]]+\]\s*(.*)$/);
    return this._humanizeMessage(match ? match[1] : raw);
  }

  _humanizeMessage(message) {
    const normalized = String(message || 'event')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return 'Event recorded';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  _formatMetadata(metadata = {}) {
    const pairs = [];
    const push = (key, value) => {
      if (pairs.length >= 16 || value === undefined || value === null || value === '') return;
      pairs.push(`${this._humanKey(key)}=${this._formatValue(key, value)}`);
    };

    const preferred = [
      'state',
      'from',
      'to',
      'reason',
      'phase',
      'runId',
      'sessionId',
      'recognitionCycleId',
      'frameIndex',
      'endpointFrameIndex',
      'speechFrames',
      'silenceFrames',
      'confidence',
      'outcome',
      'error'
    ];
    for (const key of preferred) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) push(key, metadata[key]);
    }

    if (metadata.session && typeof metadata.session === 'object') {
      push('session', metadata.session.sessionId || metadata.session.id || metadata.session.state);
    }
    if (metadata.recognitionCycle && typeof metadata.recognitionCycle === 'object') {
      push('cycle', metadata.recognitionCycle.id || metadata.recognitionCycle.phase || metadata.recognitionCycle.state);
    }
    if (metadata.counters && typeof metadata.counters === 'object') {
      const counters = metadata.counters;
      const summary = [
        ['audio', counters.audioFrames],
        ['processed', counters.processedFrames],
        ['stt', counters.sttFrames],
        ['partial', counters.partialTranscripts],
        ['final', counters.finalTranscripts],
        ['busy', counters.audioFramesWhileBusy],
        ['stale', counters.staleAudioFrames],
        ['endpoints', counters.endpointDetections]
      ]
        .filter(([, value]) => Number(value) > 0)
        .map(([name, value]) => `${name}:${value}`)
        .join(',');
      push('pipeline', summary || 'idle');
    }

    for (const [key, value] of Object.entries(metadata)) {
      if (pairs.length >= 16) break;
      if (preferred.includes(key) || ['session', 'recognitionCycle', 'counters'].includes(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        push(key, value.id || value.sessionId || value.deviceId || value.name || value.message || '[object]');
      } else {
        push(key, value);
      }
    }

    return pairs.join(' | ');
  }

  _formatValue(key, value) {
    if (/length$/i.test(key) && typeof value === 'number') return `${value} chars`;
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
    if (typeof value === 'string') {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return 'empty';
      return /[\s|=]/.test(normalized) ? `"${normalized.slice(0, 120)}"` : normalized.slice(0, 120);
    }
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (value && typeof value === 'object') return value.message || value.name || value.id || '[object]';
    return String(value);
  }

  _humanKey(key) {
    return String(key || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[_\s]+/g, '-')
      .toLowerCase();
  }
}

module.exports = VoiceLogger;
