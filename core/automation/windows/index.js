const { execSync } = require('child_process');
const Logger = require('../../shared/index').Logger;
const WindowsSessionController = require('../common/windows-session');

class WindowsController {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.session = new WindowsSessionController(config);
  }

  shutdown() {
    try {
      execSync('shutdown /s /t 5 /c "JARVIS initiated shutdown"', { timeout: 3000 });
      return { success: true, data: { action: 'shutdown', delay: 5 } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  restart() {
    try {
      execSync('shutdown /r /t 5 /c "JARVIS initiated restart"', { timeout: 3000 });
      return { success: true, data: { action: 'restart', delay: 5 } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  sleep() {
    try {
      execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { timeout: 3000 });
      return { success: true, data: { action: 'sleep' } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  lock() {
    try {
      execSync('rundll32.exe user32.dll,LockWorkStation', { timeout: 3000 });
      return { success: true, data: { action: 'lock' } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  minimizeWindow(windowName) {
    if (/^(?:all\s+windows?|all|everything)$/i.test(String(windowName || '').trim())) {
      return this.session.minimizeAllWindows();
    }
    return this.session.minimizeWindow(windowName);
  }

  maximizeWindow(windowName) {
    return this.session.maximizeWindow(windowName);
  }

  closeWindow(windowName) {
    return this.session.closeWindow(windowName);
  }

  sendKeys(windowName, keys, options = {}) {
    return this.session.sendKeys(windowName, keys, options);
  }

  listWindows() {
    return this.session.listWindows();
  }

  findWindow(windowName, options = {}) {
    return this.session.findWindow(windowName, options);
  }

  hibernate() {
    try {
      execSync('shutdown /h', { timeout: 3000 });
      return { success: true, data: { action: 'hibernate' } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  logOff() {
    try {
      execSync('shutdown /l', { timeout: 3000 });
      return { success: true, data: { action: 'logoff' } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = WindowsController;
