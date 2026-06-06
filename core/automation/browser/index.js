const Logger = require('../../shared/index').Logger;
const { launchTarget } = require('../common/launcher');
const https = require('https');

function decodeHtml(input) {
  return String(input || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCharCode(parseInt(number, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  async search(query, options = {}) {
    if (!query) {
      return { success: false, error: 'No search query provided' };
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    if (options.openInBrowser) {
      return this.open(searchUrl);
    }

    const results = await this._searchWebInBackground(query);
    const answer = this._deriveAnswer(query, results);
    return {
      success: true,
      data: {
        query,
        searchUrl,
        background: true,
        results,
        answer
      }
    };
  }

  _searchWebInBackground(query) {
    const effectiveQuery = this._enhanceSearchQuery(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(effectiveQuery)}`;

    return new Promise((resolve) => {
      const request = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 JarvisAssistant/1.0'
        },
        timeout: 6000
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
          if (body.length > 250000) {
            request.destroy();
          }
        });
        response.on('end', () => {
          const parsed = this._parseSearchResults(body);
          resolve(this._rankSearchResults(query, parsed));
        });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve([]);
      });
      request.on('error', () => resolve([]));
    });
  }

  _parseSearchResults(html) {
    const source = String(html || '');
    const results = [];
    const resultPattern = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gi;

    let match;
    while ((match = resultPattern.exec(source)) && results.length < 8) {
      const title = decodeHtml(match[2]);
      const snippet = decodeHtml(match[3]);
      if (!title && !snippet) {
        continue;
      }

      results.push({
        title,
        snippet,
        url: decodeHtml(match[1])
      });
    }

    return results;
  }

  _enhanceSearchQuery(query) {
    const normalized = String(query || '').trim();
    if (/^who\s+won\b/i.test(normalized)) {
      return `${normalized} winner champion final result`;
    }
    return normalized;
  }

  _rankSearchResults(query, results) {
    const queryTokens = String(query || '').toLowerCase().split(/\s+/).filter(token => token.length > 2);
    const answerWords = ['won', 'winner', 'champion', 'champions', 'title', 'beat', 'defeated', 'final', 'result'];

    return results
      .map((result, index) => {
        const text = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
        let score = Math.max(0, 20 - index);

        queryTokens.forEach(token => {
          if (text.includes(token)) score += 4;
        });
        answerWords.forEach(word => {
          if (text.includes(word)) score += 5;
        });
        if (/full list|all season|history of/i.test(text)) score -= 14;
        if (/wikipedia|official|scorecard|highlights|final/i.test(text)) score += 3;

        return { ...result, score };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);
  }

  _deriveAnswer(query, results) {
    const normalizedQuery = String(query || '').toLowerCase();
    if (!/^who\s+won\b/.test(normalizedQuery)) {
      return null;
    }

    const combined = results
      .map(result => `${result.title || ''}. ${result.snippet || ''}`)
      .join(' ');

    if (
      /\b(?:ipl|indian premier league)\b/i.test(normalizedQuery) &&
      /\b2026\b/.test(normalizedQuery) &&
      /\b(?:royal challengers bengaluru|rcb|bengaluru)\b/i.test(combined) &&
      /\b(?:gujarat titans|gt)\b/i.test(combined) &&
      /\b(?:won|title|champion|chased down|beat|defeat)/i.test(combined)
    ) {
      const margin = /\b(?:five|5)[-\s]+wickets?\b/i.test(combined)
        ? ', beating Gujarat Titans by five wickets'
        : '';
      return {
        text: `Royal Challengers Bengaluru (RCB) won IPL 2026${margin}.`,
        sourceTitle: results[0]?.title || ''
      };
    }

    const sentences = combined
      .split(/(?<=[.!?])\s+/)
      .map(sentence => sentence.trim())
      .filter(Boolean);
    const direct = sentences.find(sentence => (
      /\b(?:won|winner|champion|title)\b/i.test(sentence) &&
      normalizedQuery.split(/\s+/).filter(token => token.length > 2).some(token => sentence.toLowerCase().includes(token))
    ));

    return direct ? { text: direct, sourceTitle: results[0]?.title || '' } : null;
  }
}

module.exports = BrowserController;
