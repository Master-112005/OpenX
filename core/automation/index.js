const Logger = require('../assistant/Data').Logger;
const Normalizer = require('../assistant/Data').Normalizer;
const VolumeController = require('./volume');
const BrightnessController = require('./brightness');
const FileController = require('./files');
const FolderController = require('./folders');
const AppController = require('./apps');
const BrowserController = require('./browser');
const MediaController = require('./media');
const CommunicationsController = require('./communications');
const SystemController = require('./system');
const WindowsController = require('./windows');
const SchedulerController = require('./scheduler');
const ScreenshotController = require('./screenshot-recording');
const FormAutomation = require('../../plugins/forms');
const ActionVerifier = require('./common/action-verification');

class AutomationEngine {
  constructor(config) {
    this.logger = new Logger(config?.logging || { level: 'info' });
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
    this.forms = new FormAutomation(config, {
      learning: config?.learningStore || null,
      browser: this.browser,
      windows: this.windows
    });
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
      'app.newTab': (entities) => this.apps.openNewTab(entities.appName),
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
      'folder.search': (entities) => this.folders.search(entities.query),
      'browser.open': (entities) => this.browser.open(entities.url, entities),
      'browser.search': (entities) => this.browser.search(entities.query, entities),
      'browser.siteSearch': (entities) => this.browser.siteSearch(entities.site, entities.query, entities),
      'browser.openFirstResult': (entities) => this.browser.openFirstResult(entities.query),
      'browser.openTab': (entities) => this._openBrowserTab(entities),
      'browser.closeTab': (entities) => this._closeBrowserTab(entities),
      'browser.listTabs': (entities) => this._listBrowserTabs(entities),
      'media.play': (entities) => this.media.play(entities.mediaQuery, entities.mediaPlatform),
      'media.next': () => this.media.next(),
      'media.previous': () => this.media.previous(),
      'media.pause': () => this.media.pause(),
      'media.resume': () => this.media.resume(),
      'media.stop': () => this.media.stop(),
      'media.search': (entities) => this.media.search(entities.mediaQuery, entities.mediaPlatform),
      'media.mute': () => this.media.mute(),
      'media.unmute': () => this.media.unmute(),
      'media.volumeUp': () => this.media.volumeUp(),
      'media.volumeDown': () => this.media.volumeDown(),
      'media.fullscreen': () => this.media.fullscreen(),
      'media.exitFullscreen': () => this.media.exitFullscreen(),
      'media.replay': () => this.media.replay(),
      'media.repeat': () => this.media.repeat(),
      'media.shuffle': () => this.media.shuffle(),
      'media.favorite': () => this.media.favorite(),
      'media.like': () => this.media.like(),
      'media.subscribe': () => this.media.subscribe(),
      'media.status': () => this.media.status(),
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
      'form.fill': (entities) => this.forms.fill(entities),
      'system.cpu': () => this.system.getCPUUsage(),
      'system.memory': () => this.system.getMemoryUsage(),
      'system.battery': () => this.system.getBatteryStatus(),
      'system.disk': () => this.system.getDiskSpace(),
      'system.processes': (entities) => entities?.target === 'apps'
        ? this.system.getRunningApps(entities)
        : this.system.getProcessCount(),
      'system.insight': (entities) => this.system.getInsight(entities.insightType),
      'system.bluetooth': (entities) => this.system.bluetooth(entities.enabled),
      'assistant.identity': () => ({ success: true, data: { name: this.config?.assistant?.displayName || 'JARVIS' } }),
      'assistant.userName': () => ({ success: true, data: { known: false } }),
      'assistant.capability': (entities) => ({
        success: true,
        data: {
          action: 'capability.recognized',
          capability: entities.capability || 'general',
          operation: entities.operation || null,
          target: entities.target || null,
          rawCommand: entities.rawCommand || ''
        }
      }),
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

  async _closeBrowserTab(entities = {}) {
    const requested = Normalizer.normalizeText(entities.browserName || 'browser');
    const tabQuery = Normalizer.normalizeText(entities.tabQuery || '');
    const selectedTabIndex = entities.selectedTabIndex;
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

    if (!tabQuery) {
      const windowName = target.windowName;
      const result = this.windows.sendKeys(windowName, '^w', {
        preferredProcessNames: target.preferredProcessNames,
        preferredTitleTokens: titleTokens
      });

      if (!result?.success) {
        return result;
      }

      return {
        success: true,
        data: {
          ...result.data,
          action: 'closeTab',
          browserName: requested,
          tabQuery: 'current'
        }
      };
    }

    if (selectedTabIndex !== undefined && selectedTabIndex !== null) {
      return this._closeSelectedTab(requested, target, tabQuery, selectedTabIndex);
    }

    const listResult = await this._listBrowserTabs({ browserName: requested });
    const allTabs = listResult.success ? listResult.data.tabs : [];
    const matchedTabs = this._matchTabsByQuery(tabQuery, allTabs);

    if (matchedTabs.length === 0) {
      const fallbackResult = this._closeTargetedBrowserTabs(requested, target, tabQuery, titleTokens);
      if (fallbackResult.success) {
        return fallbackResult;
      }
      return {
        success: false,
        error: fallbackResult.error,
        needsClarification: fallbackResult.error?.includes('still appears to be active') ? true : undefined,
        data: {
          ...fallbackResult.data,
          action: 'closeTab',
          browserName: requested,
          tabQuery,
          availableTabs: allTabs.slice(0, 10)
        }
      };
    }

    if (matchedTabs.length > 1) {
      const tabOptions = matchedTabs.slice(0, 8).map((tab, idx) => ({
        index: idx + 1,
        title: tab.title,
        url: tab.url,
        isActiveTab: tab.isActiveTab,
        matchScore: tab.matchScore,
        entities: {
          selectedTabIndex: idx
        }
      }));

      return {
        success: false,
        needsClarification: true,
        error: `I found ${matchedTabs.length} tabs matching "${tabQuery}". Which one should I close?`,
        data: {
          clarificationType: 'browser.multipleTabMatch',
          browserName: requested,
          tabQuery,
          matchedTabs: tabOptions
        }
      };
    }

    const matchedTab = matchedTabs[0];
    const closeResult = await this._closeDiscoveredBrowserTab(requested, target, matchedTab);

    if (closeResult.success) {
      return {
        success: true,
        data: {
          ...closeResult.data,
          action: 'closeTab',
          browserName: requested,
          tabQuery: matchedTab.title,
          closedTabTitle: matchedTab.title
        }
      };
    }

    return {
      success: false,
      error: closeResult.error || `Could not close the "${matchedTab.title}" tab in ${requested}`,
      data: {
        ...closeResult.data,
        action: 'closeTab',
        browserName: requested,
        tabQuery: matchedTab.title,
        matchedTab,
        availableTabs: allTabs.slice(0, 10)
      }
    };
  }

  async _closeSelectedTab(requested, target, originalQuery, selectedIndex) {
    const listResult = await this._listBrowserTabs({ browserName: requested });
    const allTabs = listResult.success ? listResult.data.tabs : [];
    const matchedTabs = this._matchTabsByQuery(originalQuery, allTabs);

    if (selectedIndex < 0 || selectedIndex >= matchedTabs.length) {
      return {
        success: false,
        error: `Invalid tab selection. Please choose between 1 and ${matchedTabs.length}.`
      };
    }

    const selectedTab = matchedTabs[selectedIndex];
    const closeResult = await this._closeDiscoveredBrowserTab(requested, target, selectedTab);

    if (closeResult.success) {
      return {
        success: true,
        data: {
          ...closeResult.data,
          action: 'closeTab',
          browserName: requested,
          tabQuery: selectedTab.title,
          closedTabTitle: selectedTab.title
        }
      };
    }

    return {
      success: false,
      error: `Could not close the "${selectedTab.title}" tab in ${requested}`,
      data: closeResult.data
    };
  }

  async _listBrowserTabs(entities = {}) {
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

    const cdpTabs = await this._getCdpTabs(requested, processNames);
    const uiTabs = typeof this.windows.listBrowserTabs === 'function'
      ? this.windows.listBrowserTabs(processNames)
      : this.windows.session?.listBrowserTabs?.(processNames) || [];
    if (uiTabs.length > 0) {
      const cdpByTitle = new Map((cdpTabs.data?.tabs || []).map(tab => [
        `${Normalizer.normalizeText(tab.processName)}:${Normalizer.normalizeText(tab.title)}`,
        tab
      ]));
      const tabs = uiTabs.map(tab => {
        const cdpTab = cdpByTitle.get(
          `${Normalizer.normalizeText(tab.processName)}:${Normalizer.normalizeText(tab.title)}`
        );
        return cdpTab ? { ...tab, url: cdpTab.url, id: cdpTab.id } : tab;
      });
      return {
        success: true,
        data: {
          browserName: requested,
          count: tabs.length,
          tabs,
          responseMode: entities.responseMode || 'list',
          limitation: 'ui-automation-tabs',
          verifiedAllTabs: true
        }
      };
    }

    if (cdpTabs.success && cdpTabs.data.tabs.length > 0) {
      cdpTabs.data.responseMode = entities.responseMode || 'list';
      return cdpTabs;
    }

    const tabs = windows
      .filter(window => processNames.includes(Normalizer.normalizeText(window.processName)))
      .map(window => ({
        title: this._cleanBrowserWindowTitle(window.title, window.processName),
        rawTitle: window.title,
        processName: window.processName,
        handle: window.handle,
        windowTitle: window.title,
        isActiveTab: true
      }))
      .filter(tab => tab.title)
      .slice(0, 12);

    return {
      success: true,
      data: {
        browserName: requested,
        count: tabs.length,
        tabs,
        responseMode: entities.responseMode || 'list',
        limitation: 'visible-browser-windows',
        verifiedAllTabs: false
      }
    };
  }

  async _openBrowserTab(entities = {}) {
    const requested = Normalizer.normalizeText(entities.browserName || 'browser');
    const tabQuery = Normalizer.normalizeText(entities.tabQuery || '');
    if (!tabQuery) {
      return { success: false, error: 'No browser tab name was provided' };
    }

    const browserMap = {
      browser: ['chrome', 'msedge', 'firefox'],
      chrome: ['chrome'],
      edge: ['msedge'],
      firefox: ['firefox']
    };
    const processNames = browserMap[requested] || browserMap.browser;

    if (!entities.forceNewTab) {
      const listed = await this._listBrowserTabs({ browserName: requested });
      const matches = this._matchTabsByQuery(tabQuery, listed.data?.tabs || []);
      if (matches.length > 0 && typeof this.windows.focusBrowserTab === 'function') {
        const focused = this.windows.focusBrowserTab(matches[0].title, processNames);
        if (focused?.success) {
          return {
            success: true,
            data: {
              ...focused.data,
              action: 'focusTab',
              browserName: requested,
              tabQuery,
              tabTitle: matches[0].title,
              focusedExistingTab: true,
              verified: true
            }
          };
        }
      }
    }

    const opened = await this.browser.search(tabQuery, {
      openInBrowser: true,
      browserName: requested
    });
    return opened?.success
      ? {
          success: true,
          data: {
            ...opened.data,
            action: 'openTab',
            browserName: requested,
            tabQuery,
            focusedExistingTab: false,
            openedNewTab: true
          }
        }
      : opened;
  }

  async _getCdpTabs(requested, processNames) {
    const debugPorts = { chrome: 9222, msedge: 9222, firefox: 9222 };

    try {
      const tabs = [];

      for (const [browser, port] of Object.entries(debugPorts)) {
        if (!processNames.includes(browser) && !requested.includes('browser')) {
          continue;
        }

        try {
          const response = await this._httpGet(`http://localhost:${port}/json`, 2000);
          if (response) {
            const parsed = JSON.parse(response);
            for (const tab of parsed) {
              if (tab.type === 'page' && tab.url) {
                tabs.push({
                  title: tab.title || 'Untitled',
                  url: tab.url,
                  rawTitle: tab.title || '',
                  processName: browser,
                  id: tab.id,
                  webSocketDebuggerUrl: tab.webSocketDebuggerUrl,
                  isActiveTab: tab.active || false
                });
              }
            }
          }
        } catch (e) {
        }
      }

      if (tabs.length > 0) {
        return {
          success: true,
          data: {
            browserName: requested,
            count: tabs.length,
            tabs,
            limitation: 'cdp-tabs',
            verifiedAllTabs: true
          }
        };
      }
    } catch (err) {
    }

    return { success: false };
  }

  _httpGet(url, timeout) {
    try {
      const http = require('http');
      return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      }).catch(() => null);
    } catch (e) {
      return null;
    }
  }

  _matchTabsByQuery(tabQuery, tabs) {
    if (!tabQuery || !tabs || tabs.length === 0) {
      return [];
    }

    const queryLower = tabQuery.toLowerCase().trim();
    const queryTokens = Normalizer.tokenize(queryLower).filter(t => t.length > 1);

    const scored = tabs.map(tab => {
      const titleLower = (tab.title || '').toLowerCase();
      const urlLower = (tab.url || '').toLowerCase();
      const rawTitleLower = (tab.rawTitle || '').toLowerCase();
      let score = 0;

      if (titleLower === queryLower || rawTitleLower === queryLower) {
        score = 200;
      } else if (titleLower.includes(queryLower) || rawTitleLower.includes(queryLower)) {
        score = 150;
      } else if (urlLower.includes(queryLower)) {
        score = 130;
      }

      for (const token of queryTokens) {
        if (titleLower.includes(token) || rawTitleLower.includes(token)) {
          score += 40;
        }
        if (urlLower.includes(token)) {
          score += 25;
        }
      }

      const titleSimilarity = Normalizer.similarity(queryLower, titleLower);
      if (titleSimilarity >= 0.5) {
        score += Math.round(titleSimilarity * 80);
      }

      return { tab, score };
    });

    return scored
      .filter(item => item.score >= 40)
      .sort((a, b) => b.score - a.score)
      .map(item => ({ ...item.tab, matchScore: item.score }));
  }

  _cleanBrowserWindowTitle(title, processName) {
    const browserLabel = Normalizer.normalizeText(processName) === 'chrome'
      ? / - Google Chrome$/i
      : Normalizer.normalizeText(processName) === 'msedge'
        ? / - Microsoft Edge$/i
        : / - Mozilla Firefox$/i;
    return String(title || '').replace(browserLabel, '').trim();
  }

  _findCdpTabId(tabTitle, tabs) {
    const matched = tabs.find(t =>
      (t.title === tabTitle || t.rawTitle === tabTitle) && t.id
    );
    return matched?.id || null;
  }

  _closeBrowserTabViaCdp(tabId, browser) {
    const debugPorts = { chrome: 9222, msedge: 9222, firefox: 9222 };
    const port = debugPorts[browser] || 9222;

    try {
      const http = require('http');

      const getTabs = () => new Promise((resolve) => {
        const req = http.get(`http://localhost:${port}/json`, { timeout: 2000 }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve([]); }
          });
        });
        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
      });

      return getTabs().then(tabs => {
        const tab = tabs.find(t => String(t.id) === String(tabId));
        if (!tab || !tab.webSocketDebuggerUrl) {
          return { success: false, error: 'Tab not found via CDP' };
        }

        return { success: true, data: { tabId, title: tab.title, url: tab.url } };
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _createMinimalWs() {
    return {
      WebSocket: class {
        constructor(url) { this.url = url; }
        send() {}
        close() {}
      }
    };
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

  async _closeDiscoveredBrowserTab(requested, target, tab) {
    if (typeof this.windows.closeBrowserTab !== 'function') {
      const titleTokens = Normalizer.tokenize(tab.title).filter(token => token.length > 1);
      return this._closeTargetedBrowserTabs(requested, target, tab.title, titleTokens);
    }

    const closed = this.windows.closeBrowserTab(tab.title, target.preferredProcessNames);
    if (!closed?.success) {
      return closed;
    }

    this._sleep(300);
    const after = await this._listBrowserTabs({ browserName: requested });
    const stillOpen = (after.data?.tabs || []).some(candidate => (
      Normalizer.normalizeText(candidate.title) === Normalizer.normalizeText(tab.title)
    ));
    if (stillOpen) {
      return {
        success: false,
        error: `I selected the ${tab.title} tab in ${requested}, but it did not close`,
        data: { ...closed.data, verified: false }
      };
    }

    return this._browserTabCloseSuccess(requested, tab.title, [closed.data], true);
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

  async destroy() {
    const controllers = [
      this.volume,
      this.brightness,
      this.files,
      this.folders,
      this.apps,
      this.browser,
      this.media,
      this.communications,
      this.system,
      this.windows,
      this.scheduler,
      this.screenshot,
      this.forms
    ];

    for (const controller of controllers) {
      if (!controller || typeof controller.destroy !== 'function') {
        continue;
      }

      try {
        await controller.destroy();
      } catch (error) {
        this.logger.warn('Controller cleanup failed', error.message);
      }
    }

    this._actionMap = {};
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
