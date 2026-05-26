const assert = require('assert');

describe('Voice Pipeline Primitives', function() {
  let AssistantEventBus;
  let SPEECH_STATES;
  let SpeechStateMachine;

  before(function() {
    AssistantEventBus = require('../../core/shared/index').AssistantEventBus;
    ({ SPEECH_STATES, SpeechStateMachine } = require('../../core/voice/state/index'));
  });

  it('should keep recent event history on the shared event bus', function() {
    const eventBus = new AssistantEventBus({ historyLimit: 2 });

    eventBus.publish('alpha', { value: 1 });
    eventBus.publish('beta', { value: 2 });
    eventBus.publish('gamma', { value: 3 });

    const events = eventBus.getRecentEvents(5);
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'beta');
    assert.equal(events[1].event, 'gamma');
  });

  it('should enforce valid speech state transitions', function() {
    const machine = new SpeechStateMachine(null);

    // Initial state is IDLE. Valid transitions:
    machine.transition(SPEECH_STATES.ACTIVATING, { source: 'test' });
    machine.transition(SPEECH_STATES.LISTENING, { source: 'test' });
    machine.transition(SPEECH_STATES.HEARING_SPEECH, { source: 'test' });
    machine.transition(SPEECH_STATES.TRANSCRIBING, { source: 'test' });
    machine.transition(SPEECH_STATES.THINKING, { source: 'test' });
    machine.transition(SPEECH_STATES.RESPONDING, { source: 'test' });
    machine.transition(SPEECH_STATES.IDLE, { source: 'test' });

    assert.throws(() => {
      // Trying to jump from IDLE directly to THINKING is invalid
      machine.transition(SPEECH_STATES.THINKING, { source: 'invalid' });
    }, /Invalid speech state transition/);
  });
});
