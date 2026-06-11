const assert = require('assert');

describe('Command Recovery Reranker', function() {
  let CommandRecoveryReranker;

  before(function() {
    CommandRecoveryReranker = require('../../core/voice/recovery/reranker');
  });

  it('should recover common STT command and app mistakes', function() {
    const reranker = new CommandRecoveryReranker({
      minConfidence: 0.7
    });

    assert.equal(reranker.recover('open crow').correctedText, 'open chrome');
    assert.equal(reranker.recover('start spotfy').correctedText, 'start spotify');
    assert.equal(reranker.recover('open v s code').correctedText, 'open vscode');
    assert.equal(reranker.recover('turn of blue tooth').correctedText, 'turn off bluetooth');
    assert.equal(reranker.recover('check stroage space').correctedText, 'check storage space');
  });

  it('should leave low-confidence text unchanged', function() {
    const reranker = new CommandRecoveryReranker({
      minConfidence: 0.95
    });
    const result = reranker.recover('random words here');

    assert.equal(result.correctedText, 'random words here');
    assert.equal(result.changed, false);
  });
});
