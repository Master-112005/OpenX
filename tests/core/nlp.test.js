const assert = require('assert');

describe('NLP Processor', function() {
  let NlpProcessor, IntentRegistry;

  before(function() {
    NlpProcessor = require('../../core/assistant/nlp/index');
    IntentRegistry = require('../../core/assistant/intents/index').IntentRegistry;
  });

  it('should normalize compact sports year tokens and classify knowledge questions', function() {
    const nlp = new NlpProcessor(new IntentRegistry());
    const prepared = nlp.prepare('who is the winner of ipl2020');

    assert.equal(prepared.correctedText, 'who is the winner of ipl 2020');
    assert.equal(prepared.query.type, 'knowledge-question');
  });

  it('should classify local file-type questions', function() {
    const nlp = new NlpProcessor(new IntentRegistry());
    const prepared = nlp.prepare('what are the pdfs on the desktop');

    assert.equal(prepared.query.type, 'local-file-question');
    assert.equal(prepared.query.localLocation, 'desktop');
    assert.equal(prepared.query.requestedFileType, 'pdf');
  });

  it('should correct common domain typos before search routing', function() {
    const nlp = new NlpProcessor(new IntentRegistry());
    const prepared = nlp.prepare('who is the capatin of indian cricket team in 2026');

    assert.equal(prepared.correctedText, 'who is the captain of indian cricket team in 2026');
    assert.equal(prepared.query.type, 'knowledge-question');
  });
});
