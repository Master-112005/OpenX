const EventEmitter = require('events');

class NotificationManager extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
    this.maxNotifications = 50;
    this.timers = new Map();
  }

  show(message, type = 'info', duration = 5000) {
    const notification = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      message,
      type,
      duration,
      timestamp: Date.now()
    };

    this.notifications.push(notification);
    this.emit('notification', notification);

    if (this.notifications.length > this.maxNotifications) {
      const removed = this.notifications.shift();
      this._clearTimer(removed?.id);
    }

    if (duration > 0) {
      const timer = setTimeout(() => this.dismiss(notification.id), duration);
      this.timers.set(notification.id, timer);
    }

    return notification.id;
  }

  dismiss(id) {
    this._clearTimer(id);
    const idx = this.notifications.findIndex(n => n.id === id);
    if (idx !== -1) {
      this.notifications.splice(idx, 1);
      this.emit('dismiss', id);
    }
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }

  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration || 8000);
  }

  clear() {
    for (const id of this.timers.keys()) {
      this._clearTimer(id);
    }
    this.notifications = [];
    this.emit('clear');
  }

  getAll() {
    return [...this.notifications];
  }

  destroy() {
    this.clear();
    this.removeAllListeners();
  }

  _clearTimer(id) {
    if (!id || !this.timers.has(id)) {
      return;
    }

    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}

module.exports = NotificationManager;
