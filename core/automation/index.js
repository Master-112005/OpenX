const Logger = require('../shared/index').Logger;
const VolumeController = require('./volume/index');
const BrightnessController = require('./brightness/index');
const FileController = require('./files/index');
const FolderController = require('./folders/index');
const AppController = require('./apps/index');
const BrowserController = require('./browser/index');
const MediaController = require('./media/index');
const CommunicationsController = require('./communications/index');
const SystemController = require('./system/index');
const WindowsController = require('./windows/index');
const SchedulerController = require('./scheduler/index');

class AutomationEngine {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;

    this.volume = new VolumeController(config);
    this.brightness = new BrightnessController(config);
    this.files = new FileController(config);
    this.folders = new FolderController(config);
    this.apps = new AppController(config);
    this.browser = new BrowserController(config);
    this.media = new MediaController(config);
    this.communications = new CommunicationsController(config);
    this.system = new SystemController(config);
    this.windows = new WindowsController(config);
    this.scheduler = new SchedulerController(config);

    this._actionMap = {
      'volume.up': (entities) => entities.value ? this.volume.setVolume(entities.value) : this.volume.increaseVolume(),
      'volume.down': (entities) => entities.value ? this.volume.setVolume(entities.value) : this.volume.decreaseVolume(),
      'volume.set': (entities) => this.volume.setVolume(entities.value || 50),
      'volume.get': () => {
        const current = this.volume.getCurrentVolume();
        return { success: true, data: { value: current } };
      },
      'volume.mute': () => this.volume.mute(),
      'volume.unmute': () => this.volume.unmute(),
      'brightness.up': (entities) => entities.value ? this.brightness.setBrightness(entities.value) : this.brightness.increaseBrightness(),
      'brightness.down': (entities) => entities.value ? this.brightness.setBrightness(entities.value) : this.brightness.decreaseBrightness(),
      'brightness.set': (entities) => this.brightness.setBrightness(entities.value || 50),
      'brightness.get': () => {
        const current = this.brightness.getCurrentBrightness();
        if (current === null) {
          return { success: false, error: 'Brightness control not supported' };
        }
        return { success: true, data: { value: current } };
      },
      'app.open': async (entities) => {
        const appResult = await this.apps.open(entities.appName);
        if (appResult?.success) {
          return appResult;
        }

        const folderResult = this.folders.open(entities.appName);
        if (folderResult?.success) {
          return {
            success: true,
            data: {
              ...folderResult.data,
              app: entities.appName,
              launchMethod: 'folder'
            }
          };
        }

        return appResult;
      },
      'app.close': (entities) => this.apps.close(entities.appName),
      'app.switch': (entities) => this.apps.switchTo(entities.appName),
      'file.create': (entities) => this.files.create(entities.filename, entities.path),
      'file.open': (entities) => this.files.open(entities.filename, entities.path),
      'file.delete': (entities) => this.files.delete(entities.filename, entities.path),
      'file.rename': (entities) => this.files.rename(entities.oldName, entities.newName),
      'file.copy': (entities) => this.files.copy(entities.source, entities.destination),
      'file.move': (entities) => this.files.move(entities.source, entities.destination),
      'file.search': (entities) => this.files.search(entities.query),
      'file.list': (entities) => this.files.list(entities.path),
      'folder.create': (entities) => this.folders.create(entities.folderName, entities.path),
      'folder.delete': (entities) => this.folders.delete(entities.folderName, entities.path),
      'folder.move': (entities) => this.folders.move(entities.source, entities.destination),
      'folder.open': (entities) => this.folders.open(entities.folderName),
      'browser.open': (entities) => this.browser.open(entities.url),
      'browser.search': (entities) => this.browser.search(entities.query, entities),
      'media.play': (entities) => this.media.play(entities.mediaQuery, entities.mediaPlatform),
      'media.next': () => this.media.next(),
      'media.previous': () => this.media.previous(),
      'media.pause': () => this.media.pause(),
      'media.resume': () => this.media.resume(),
      'media.stop': () => this.media.stop(),
      'media.search': (entities) => this.media.search(entities.mediaQuery, entities.mediaPlatform),
      'message.compose': (entities) => this.communications.composeMessage(
        entities.contactName,
        entities.messageText,
        entities.platform
      ),
      'call.start': (entities) => this.communications.startCall(
        entities.contactName,
        entities.platform
      ),
      'timer.set': (entities) => this.scheduler.setTimer(entities.duration),
      'alarm.set': (entities) => this.scheduler.setAlarm(entities.timeExpression),
      'reminder.set': (entities) => this.scheduler.setReminder(entities.reminderText, {
        timeExpression: entities.timeExpression,
        duration: entities.duration
      }),
      'system.shutdown': () => this.windows.shutdown(),
      'system.restart': () => this.windows.restart(),
      'system.sleep': () => this.windows.sleep(),
      'system.lock': () => this.windows.lock(),
      'system.status': () => this.system.getStatus(),
      'system.time': () => this.system.getTime(),
      'system.date': () => this.system.getDate(),
      'system.cpu': () => this.system.getCPUUsage(),
      'system.memory': () => this.system.getMemoryUsage(),
      'system.battery': () => this.system.getBatteryStatus(),
      'system.disk': () => this.system.getDiskSpace(),
      'system.processes': () => this.system.getProcessCount(),
      'window.minimize': (entities) => this.windows.minimizeWindow(entities.windowName),
      'window.maximize': (entities) => this.windows.maximizeWindow(entities.windowName),
      'window.close': (entities) => this.windows.closeWindow(entities.windowName),
      'help': () => ({ success: true, data: {} }),
      'greeting': () => ({ success: true, data: {} }),
      'thanks': () => ({ success: true, data: {} })
    };
  }

  async execute(actionId, entities) {
    const handler = this._actionMap[actionId];
    if (!handler) {
      this.logger.error(`Unknown action: ${actionId}`);
      return { success: false, error: `Unknown action: ${actionId}` };
    }

    try {
      this.logger.info(`Executing: ${actionId}`, entities);
      const result = await handler(entities || {});
      return result;
    } catch (err) {
      this.logger.error(`Action execution failed: ${actionId}`, err);
      return { success: false, error: err.message };
    }
  }

  registerAction(actionId, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Action handler must be a function');
    }
    this._actionMap[actionId] = handler;
    this.logger.info(`Registered action: ${actionId}`);
  }

  unregisterAction(actionId) {
    delete this._actionMap[actionId];
    this.logger.info(`Unregistered action: ${actionId}`);
  }

  getActions() {
    return Object.keys(this._actionMap);
  }
}

module.exports = AutomationEngine;
