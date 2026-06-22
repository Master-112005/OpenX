const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Logger } = require('../../core/assistant/Data');

describe('Structured Logger', function() {
  let directory;

  beforeEach(function() {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openx-logs-'));
  });

  afterEach(function() {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('should write structured app and error logs with sensitive data redacted', function() {
    const logger = new Logger({ directory, console: false });
    logger.info('Started', { user: 'local', password: 'unsafe', nested: { apiKey: 'secret' } });
    logger.error('Failed', { token: 'unsafe' });

    const appFile = fs.readdirSync(directory).find(name => name.startsWith('app-'));
    const errorFile = fs.readdirSync(directory).find(name => name.startsWith('error-'));
    const appEntry = JSON.parse(fs.readFileSync(path.join(directory, appFile), 'utf8').trim());
    const errorEntry = JSON.parse(fs.readFileSync(path.join(directory, errorFile), 'utf8').trim());

    assert.equal(appEntry.message, 'Started');
    assert.equal(appEntry.data.password, '[REDACTED]');
    assert.equal(appEntry.data.nested.apiKey, '[REDACTED]');
    assert.equal(errorEntry.data.token, '[REDACTED]');
  });

  it('should redact console output as well as file output', function() {
    const logger = new Logger({ directory, file: false });
    const originalLog = console.log;
    let output = '';
    console.log = value => { output += value; };
    try {
      logger.info('Authentication', { password: 'never-print-this' });
    } finally {
      console.log = originalLog;
    }

    assert.match(output, /\[REDACTED\]/);
    assert.doesNotMatch(output, /never-print-this/);
  });

  it('should rotate logs and enforce the retention limit', function() {
    const logger = new Logger({
      directory,
      console: false,
      maxFileSize: 120,
      maxFiles: 3
    });

    for (let index = 0; index < 12; index += 1) {
      logger.info('Rotation record', { index, value: 'x'.repeat(100) });
    }

    const appFiles = fs.readdirSync(directory).filter(name => name.startsWith('app-'));
    assert.ok(appFiles.length > 1);
    assert.ok(appFiles.length <= 3);
  });

  it('should create redacted crash records with stack and context', function() {
    Logger.writeCrashSync(
      new Error('renderer failed'),
      { origin: 'renderer', authorization: 'unsafe' },
      { directory, maxFiles: 5 }
    );

    const crashFile = fs.readdirSync(directory).find(name => name.startsWith('crash-'));
    const crashEntry = JSON.parse(fs.readFileSync(path.join(directory, crashFile), 'utf8').trim());
    assert.equal(crashEntry.message, 'renderer failed');
    assert.match(crashEntry.stack, /renderer failed/);
    assert.equal(crashEntry.context.authorization, '[REDACTED]');
  });

  it('should preserve useful Error diagnostics in structured log data', function() {
    const logger = new Logger({ directory, console: false });
    logger.error('Launch failed', new Error('executable missing'));

    const errorFile = fs.readdirSync(directory).find(name => name.startsWith('error-'));
    const errorEntry = JSON.parse(fs.readFileSync(path.join(directory, errorFile), 'utf8').trim());
    assert.equal(errorEntry.data.name, 'Error');
    assert.equal(errorEntry.data.message, 'executable missing');
    assert.match(errorEntry.data.stack, /executable missing/);
  });
});
