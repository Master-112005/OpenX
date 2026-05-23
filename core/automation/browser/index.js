const Logger = require('../../shared/index').Logger;
const { launchTarget } = require('../common/launcher');

class BrowserController {
  constructor(config) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.defaultBrowser = this._detectBrowser();
  }

  _detectBrowser() {
    const browsers = [
      { path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', name: 'chrome' },
      { path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', name: 'msedge' },
      { path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', name: 'firefox' }
    ];

    for (const browser of browsers) {
      try {
        if (require('fs').existsSync(browser.path)) return browser;
      } catch (e) {
        continue;
      }
    }

    return { path: null, name: 'msedge' };
  }

  open(url) {
    if (!url) {
      return { success: false, error: 'No URL provided' };
    }

    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    try {
      if (this.defaultBrowser.path) {
        launchTarget(this.defaultBrowser.path, [formattedUrl]);
      } else {
        launchTarget(formattedUrl);
      }
      return { success: true, data: { url: formattedUrl } };
    } catch (err) {
      return { success: false, error: `Failed to open: ${formattedUrl}` };
    }
  }

  search(query) {
    if (!query) {
      return { success: false, error: 'No search query provided' };
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return this.open(searchUrl);
  }
}

module.exports = BrowserController;
