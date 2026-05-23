const EventEmitter = require('events');
const { EVENTS } = require('../../shared/index');

class UIStateManager extends EventEmitter {
  constructor(eventBus = null) {
    super();
    this.eventBus = eventBus;
    this._state = {
      orb: { visible: true, state: 'idle', position: { x: 0, y: 0 }, size: 60, opacity: 0.85 },
      chat: { open: false, visible: false },
      settings: { open: false },
      voice: { active: false, listening: false, speaking: false },
      theme: 'dark',
      notifications: []
    };
  }

  get(key) {
    return key ? this._state[key] : { ...this._state };
  }

  set(key, value) {
    if (this._state[key] !== undefined) {
      const old = this._state[key];
      this._state[key] = value;
      this.emit('change', { key, value, oldValue: old });
      this.emit(`change:${key}`, value);
      if (this.eventBus?.publish) {
        this.eventBus.publish(EVENTS.UI_STATE_CHANGED, {
          key,
          value,
          oldValue: old
        });
      }
    }
  }

  update(key, partial) {
    if (typeof this._state[key] === 'object' && this._state[key] !== null) {
      this.set(key, { ...this._state[key], ...partial });
    }
  }

  setOrbState(state) {
    this.update('orb', { state });
    this.emit('orb:state', state);
  }

  setOrbPosition(x, y) {
    this.update('orb', { position: { x, y } });
  }

  setListening(listening) {
    this.update('voice', { listening });
    if (listening) this.setOrbState('listening');
    else this.setOrbState('idle');
  }

  setSpeaking(speaking) {
    this.update('voice', { speaking });
  }

  setChatOpen(open) {
    this.update('chat', { open, visible: open });
  }

  reset() {
    const current = { ...this._state };
    this.emit('reset', current);
  }
}

module.exports = UIStateManager;
