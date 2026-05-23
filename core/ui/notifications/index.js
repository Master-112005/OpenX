const EventEmitter = require('events');

class NotificationManager extends EventEmitter {
  constructor() {
    super();
    this.notifications = [];
    this.maxNotifications = 50;
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
      this.notifications.shift();
    }

    if (duration > 0) {
      setTimeout(() => this.dismiss(notification.id), duration);
    }

    return notification.id;
  }

  dismiss(id) {
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
    this.notifications = [];
    this.emit('clear');
  }

  getAll() {
    return [...this.notifications];
  }
}

module.exports = NotificationManager;
