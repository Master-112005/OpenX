const Logger = require('../../shared/index').Logger;
const IdGenerator = require('../../shared/index').IdGenerator;
const IntentRegistry = require('../intents/index').IntentRegistry;
const InputParser = require('../parser/index');
const EntityExtractor = require('../entities/index');
const PermissionValidator = require('../../permissions/index');
const NlpProcessor = require('../nlp/index');

const CONFIDENCE_THRESHOLD = 0.5;

class ActionRouter {
  constructor(config, automationEngine) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.intentRegistry = new IntentRegistry();
    this.parser = new InputParser(config);
    this.entityExtractor = new EntityExtractor(config);
    this.permissionValidator = new PermissionValidator(config);
    this.automationEngine = automationEngine;
    this.nlp = new NlpProcessor(this.intentRegistry);
  }

  async process(inputText, source = 'chat') {
    const commandId = IdGenerator.generate();
    this.logger.info(`Processing command: ${commandId}`, { input: inputText, source });

    const parseResult = this.parser.parse(inputText);
    if (!parseResult.hasCommand) {
      return {
        commandId,
        success: false,
        error: 'No command detected',
        response: this._buildResponse('error', 'noCommand')
      };
    }

    const preparedInput = this.nlp.prepare(parseResult.commandText);
    const rawCommandText = parseResult.rawCommandText || parseResult.commandText;
    const intentResult = (
      this._resolveExplicitMediaControlIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitMediaIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitWindowIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitCommunicationIntent(rawCommandText) ||
      this._resolveExplicitOpenIntent(rawCommandText) ||
      this._resolveExplicitSearchIntent(rawCommandText) ||
      this._resolveGeneralQuestionSearchIntent(rawCommandText, preparedInput) ||
      this._matchIntent(preparedInput)
    );
    if (!intentResult || intentResult.confidence < CONFIDENCE_THRESHOLD) {
      return {
        commandId,
        success: false,
        error: 'Could not determine intent',
        response: this._buildResponse('error', 'unknownCommand', {
          input: rawCommandText,
          suggestions: this._suggestAlternatives(preparedInput)
        }),
        normalizedInput: preparedInput.correctedText || parseResult.commandText
      };
    }

    const entities = this.entityExtractor.extract(
      intentResult.intent,
      rawCommandText
    );
    const missingRequired = this._checkRequiredEntities(intentResult.intent, entities);

    if (missingRequired.length > 0) {
      return {
        commandId,
        success: false,
        error: `Missing required entities: ${missingRequired.join(', ')}`,
        response: this._buildResponse('error', 'missingEntities', {
          entities: { names: missingRequired.join(', ') },
          intent: intentResult.intent
        }),
        intent: intentResult.intent.id,
        confidence: intentResult.confidence,
        entities
      };
    }

    const permissionCheck = this.permissionValidator.validate(intentResult.intent, entities, source);

    if (!permissionCheck.allowed) {
      return {
        commandId,
        success: false,
        error: 'Permission denied',
        response: permissionCheck.response || this._buildResponse('error', 'permissionDenied'),
        intent: intentResult.intent.id,
        confidence: intentResult.confidence,
        entities,
        requiresConfirmation: permissionCheck.requiresConfirmation,
        permissionLevel: intentResult.intent.permissionLevel
      };
    }

    if (permissionCheck.requiresConfirmation) {
      return {
        commandId,
        success: true,
        requiresConfirmation: true,
        confirmationMessage: permissionCheck.confirmationMessage,
        intent: intentResult.intent.id,
        confidence: intentResult.confidence,
        entities,
        response: this._buildResponse('confirmation', 'confirmAction', {
          action: intentResult.intent.description,
          details: permissionCheck.confirmationMessage,
          intent: intentResult.intent
        })
      };
    }
    return this._execute(commandId, intentResult, entities, rawCommandText);
  }

  async confirmAndExecute(commandId, intentId, entities) {
    const intent = this.intentRegistry.get(intentId);
    if (!intent) {
      return {
        commandId,
        success: false,
        error: 'Intent not found',
        response: this._buildResponse('error', 'unknownCommand')
      };
    }

    return this._execute(commandId, { intent, confidence: 1.0 }, entities, '');
  }

  async _execute(commandId, intentResult, entities) {
    try {
      const result = await this.automationEngine.execute(intentResult.intent.action, entities);
      this.logger.info(`Execution result: ${commandId}`, { success: result.success });

      return {
        commandId,
        success: result.success,
        intent: intentResult.intent.id,
        confidence: intentResult.confidence,
        entities,
        response: result.success
          ? this._buildResponse('success', intentResult.intent.id, {
              entities,
              result,
              intent: intentResult.intent
            })
          : this._buildResponse('error', 'executionFailed', {
              error: result.error,
              intent: intentResult.intent
            }),
        data: result.data || null
      };
    } catch (err) {
      this.logger.error(`Execution error: ${commandId}`, err);
      return {
        commandId,
        success: false,
        error: err.message,
        response: this._buildResponse('error', 'executionFailed', { error: err.message })
      };
    }
  }

  _matchIntent(preparedInput) {
    const normalized = (preparedInput.intentText || preparedInput.correctedText || '').trim();
    if (!normalized) return null;

    const exactMatches = this.intentRegistry.getPatterns();
    let bestExactMatch = null;
    let bestPatternLength = -1;

    for (const [pattern, intentIds] of exactMatches.entries()) {
      if (normalized === pattern || normalized.startsWith(`${pattern} `)) {
        if (pattern.length > bestPatternLength) {
          const intent = this.intentRegistry.get(intentIds[0]);
          if (intent) {
            bestExactMatch = { intent, confidence: 1.0 };
            bestPatternLength = pattern.length;
          }
        }
      }
    }

    if (bestExactMatch) {
      return bestExactMatch;
    }

    const rankedMatches = [];
    for (const intent of this.intentRegistry.getAll()) {
      for (const pattern of intent.patterns) {
        rankedMatches.push({
          intent,
          pattern,
          confidence: this.nlp.scorePattern(preparedInput, pattern)
        });
      }
    }

    rankedMatches.sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return right.pattern.length - left.pattern.length;
    });

    const bestMatch = rankedMatches[0] || null;
    if (!bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLD) {
      return null;
    }

    return {
      intent: bestMatch.intent,
      confidence: bestMatch.confidence
    };
  }

  /**
   * Detect playback control intents (next, previous, pause, resume)
   * explicitly based on preprocessed and spelling-corrected text.
   * Runs first to ensure controls like "play next song" or "play nexr sony"
   * are not treated as "play <query>" search requests.
   * @param {string} rawText
   * @param {object} preparedInput
   * @returns {{ intent, confidence }|null}
   */
  _resolveExplicitMediaControlIntent(rawText, preparedInput) {
    const textToUse = (preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!textToUse) return null;

    // Check for next/skip
    if (/\b(next\s*song|next\s*track|skip\s*song|skip\s*track|play\s+next|skip)\b/i.test(textToUse)) {
      const intent = this.intentRegistry.get('media.next');
      if (intent) return { intent, confidence: 1 };
    }

    // Check for previous/back
    if (/\b(previous\s*song|previous\s*track|go\s*back|play\s+previous|prev\s+song|previous)\b/i.test(textToUse)) {
      const intent = this.intentRegistry.get('media.previous');
      if (intent) return { intent, confidence: 1 };
    }

    // Check for pause
    if (/\b(pause|pause\s*music|pause\s*song|pause\s*playback)\b/i.test(textToUse)) {
      const intent = this.intentRegistry.get('media.pause');
      if (intent) return { intent, confidence: 1 };
    }

    // Check for resume
    if (/\b(resume|resume\s*music|resume\s*song|resume\s*playback|play\s+again|continue|unpause|carry\s+on)\b/i.test(textToUse)) {
      const intent = this.intentRegistry.get('media.resume');
      if (intent) return { intent, confidence: 1 };
    }

    return null;
  }

  /**
   * Detect "play / stream / listen to" requests and route them to media.play.
   * This resolver runs first in the pipeline so that "play X on YouTube"
   * is never misidentified as browser.open or app.open.
   * @param {string} rawText
   * @returns {{ intent, confidence }|null}
   */
  _resolveExplicitMediaIntent(rawText, preparedInput) {
    const input = String(rawText || '').trim();
    if (!input) return null;

    const correctedText = String(preparedInput?.correctedText || input).trim().toLowerCase();
    const isMediaRequest =
      /^(?:play|stream|listen\s+to|watch|queue)\b/i.test(correctedText) ||
      /\b(?:play|stream|listen|watch|queue)\b/i.test(correctedText);
    if (!isMediaRequest) return null;

    const mediaIntent = this.intentRegistry.get('media.play');
    if (!mediaIntent) return null;

    const entities = this.entityExtractor.extract(mediaIntent, input);
    if (!entities.mediaQuery) return null;

    return { intent: mediaIntent, confidence: 0.99 };
  }

  _resolveExplicitWindowIntent(rawText, preparedInput) {
    const correctedText = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!correctedText) {
      return null;
    }

    if (/\bminimize\b/.test(correctedText)) {
      const intent = this.intentRegistry.get('window.minimize');
      if (intent) {
        return { intent, confidence: 1 };
      }
    }

    if (/\b(?:maximize|fullscreen)\b/.test(correctedText)) {
      const intent = this.intentRegistry.get('window.maximize');
      if (intent) {
        return { intent, confidence: 1 };
      }
    }

    return null;
  }

  _resolveExplicitOpenIntent(rawText) {
    const input = String(rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const isOpenRequest = /^(open|launch|start|run|show|navigate to|go to)\b/i.test(lower);
    if (!isOpenRequest) {
      return null;
    }

    const browserIntent = this.intentRegistry.get('browser.open');
    if (browserIntent && this._looksLikeUrlRequest(input)) {
      return { intent: browserIntent, confidence: 1 };
    }

    const fileIntent = this.intentRegistry.get('file.open');
    if (fileIntent) {
      const fileEntities = this.entityExtractor.extract(fileIntent, input);
      if (fileEntities.filename) {
        return { intent: fileIntent, confidence: 1 };
      }
    }

    const folderIntent = this.intentRegistry.get('folder.open');
    if (folderIntent && this._looksLikeFolderOpenRequest(input)) {
      const folderEntities = this.entityExtractor.extract(folderIntent, input);
      if (folderEntities.folderName) {
        return { intent: folderIntent, confidence: 0.98 };
      }
    }

    return null;
  }

  _resolveExplicitCommunicationIntent(rawText) {
    const input = String(rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const messageIntent = this.intentRegistry.get('message.send');
    if (messageIntent && /^(?:say|send|message|text|ask|tell|msg|massage)\b/i.test(lower)) {
      const entities = this.entityExtractor.extract(messageIntent, input);
      if (entities.contactName && entities.messageText) {
        return { intent: messageIntent, confidence: 1 };
      }
    }

    const callIntent = this.intentRegistry.get('call.start');
    if (callIntent && /^(?:call|dial|phone|ring)\b/i.test(lower)) {
      const entities = this.entityExtractor.extract(callIntent, input);
      if (entities.contactName) {
        return { intent: callIntent, confidence: 1 };
      }
    }

    return null;
  }

  _looksLikeUrlRequest(input) {
    const text = String(input || '').toLowerCase();
    return (
      /\b(?:website|url|browser)\b/.test(text) ||
      /(https?:\/\/|www\.)/i.test(text) ||
      /\b[a-z0-9-]+\.(?:com|org|net|io|ai|app|dev|edu|gov|co|in|me|info)(?:\/\S*)?\b/i.test(text)
    );
  }

  _looksLikeFolderOpenRequest(input) {
    const text = String(input || '').trim().toLowerCase();
    if (/\b(folder|directory)\b/.test(text)) {
      return true;
    }

    const withoutVerb = text.replace(/^(open|launch|start|run|show|navigate to|go to)\s+/i, '').trim();
    if (!withoutVerb) {
      return false;
    }

    const tokenCount = withoutVerb.split(/\s+/).filter(Boolean).length;
    return tokenCount === 1;
  }

  _resolveExplicitSearchIntent(rawText) {
    const input = String(rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const fileSearchIntent = this.intentRegistry.get('file.search');
    const browserSearchIntent = this.intentRegistry.get('browser.search');

    if (/^(search file|find file|look for file)\b/i.test(lower)) {
      return fileSearchIntent ? { intent: fileSearchIntent, confidence: 1 } : null;
    }

    if (/^(search for|search the web for|search web|google|look up|find on web)\b/i.test(lower)) {
      return browserSearchIntent ? { intent: browserSearchIntent, confidence: 1 } : null;
    }

    return null;
  }

  _resolveGeneralQuestionSearchIntent(rawText, preparedInput) {
    const input = String(rawText || '').trim().toLowerCase();
    if (!/^(what|who|when|where|why|how)\b/.test(input)) {
      return null;
    }

    const intentTokens = Array.isArray(preparedInput?.intentTokens) ? preparedInput.intentTokens : [];
    if (intentTokens.length === 0) {
      return null;
    }

    const localVocabulary = new Set(this.nlp.vocabulary || []);
    const localOverlap = intentTokens.filter(token => localVocabulary.has(token)).length;
    if (localOverlap > 0) {
      return null;
    }

    const browserSearchIntent = this.intentRegistry.get('browser.search');
    return browserSearchIntent ? { intent: browserSearchIntent, confidence: 0.92 } : null;
  }

  _suggestAlternatives(preparedInput) {
    const rankedPatterns = [];

    for (const intent of this.intentRegistry.getAll()) {
      for (const pattern of intent.patterns) {
        rankedPatterns.push({
          pattern,
          confidence: this.nlp.scorePattern(preparedInput, pattern)
        });
      }
    }

    return rankedPatterns
      .sort((left, right) => right.confidence - left.confidence)
      .filter(candidate => candidate.confidence >= 0.25)
      .slice(0, 3)
      .map(candidate => candidate.pattern);
  }

  _checkRequiredEntities(intent, entities) {
    const missing = [];
    if (!intent.entities) return missing;

    intent.entities.forEach(def => {
      if (!def.required) return;

      const value = entities[def.name];
      if (value === null || value === undefined || value === '') {
        missing.push(def.name);
      }
    });

    return missing;
  }

  _buildResponse(type, template, context) {
    const ResponseGenerator = require('../responses/index');
    const generator = new ResponseGenerator(this.config);
    return generator.generate(type, template, context);
  }
}

module.exports = ActionRouter;
