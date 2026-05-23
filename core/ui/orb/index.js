class OrbStateManager {
  constructor() {
    this._listeners = new Map();
    this._state = 'idle';
    this._states = ['idle', 'listening', 'processing', 'success', 'error'];
  }

  get state() {
    return this._state;
  }

  setState(newState) {
    if (!this._states.includes(newState)) return false;
    this._state = newState;
    this._emit('change', newState);
    return true;
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
    return () => {
      const listeners = this._listeners.get(event);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    };
  }

  _emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(cb => cb(data));
    }
  }
}

module.exports = OrbStateManager;
