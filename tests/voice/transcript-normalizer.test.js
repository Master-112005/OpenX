const assert = require('assert');

describe('Transcript Normalizer', function() {
  let TranscriptNormalizer;

  before(function() {
    TranscriptNormalizer = require('../../core/voice/transcript/transcript-normalizer');
  });

  it('should normalize punctuation, casing, spacing, and filler words', function() {
    const normalizer = new TranscriptNormalizer();

    assert.equal(normalizer.normalize('Uh, Open   Chrome.'), 'open chrome');
    assert.equal(normalizer.normalize('okay search for ChatGPT!!!'), 'search for chatgpt');
  });
});
