const assert = require('assert');

describe('Entity Extractor', function() {
  let EntityExtractor;

  before(function() {
    EntityExtractor = require('../../core/assistant/entities/index');
  });

  it('should extract numeric value', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'value', type: 'number', required: true }] };
    const entities = extractor.extract(intent, 'set volume to 70 percent');
    assert.equal(entities.value, 70);
  });

  it('should clamp values above 100', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'value', type: 'number', required: true }] };
    const entities = extractor.extract(intent, 'set volume to 150');
    assert.equal(entities.value, 100);
  });

  it('should extract app name from command', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'appName', type: 'string', required: true }] };
    const entities = extractor.extract(intent, 'open chrome');
    assert.equal(entities.appName, 'chrome');
  });

  it('should resolve app aliases', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'appName', type: 'string', required: true }] };
    const entities = extractor.extract(intent, 'open visual studio code');
    assert.equal(entities.appName, 'code');
  });

  it('should resolve misspelled app names', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'appName', type: 'string', required: true }] };
    const entities = extractor.extract(intent, 'opne chrmoe');
    assert.equal(entities.appName, 'chrome');
  });

  it('should resolve multi-word app aliases', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'appName', type: 'string', required: true }] };
    const entities = extractor.extract(intent, 'open apple music');
    assert.equal(entities.appName, 'apple music');
  });

  it('should extract filename', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'filename', type: 'string', required: true }] };
    const entities = extractor.extract(intent, 'delete file report.pdf');
    assert.equal(entities.filename, 'report.pdf');
  });

  it('should extract filename and path for file creation', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'filename', type: 'string', required: true },
        { name: 'path', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'Create file report.pdf on desktop');
    assert.equal(entities.filename, 'report.pdf');
    assert.equal(entities.path, 'desktop');
  });

  it('should extract filename and path for file deletion', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'filename', type: 'string', required: true },
        { name: 'path', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'delete practice.java file from desktop');
    assert.equal(entities.filename, 'practice.java');
    assert.equal(entities.path, 'desktop');
  });

  it('should extract folder name and path', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'folderName', type: 'string', required: true },
        { name: 'path', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'create folder Projects on desktop');
    assert.equal(entities.folderName, 'Projects');
    assert.equal(entities.path, 'desktop');
  });

  it('should extract file move source and destination', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'source', type: 'string', required: true },
        { name: 'destination', type: 'string', required: true }
      ]
    };
    const entities = extractor.extract(intent, 'move notes.txt from desktop to downloads');
    assert.equal(entities.source, 'notes.txt from desktop');
    assert.equal(entities.destination, 'downloads');
  });

  it('should return null for missing value', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'value', type: 'number', required: true }] };
    const entities = extractor.extract(intent, 'set volume');
    assert.strictEqual(entities.value, null);
  });

  it('should extract timer duration in minutes', function() {
    const extractor = new EntityExtractor({});
    const intent = { entities: [{ name: 'duration', type: 'number', required: true }] };
    const entities = extractor.extract(intent, 'set timer for 5 min');
    assert.equal(entities.duration, 5);
  });

  it('should extract reminder time and message', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'timeExpression', type: 'string', required: false },
        { name: 'reminderText', type: 'string', required: true }
      ]
    };
    const entities = extractor.extract(intent, 'remind at 1 pm to eat lunch');
    assert.equal(entities.timeExpression, '1 pm');
    assert.equal(entities.reminderText, 'eat lunch');
  });

  it('should extract message details for whatsapp drafts', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'contactName', type: 'string', required: true },
        { name: 'messageText', type: 'string', required: true },
        { name: 'platform', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'say hi to daddy on whatsapp');
    assert.equal(entities.contactName, 'daddy');
    assert.equal(entities.messageText, 'hi');
    assert.equal(entities.platform, 'whatsapp');
  });

  it('should extract call details', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'contactName', type: 'string', required: true },
        { name: 'platform', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'call bunty on whatsapp');
    assert.equal(entities.contactName, 'bunty');
    assert.equal(entities.platform, 'whatsapp');
  });

  it('should extract ask-style whatsapp messages', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'contactName', type: 'string', required: true },
        { name: 'messageText', type: 'string', required: true },
        { name: 'platform', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'ask daddy to call me');
    assert.equal(entities.contactName, 'daddy');
    assert.equal(entities.messageText, 'call me');
  });

  it('should recover common typo in message verbs', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'contactName', type: 'string', required: true },
        { name: 'messageText', type: 'string', required: true },
        { name: 'platform', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'massage daddy to call me');
    assert.equal(entities.contactName, 'daddy');
    assert.equal(entities.messageText, 'call me');
  });

  it('should extract media details from natural playback phrasing', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [
        { name: 'mediaQuery', type: 'string', required: true },
        { name: 'mediaPlatform', type: 'string', required: false }
      ]
    };
    const entities = extractor.extract(intent, 'put on the playdate song on youtube');
    assert.equal(entities.mediaQuery, 'playdate');
    assert.equal(entities.mediaPlatform, 'youtube');
  });

  it('should extract window names from maximize commands', function() {
    const extractor = new EntityExtractor({});
    const intent = {
      entities: [{ name: 'windowName', type: 'string', required: false }]
    };
    const entities = extractor.extract(intent, 'maximize the youtube window please');
    assert.equal(entities.windowName, 'youtube');
  });
});
