const Normalizer = require('../../shared/index').Normalizer;

const ACTIONS = new Map([
  ['open', 'open'],
  ['launch', 'open'],
  ['start', 'open'],
  ['run', 'open'],
  ['show', 'open'],
  ['close', 'close'],
  ['quit', 'close'],
  ['exit', 'close'],
  ['terminate', 'close'],
  ['stop', 'close'],
  ['switch', 'focus'],
  ['focus', 'focus'],
  ['activate', 'focus']
]);

const NEW_WINDOW_PATTERN = /\b(?:new|another|additional|separate|fresh)\b|\bone\s+more\b|\bnew\s+(?:window|instance)\b/i;
const LEAD_IN_PATTERN = /^(?:(?:please|kindly)\s+|(?:can|could|would|will)\s+you\s+|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+)+/i;

class AppCommandLanguage {
  parse(rawText, correctedText = rawText) {
    const raw = String(rawText || '').trim();
    const corrected = String(correctedText || raw).trim();
    const source = corrected.replace(LEAD_IN_PATTERN, '').trim();
    const appTab = source.match(/^(?:open|create|make|show)\s+(?:(?:a|an)\s+)?(?:(?:another|new|fresh)\s+)*(?:one\s+more\s+)?tab\s+(?:in|on)\s+(?:the\s+)?(.+)$/i);
    if (appTab?.[1] && !/^(?:chrome|browser|edge|firefox)$/i.test(appTab[1].trim())) {
      const targetText = appTab[1]
        .replace(/\s+(?:app|application|program)$/i, '')
        .trim();
      return {
        version: 'app-language-v1',
        rawText: raw,
        correctedText: corrected,
        action: 'new-tab',
        actionToken: 'open',
        targetText,
        forceNewWindow: false,
        requestedOperation: 'open-new-tab',
        confidence: targetText ? 1 : 0,
        tokenRoles: Normalizer.tokenize(source).map(token => ({
          token,
          role: /^(?:open|create|make|show)$/.test(token)
            ? 'action'
            : (/^(?:new|another|fresh|tab)$/.test(token) ? 'modifier' : 'target')
        })),
        validation: targetText
          ? { status: 'passed', reason: `Parsed new tab target "${targetText}"` }
          : { status: 'incomplete', reason: 'No application target was provided' }
      };
    }
    const tokens = Normalizer.tokenize(source);
    if (tokens.length === 0) return null;

    let actionIndex = tokens.findIndex(token => ACTIONS.has(token));
    let actionToken = actionIndex >= 0 ? tokens[actionIndex] : null;
    let action = actionToken ? ACTIONS.get(actionToken) : null;
    if (!action) return null;

    const forceNewWindow = action === 'open' && (
      NEW_WINDOW_PATTERN.test(raw) || NEW_WINDOW_PATTERN.test(corrected)
    );
    const targetText = this._extractTarget(source, actionIndex);
    const validation = this._validate(action, targetText, source);

    return {
      version: 'app-language-v1',
      rawText: raw,
      correctedText: corrected,
      action,
      actionToken,
      targetText,
      forceNewWindow,
      requestedOperation: action === 'open'
        ? (forceNewWindow ? 'open-new-window' : 'open-or-focus')
        : action,
      confidence: validation.status === 'passed' ? (actionIndex >= 0 ? 1 : 0.86) : 0,
      tokenRoles: tokens.map((token, index) => ({
        token,
        role: index === actionIndex
          ? 'action'
          : (NEW_WINDOW_PATTERN.test(token) ? 'modifier' : 'target')
      })),
      validation
    };
  }

  _extractTarget(source, actionIndex) {
    const tokens = Normalizer.tokenize(source);
    const targetTokens = actionIndex >= 0 ? tokens.slice(actionIndex + 1) : tokens;
    return targetTokens
      .join(' ')
      .replace(/^(?:up\s+|me\s+)+/i, '')
      .replace(/\b(?:in|as)\s+(?:a\s+)?(?:new|another|separate)\s+(?:window|instance)\b/gi, ' ')
      .replace(/\bone\s+more\b/gi, ' ')
      .replace(/\b(?:new|another|additional|separate|fresh)\b/gi, ' ')
      .replace(/^(?:a|an|the|my)\s+/i, '')
      .replace(/\s+(?:app|application|program|window|instance)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _validate(action, targetText, source) {
    if (!targetText) {
      return { status: 'incomplete', reason: 'No application target was provided' };
    }
    if (/\b(?:tabs?|website|site|url|files?|folders?|directories?)\b/i.test(source) || /\.[a-z0-9]{1,10}\b/i.test(source)) {
      return { status: 'rejected', reason: 'The target belongs to another command domain' };
    }
    return {
      status: 'passed',
      reason: `Parsed app ${action} target "${targetText}"`
    };
  }
}

module.exports = AppCommandLanguage;
