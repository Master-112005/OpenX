class OverlayManager {
  constructor() {
    this.activeOverlays = new Map();
  }

  show(id, content, options = {}) {
    const overlay = {
      id,
      content,
      options: {
        duration: options.duration || 0,
        blocking: options.blocking || false,
        position: options.position || 'center',
        ...options
      },
      timestamp: Date.now()
    };

    this.activeOverlays.set(id, overlay);
    return id;
  }

  dismiss(id) {
    this.activeOverlays.delete(id);
  }

  dismissAll() {
    this.activeOverlays.clear();
  }

  isActive(id) {
    return this.activeOverlays.has(id);
  }

  getActive() {
    return Array.from(this.activeOverlays.values());
  }
}

module.exports = OverlayManager;
