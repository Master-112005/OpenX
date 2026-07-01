const assert = require('assert');

const TextToSpeech = require('../../apps/desktop/voice/tts');

describe('Text To Speech', function() {
  it('should keep spoken output bounded for long assistant responses', function() {
    const tts = new TextToSpeech({
      voice: {
        tts: {
          maxSpeechChars: 180
        }
      }
    });
    const longResponse = [
      'I found several matching files in Downloads.',
      'The first one is the latest report and the second one is a backup copy.',
      'Here are more details that should stay in chat instead of being read aloud.',
      'This final sentence is intentionally extra text.'
    ].join(' ');

    const speech = tts._prepareSpeechText(longResponse);

    assert.ok(speech.length <= 180);
    assert.equal(speech.includes('intentionally extra text'), false);
  });
});
