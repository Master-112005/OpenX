const assert = require('assert');

describe('Voice Pipeline Primitives', function() {
  let AssistantEventBus;
  let ActiveListener;
  let SPEECH_STATES;
  let SpeechStateMachine;

  before(function() {
    AssistantEventBus = require('../../core/shared/index').AssistantEventBus;
    ActiveListener = require('../../core/voice/listener/index');
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

    machine.transition(SPEECH_STATES.WAKE_DETECTED, { source: 'test' });
    machine.transition(SPEECH_STATES.LISTENING, { source: 'test' });
    machine.transition(SPEECH_STATES.HEARING_SPEECH, { source: 'test' });
    machine.transition(SPEECH_STATES.PROCESSING, { source: 'test' });

    assert.throws(() => {
      machine.transition(SPEECH_STATES.WAKE_DETECTED, { source: 'invalid' });
    }, /Invalid speech state transition/);
  });

  it('should finalize an utterance after speech detection', function() {
    const eventBus = new AssistantEventBus();
    const listener = new ActiveListener({
      voice: {
        silenceTimeout: 50,
        frameDurationMs: 20,
        preRollDurationMs: 40,
        stt: {
          maxDurationMs: 200,
          energyThreshold: 0.01
        }
      }
    }, { eventBus });

    const received = [];
    eventBus.subscribe('*', ({ event }) => {
      received.push(event);
    });

    listener.startSession({ trigger: 'test' });
    listener.ingestFrame({ samples: [0.001, 0.002], rms: 0.002, webrtcVad: false });
    listener.ingestFrame({ samples: [0.2, 0.2], rms: 0.2, webrtcVad: true });

    const utterance = listener.finalizeUtterance({
      text: 'open chrome',
      confidence: 0.9,
      backend: 'test',
      reason: 'manual'
    });

    assert.ok(utterance.id);
    assert.equal(utterance.text, 'open chrome');
    assert.ok(received.includes('listener.started'));
    assert.ok(received.includes('speech.detected'));
    assert.ok(received.includes('utterance.finalized'));
  });
});
