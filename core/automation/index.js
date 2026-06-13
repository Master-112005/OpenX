const Logger = require('../shared/index').Logger;
const Normalizer = require('../shared/index').Normalizer;
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
const ScreenshotController = require('./screenshot/index');
const ActionVerifier = require('./common/action-verifier');

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
    this.screenshot = new ScreenshotController(config);
    this.verifier = new ActionVerifier({
      apps: this.apps,
      browser: this.browser,
      files: this.files,
      folders: this.folders,
      windows: this.windows,
      system: this.system
    });

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
        const appResult = await this.apps.open(entities.appName, entities);
        if (appResult?.success) {
          return appResult;
        }

        const folderResult = this.folders.open(entities.appName, entities);
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
        if (folderResult?.needsClarification) {
          return folderResult;
        }

        return appResult;
      },
      'app.close': (entities) => this.apps.close(entities.appName, entities),
      'app.switch': (entities) => this.apps.switchTo(entities.appName),
      'mode.start': (entities) => this._startMode(entities.modeName),
      'file.create': (entities) => this.files.create(entities.filename, entities.path),
      'file.open': (entities) => this.files.open(entities.filename, entities),
      'file.delete': (entities) => this.files.delete(entities.filename, entities.path),
      'file.rename': (entities) => this.files.rename(entities.oldName, entities.newName),
      'file.copy': (entities) => this.files.copy(entities.source, entities.destination),
      'file.move': (entities) => this.files.move(entities.source, entities.destination),
      'file.search': (entities) => this.files.search(entities.query),
      'file.smartFind': (entities) => this.files.smartFind(entities),
      'file.list': (entities) => this.files.list(entities.path, { fileType: entities.fileType }),
      'folder.create': (entities) => this.folders.create(entities.folderName, entities.path),
      'folder.delete': (entities) => this.folders.delete(entities.folderName, entities.path),
      'folder.move': (entities) => this.folders.move(entities.source, entities.destination),
      'folder.open': (entities) => this.folders.open(entities.folderName, entities),
      'browser.open': (entities) => this.browser.open(entities.url),
      'browser.search': (entities) => this.browser.search(entities.query, entities),
      'browser.siteSearch': (entities) => this.browser.siteSearch(entities.site, entities.query, entities),
      'browser.openFirstResult': (entities) => this.browser.openFirstResult(entities.query),
      'browser.closeTab': (entities) => this._closeBrowserTab(entities),
      'browser.listTabs': (entities) => this._listBrowserTabs(entities),
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
      'email.compose': (entities) => this.communications.composeEmail(
        entities.contactName,
        entities.subject,
        entities.body
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
      'system.calculate': (entities) => this.system.calculate(entities.expression),
      'system.screenshot': () => this.screenshot.capture(),
      'system.cpu': () => this.system.getCPUUsage(),
      'system.memory': () => this.system.getMemoryUsage(),
      'system.battery': () => this.system.getBatteryStatus(),
      'system.disk': () => this.system.getDiskSpace(),
      'system.processes': (entities) => entities?.target === 'apps'
        ? this.system.getRunningApps(entities)
        : this.system.getProcessCount(),
      'system.insight': (entities) => this.system.getInsight(entities.insightType),
      'system.bluetooth': (entities) => this.system.bluetooth(entities.enabled),
      'assistant.identity': () => ({ success: true, data: { name: 'JARVIS' } }),
      'assistant.userName': () => ({ success: true, data: { known: false } }),
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
      return this.verifier.verify(actionId, entities || {}, {
        success: false,
        error: `Unknown action: ${actionId}`
      });
    }

    try {
      this.logger.info(`Executing: ${actionId}`, entities);
      const result = await handler(entities || {});
      return this.verifier.verify(actionId, entities || {}, result);
    } catch (err) {
      this.logger.error(`Action execution failed: ${actionId}`, err);
      return this.verifier.verify(actionId, entities || {}, {
        success: false,
        error: err.message
      });
    }
  }

  _closeBrowserTab(entities = {}) {
    const requested = Normalizer.normalizeText(entities.browserName || 'browser');
    const tabQuery = Normalizer.normalizeText(entities.tabQuery || '');
    const browserMap = {
      browser: {
        windowName: 'browser',
        preferredProcessNames: ['chrome', 'msedge', 'firefox'],
        preferredTitleTokens: []
      },
      chrome: {
        windowName: 'chrome',
        preferredProcessNames: ['chrome'],
        preferredTitleTokens: ['chrome']
      },
      edge: {
        windowName: 'edge',
        preferredProcessNames: ['msedge'],
        preferredTitleTokens: ['edge']
      },
      firefox: {
        windowName: 'firefox',
        preferredProcessNames: ['firefox'],
        preferredTitleTokens: ['firefox']
      }
    };
    const target = browserMap[requested] || browserMap.browser;
    const titleTokens = tabQuery
      ? Normalizer.tokenize(tabQuery).filter(token => token.length > 1)
      : target.preferredTitleTokens;
    if (tabQuery) {
      return this._closeTargetedBrowserTabs(requested, target, tabQuery, titleTokens);
    }

    const windowName = tabQuery || target.windowName;
    const result = this.windows.sendKeys(windowName, '^w', {
      preferredProcessNames: target.preferredProcessNames,
      preferredTitleTokens: titleTokens
    });

    if (!result?.success) {
      if (tabQuery) {
        return {
          success: false,
          error: `Could not find a ${tabQuery} tab in ${requested}`
        };
      }
      return result;
    }

    return {
      success: true,
      data: {
        ...result.data,
        action: 'closeTab',
        browserName: requested,
        tabQuery
      }
    };
  }

  _listBrowserTabs(entities = {}) {
    const requested = Normalizer.normalizeText(entities.browserName || 'browser');
    const browserMap = {
      browser: ['chrome', 'msedge', 'firefox'],
      chrome: ['chrome'],
      edge: ['msedge'],
      firefox: ['firefox']
    };
    const processNames = browserMap[requested] || browserMap.browser;
    const windows = typeof this.windows.listWindows === 'function'
      ? this.windows.listWindows()
      : this.windows.session?.listWindows?.() || [];
    const tabs = windows
      .filter(window => processNames.includes(Normalizer.normalizeText(window.processName)))
      .map(window => ({
        title: this._cleanBrowserWindowTitle(window.title, window.processName),
        rawTitle: window.title,
        processName: window.processName,
        handle: window.handle
      }))
      .filter(tab => tab.title)
      .slice(0, 12);

    return {
      success: true,
      data: {
        browserName: requested,
        count: tabs.length,
        tabs,
        limitation: 'visible-browser-windows'
      }
    };
  }

  _cleanBrowserWindowTitle(title, processName) {
    const browserLabel = Normalizer.normalizeText(processName) === 'chrome'
      ? / - Google Chrome$/i
      : Normalizer.normalizeText(processName) === 'msedge'
        ? / - Microsoft Edge$/i
        : / - Mozilla Firefox$/i;
    return String(title || '').replace(browserLabel, '').trim();
  }

  _closeTargetedBrowserTabs(requested, target, tabQuery, titleTokens) {
    const closeLimit = 8;
    const closed = [];
    let lastResult = null;

    for (let attempt = 0; attempt < closeLimit; attempt += 1) {
      const result = this.windows.sendKeys(tabQuery, '^w', {
        preferredProcessNames: target.preferredProcessNames,
        preferredTitleTokens: titleTokens,
        requireTitleTokenMatch: true
      });

      if (!result?.success) {
        if (closed.length > 0) {
          return this._browserTabCloseSuccess(requested, tabQuery, closed, true);
        }
        return {
          success: false,
          error: `Could not find a ${tabQuery} tab in ${requested}`
        };
      }

      lastResult = result;
      closed.push(result.data);
      this._sleep(450);

      const stillOpen = this._findTargetedBrowserTab(requested, target, tabQuery, titleTokens);
      if (!stillOpen) {
        return this._browserTabCloseSuccess(requested, tabQuery, closed, true);
      }

      const sameHandle = result.data?.matchedHandle && String(stillOpen.handle) === String(result.data.matchedHandle);
      const sameTitle = Normalizer.normalizeText(stillOpen.title) === Normalizer.normalizeText(result.data?.matchedWindow || '');
      if (sameHandle && sameTitle && attempt >= 1) {
        return {
          success: false,
          error: `I tried to close the ${tabQuery} tab in ${requested}, but it still appears to be active`,
          data: {
            action: 'closeTab',
            browserName: requested,
            tabQuery,
            matchedWindow: result.data?.matchedWindow,
            verified: false
          }
        };
      }
    }

    return {
      success: false,
      error: `I could not verify that every ${tabQuery} tab in ${requested} closed`,
      data: {
        ...(lastResult?.data || {}),
        action: 'closeTab',
        browserName: requested,
        tabQuery,
        closedCount: closed.length,
        verified: false
      }
    };
  }

  _findTargetedBrowserTab(requested, target, tabQuery, titleTokens) {
    const finder = typeof this.windows.findWindow === 'function'
      ? this.windows.findWindow.bind(this.windows)
      : this.windows.session?.findWindow?.bind(this.windows.session);
    if (!finder) {
      return null;
    }

    return finder(tabQuery, {
      preferredProcessNames: target.preferredProcessNames,
      preferredTitleTokens: titleTokens,
      requireTitleTokenMatch: true
    });
  }

  _browserTabCloseSuccess(requested, tabQuery, closed, verified) {
    const lastClosed = closed[closed.length - 1] || {};
    return {
      success: true,
      data: {
        ...lastClosed,
        action: 'closeTab',
        browserName: requested,
        tabQuery,
        closedCount: closed.length,
        verified
      }
    };
  }

  _sleep(milliseconds) {
    if (!milliseconds) return;
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
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

  async _startMode(modeName) {
    const requestedName = String(modeName || '').trim();
    if (!requestedName) {
      return { success: false, error: 'Mode name is required' };
    }

    const modes = Array.isArray(this.config?.modes) ? this.config.modes : [];
    const mode = this._findMode(requestedName, modes);
    if (!mode) {
      return { success: false, error: `Mode not found: ${requestedName}` };
    }

    const appEntries = this._normalizeModeAppEntries(mode);
    const apps = appEntries.map(app => app.name).filter(Boolean);
    const appCommands = appEntries.flatMap(app => (
      app.instructions.flatMap(command => this._contextualizeModeInstruction(app.name, command))
    ));
    const commands = Array.isArray(mode.commands)
      ? mode.commands.map(command => String(command || '').trim()).filter(Boolean)
      : [];
    const allCommands = [...appCommands, ...commands].filter(Boolean);
    if (apps.length === 0 && allCommands.length === 0) {
      return { success: false, error: `Mode has no apps or commands configured: ${mode.name}` };
    }

    const opened = [];
    const failed = [];
    for (const appName of apps) {
      const result = await this.apps.open(appName);
      if (result?.success) {
        opened.push(appName);
      } else {
        failed.push({ appName, error: result?.error || 'Failed to open' });
      }
    }

    return {
      success: opened.length > 0 || allCommands.length > 0,
      error: failed.length > 0 ? `Some mode apps failed: ${failed.map(item => item.appName).join(', ')}` : undefined,
      data: {
        modeName: mode.name,
        opened,
        failed,
        appCount: apps.length,
        commands: allCommands
      }
    };
  }

  _normalizeModeAppEntries(mode) {
    if (!Array.isArray(mode?.apps)) {
      return [];
    }

    return mode.apps
      .map(app => {
        if (app && typeof app === 'object' && !Array.isArray(app)) {
          return {
            name: String(app.name || app.appName || '').trim(),
            instructions: this._normalizeInstructionList(app.instructions || app.commands || [])
          };
        }

        return {
          name: String(app || '').trim(),
          instructions: []
        };
      })
      .filter(app => app.name);
  }

  _normalizeInstructionList(value) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/[\n,]+/);

    return source
      .map(command => String(command || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 12);
  }

  _contextualizeModeInstruction(appName, instruction) {
    const app = Normalizer.normalizeText(appName);
    const command = String(instruction || '').trim().replace(/\s+/g, ' ');
    if (!command) {
      return '';
    }

    const lower = command.toLowerCase();
    const browserApp = /^(?:chrome|google chrome|msedge|edge|microsoft edge|firefox|browser)$/.test(app);
    if (browserApp) {
      const appLabel = app.includes('edge') ? 'edge' : app.includes('firefox') ? 'firefox' : 'chrome';
      const openInBrowserMatch = lower.match(/^open\s+(.+?)\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)$/i);
      if (openInBrowserMatch?.[1]) {
        const query = openInBrowserMatch[1].trim();
        return [`search for ${query} in ${appLabel}`, `open first result for ${query}`];
      }

      const openWebMatch = lower.match(/^open\s+(.+)$/i);
      if (openWebMatch?.[1] && !this._looksLikeLocalAppInstruction(openWebMatch[1])) {
        const query = openWebMatch[1].trim();
        return [`search for ${query} in ${appLabel}`, `open first result for ${query}`];
      }

      const searchMatch = lower.match(/^search\s+(?:for\s+)?(.+)$/i);
      if (searchMatch?.[1] && !/\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)$/i.test(lower)) {
        return `search for ${searchMatch[1].trim()} in ${appLabel}`;
      }

      if (/^(?:click|open)\s+(?:the\s+)?first\s+(?:link|result|search\s+result)\b/i.test(command)) {
        return 'open first search result';
      }
    }

    const youtubeApp = /^(?:youtube|yt)$/.test(app);
    if (youtubeApp && !/^(?:play|stream|listen|watch|pause|resume|unpause|stop|set|volume|next|previous|search)\b/i.test(command)) {
      return `play ${command} on youtube`;
    }

    return command;
  }

  _looksLikeLocalAppInstruction(value) {
    const target = Normalizer.normalizeText(value);
    const localAppTargets = new Set([
      'chrome',
      'edge',
      'firefox',
      'terminal',
      'cmd',
      'powershell',
      'code',
      'vscode',
      'visual studio code',
      'notepad',
      'paint',
      'calculator',
      'whatsapp',
      'discord',
      'spotify',
      'youtube',
      'photos',
      'clock',
      'microsoft store'
    ]);

    return localAppTargets.has(target);
  }

  _findMode(modeName, modes) {
    const normalized = this._normalizeModeName(modeName);
    const candidates = modes.filter(mode => mode && mode.name);
    const exact = candidates.find(mode => this._normalizeModeName(mode.name) === normalized);
    if (exact) {
      return exact;
    }

    const normalizedCandidates = candidates.map(mode => this._normalizeModeName(mode.name));
    const fuzzy = Normalizer.findClosestOption(normalized, normalizedCandidates, {
      minSimilarity: 0.64,
      maxDistance: 3
    });
    if (!fuzzy) {
      return null;
    }

    return candidates.find(mode => this._normalizeModeName(mode.name) === fuzzy.normalizedMatch) || null;
  }

  _normalizeModeName(modeName) {
    return Normalizer.normalizeText(modeName)
      .replace(/\b(?:developement|deveopemt|devlopement|devlopemt|develpment|dev)\b/g, 'development')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = AutomationEngine;
