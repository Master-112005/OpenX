const Normalizer = require('../../shared/index').Normalizer;

class BrowserCommandLanguage {
  parse(rawText, correctedText = rawText) {
    const raw = String(rawText || '').trim();
    const corrected = String(correctedText || raw).trim();
    const repaired = corrected
      .replace(/\b([a-z0-9]{8,})in\s+(chrome|browser|edge|firefox)\b/gi, '$1 in $2')
      .replace(/\s+/g, ' ')
      .trim();
    const text = Normalizer.normalizeText(repaired);
    if (!text || !/\b(?:tabs?|chrome|browser|edge|firefox)\b/.test(text)) return null;

    const browserName = this._browserName(text);
    if (/^(?:how many|count|number of|tell me how many)\s+(?:open\s+)?tabs?\s+(?:are\s+)?(?:open\s+)?(?:in|on)\s+(?:the\s+)?(?:chrome|browser|edge|firefox)$/.test(text)) {
      return this._frame('list-tabs', browserName, { responseMode: 'count' }, repaired);
    }

    if (/^(?:what|which|show|list|tell me)\b.*\btabs?\b.*\b(?:chrome|browser|edge|firefox)\b/.test(text)) {
      return this._frame('list-tabs', browserName, { responseMode: 'list' }, repaired);
    }

    if (/^(?:open|create|make|launch)\s+(?:me\s+)?(?:(?:a|an)\s+)?(?:(?:another|new|fresh)\s+)*(?:one\s+more\s+)?(?:chrome\s+|browser\s+|edge\s+|firefox\s+)?tabs?(?:\s+(?:in|on)\s+(?:the\s+)?(?:chrome|browser|edge|firefox))?$/.test(text)) {
      return this._frame('new-tab', browserName, { forceNewTab: true }, repaired);
    }

    const namedTab = text.match(/^(?:open|show|focus|activate|select|switch\s+to|go\s+to)\s+(.+?)\s+tabs?(?:\s+(?:in|on)\s+(?:the\s+)?(chrome|browser|edge|firefox))?$/);
    if (namedTab?.[1]) {
      const forceNewTab = /^(?:new|another|fresh)\b/.test(namedTab[1]);
      const tabQuery = namedTab[1]
        .replace(/^(?:the|a|an|new|another|fresh)\s+/, '')
        .trim();
      if (tabQuery) {
        return this._frame('open-named-tab', namedTab[2] || browserName, {
          tabQuery,
          forceNewTab
        }, repaired);
      }
    }

    const browserTarget = text.match(/^(?:open|show|find|search(?:\s+for)?)\s+(.+?)\s+(?:in|on)\s+(?:the\s+)?(chrome|browser|edge|firefox)$/);
    if (browserTarget?.[1]) {
      const requestedTarget = browserTarget[1].trim();
      const newTab = /\s+(?:in|on)\s+(?:a\s+)?new\s+tab$/.test(requestedTarget);
      return this._frame('open-browser-target', browserTarget[2], {
        query: requestedTarget
          .replace(/\s+(?:in|on)\s+(?:a\s+)?new\s+tab$/, '')
          .trim(),
        newTab
      }, repaired);
    }

    return null;
  }

  _browserName(text) {
    return text.match(/\b(chrome|browser|edge|firefox)\b/)?.[1] || 'browser';
  }

  _frame(operation, browserName, entities, correctedText) {
    return {
      version: 'browser-language-v1',
      operation,
      browserName: browserName || 'browser',
      entities,
      correctedText,
      confidence: 1,
      validation: { status: 'passed', reason: `Parsed browser operation ${operation}` }
    };
  }
}

module.exports = BrowserCommandLanguage;
