const Logger = require('../../shared/index').Logger;
const IdGenerator = require('../../shared/index').IdGenerator;
const Normalizer = require('../../shared/index').Normalizer;
const IntentRegistry = require('../intents/index').IntentRegistry;
const InputParser = require('../parser/index');
const EntityExtractor = require('../entities/index');
const PermissionValidator = require('../../permissions/index');
const NlpProcessor = require('../nlp/index');
const { MediaUnderstandingRouter } = require('../../media-understanding/media-router');

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
    this.mediaUnderstanding = new MediaUnderstandingRouter({
      logging: config?.logging,
      contextProvider: config?.contextEngine || config?.contextProvider || null
    });
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

    const initialPreparedInput = this.nlp.prepare(parseResult.commandText);
    const useNoisyRepair = this._shouldUseNoisyRepair(initialPreparedInput, parseResult.commandText, source);
    const effectiveCommandText = useNoisyRepair
      ? String(initialPreparedInput.repairedCommandText || '').trim()
      : String(parseResult.commandText || '').trim();
    const preparedInput = effectiveCommandText === parseResult.commandText
      ? initialPreparedInput
      : this.nlp.prepare(effectiveCommandText);
    const rawCommandText = useNoisyRepair
      ? effectiveCommandText
      : (parseResult.rawCommandText || parseResult.commandText);
    const intentResult = (
      this._resolveExplicitMediaControlIntent(rawCommandText, preparedInput) ||
      this._resolveMediaUnderstandingIntent(rawCommandText, source) ||
      this._resolveExplicitMediaIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitFolderMoveIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitAppIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitWindowIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitCommunicationIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitOpenIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitAppOpenIntent(rawCommandText, preparedInput) ||
      this._resolveCalculationIntent(rawCommandText, preparedInput) ||
      this._resolveLocalInfoIntent(rawCommandText, preparedInput) ||
      this._resolveLocalFileListIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitSearchIntent(rawCommandText, preparedInput) ||
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

    const entities = intentResult.entities || this.entityExtractor.extract(
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

  _shouldUseNoisyRepair(preparedInput, rawText, source) {
    if (/^\s*(?:what|who|when|where|why|how|which)\b/i.test(String(rawText || ''))) {
      return false;
    }

    const repaired = String(preparedInput?.repairedCommandText || '').trim();
    const corrected = String(preparedInput?.correctedText || rawText || '').trim();
    if (!repaired || repaired === corrected) {
      return false;
    }

    if (/\.[A-Za-z0-9]{1,10}\b/.test(String(rawText || ''))) {
      return false;
    }

    if (Number(preparedInput?.actionTokenCount || 0) > 1) {
      return false;
    }

    return Number(preparedInput?.noiseTokenCount || 0) > 0
      || Number(preparedInput?.repairContextTokenCount || 0) > 0;
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

  _resolveMediaUnderstandingIntent(rawText, source) {
    const routed = this.mediaUnderstanding.route(rawText, { source });
    if (!routed.success) {
      return null;
    }

    const intent = this.intentRegistry.get(routed.payload.action);
    if (!intent) {
      return null;
    }

    return {
      intent,
      confidence: routed.payload.confidence,
      entities: {
        mediaQuery: routed.payload.mediaQuery,
        mediaPlatform: routed.payload.mediaPlatform,
        query: routed.payload.query,
        platform: routed.payload.platform,
        artist: routed.payload.artist,
        song: routed.payload.song,
        genre: routed.payload.genre,
        source: routed.payload.source
      }
    };
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

  _resolveExplicitFolderMoveIntent(rawText, preparedInput) {
    const correctedText = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!correctedText) {
      return null;
    }

    if (!/\bmove\s+(?:the\s+)?(?:folder|directory)\b/.test(correctedText)) {
      return null;
    }

    const intent = this.intentRegistry.get('folder.move');
    if (!intent) {
      return null;
    }

    const entities = this.entityExtractor.extract(intent, rawText);
    if (!entities.source || !entities.destination) {
      return null;
    }

    return { intent, confidence: 1 };
  }

  _resolveExplicitAppIntent(rawText, preparedInput) {
    const correctedText = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!correctedText) {
      return null;
    }

    const appIntentConfigs = [
      {
        intentId: 'app.close',
        verbs: ['close', 'quit', 'exit', 'terminate', 'stop']
      },
      {
        intentId: 'app.switch',
        verbs: ['switch', 'focus', 'goto', 'go', 'activate']
      }
    ];

    for (const config of appIntentConfigs) {
      if (!this._containsActionVerb(correctedText, config.verbs)) {
        continue;
      }

      const intent = this.intentRegistry.get(config.intentId);
      if (!intent) {
        continue;
      }

      const extractedFromRaw = this.entityExtractor.extract(intent, rawText);
      const extractedFromCorrected = this.entityExtractor.extract(intent, correctedText);
      const appName = extractedFromRaw.appName || extractedFromCorrected.appName;

      if (!appName) {
        continue;
      }

      return { intent, confidence: 0.99 };
    }

    return null;
  }

  _resolveExplicitOpenIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const isOpenRequest = /^(open|launch|start|run|show|navigate to|go to)\b/i.test(lower);
    if (!isOpenRequest) {
      return null;
    }

    const browserIntent = this.intentRegistry.get('browser.open');
    if (browserIntent && this._looksLikeUrlRequest(rawText)) {
      return { intent: browserIntent, confidence: 1 };
    }

    const fileIntent = this.intentRegistry.get('file.open');
    if (fileIntent) {
      const fileEntities = this.entityExtractor.extract(fileIntent, rawText);
      if (fileEntities.filename) {
        return { intent: fileIntent, confidence: 1 };
      }
    }

    const folderIntent = this.intentRegistry.get('folder.open');
    if (folderIntent && this._looksLikeFolderOpenRequest(rawText)) {
      const folderEntities = this.entityExtractor.extract(folderIntent, rawText);
      if (folderEntities.folderName) {
        return { intent: folderIntent, confidence: 0.98 };
      }
    }

    return null;
  }

  _resolveExplicitCommunicationIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const messageIntent = this.intentRegistry.get('message.send');
    if (messageIntent && /^(?:say|send|message|text|ask|tell|msg|massage)\b/i.test(lower)) {
      const entities = this.entityExtractor.extract(messageIntent, rawText);
      if (entities.contactName && entities.messageText) {
        return { intent: messageIntent, confidence: 1 };
      }
    }

    const callIntent = this.intentRegistry.get('call.start');
    if (callIntent && /^(?:call|dial|phone|ring)\b/i.test(lower)) {
      const entities = this.entityExtractor.extract(callIntent, rawText);
      if (entities.contactName) {
        return { intent: callIntent, confidence: 1 };
      }
    }

    return null;
  }

  _resolveExplicitAppOpenIntent(rawText, preparedInput) {
    const correctedText = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!correctedText || !this._containsActionVerb(correctedText, ['open', 'launch', 'start', 'run'])) {
      return null;
    }

    if (this._looksLikeUrlRequest(rawText)) {
      return null;
    }

    const fileIntent = this.intentRegistry.get('file.open');
    if (fileIntent) {
      const fileEntities = this.entityExtractor.extract(fileIntent, rawText);
      if (fileEntities.filename) {
        return null;
      }
    }

    const folderIntent = this.intentRegistry.get('folder.open');
    if (folderIntent && this._looksLikeFolderOpenRequest(rawText)) {
      const folderEntities = this.entityExtractor.extract(folderIntent, rawText);
      if (folderEntities.folderName) {
        return null;
      }
    }

    const intent = this.intentRegistry.get('app.open');
    if (!intent) {
      return null;
    }

    const extractedFromRaw = this.entityExtractor.extract(intent, rawText);
    const extractedFromCorrected = this.entityExtractor.extract(intent, correctedText);
    const appName = extractedFromRaw.appName || extractedFromCorrected.appName;

    if (!appName) {
      return null;
    }

    return { intent, confidence: 0.99 };
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

  _resolveExplicitSearchIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const fileSearchIntent = this.intentRegistry.get('file.search');
    const browserSearchIntent = this.intentRegistry.get('browser.search');

    if (/^(search file|find file|look for file)\b/i.test(lower)) {
      return fileSearchIntent ? { intent: fileSearchIntent, confidence: 1 } : null;
    }

    if (/^(search for|search the web for|search web|google|look up|find on web)\b/i.test(lower)) {
      return browserSearchIntent
        ? { intent: browserSearchIntent, confidence: 1, entities: this._buildSearchEntities(rawText, preparedInput) }
        : null;
    }

    return null;
  }

  _resolveLocalInfoIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const systemTimeIntent = this.intentRegistry.get('system.time');
    const systemDateIntent = this.intentRegistry.get('system.date');

    if (/\b(?:time)\b/.test(input) && /^(?:what|when|tell|current|time)\b/.test(input)) {
      return systemTimeIntent ? { intent: systemTimeIntent, confidence: 1, entities: {} } : null;
    }

    if (/\b(?:date|day|today)\b/.test(input) && /^(?:what|which|tell|current|date|day)\b/.test(input)) {
      return systemDateIntent ? { intent: systemDateIntent, confidence: 1, entities: {} } : null;
    }

    return null;
  }

  _resolveCalculationIntent(rawText, preparedInput) {
    const input = String(rawText || preparedInput?.correctedText || '').trim();
    if (!input) {
      return null;
    }

    const expression = this._extractCalculationExpression(input) ||
      this._extractCalculationExpression(preparedInput?.correctedText);
    if (!expression) {
      return null;
    }

    const calculateIntent = this.intentRegistry.get('system.calculate');
    return calculateIntent
      ? { intent: calculateIntent, confidence: 1, entities: { expression } }
      : null;
  }

  _extractCalculationExpression(input) {
    const text = String(input || '')
      .trim()
      .toLowerCase()
      .replace(/\behat\b/g, 'what')
      .replace(/\bteh\b/g, 'the');
    if (!text) {
      return null;
    }

    const withoutLead = text
      .replace(/^(?:what\s+is|what's|calculate|solve|answer|find|tell\s+me)\s+/i, '')
      .replace(/^(?:the\s+)?(?:value|answer|result)\s+of\s+/i, '')
      .trim();

    const candidate = withoutLead || text;
    if (this._looksLikeCalculationExpression(candidate)) {
      return candidate;
    }

    const symbolSegments = candidate.match(/[-+*/%^().,\d\s]+/g) || [];
    const bestSegment = symbolSegments
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0)
      .sort((left, right) => right.length - left.length)
      .find(segment => this._looksLikeCalculationExpression(segment));

    return bestSegment || null;
  }

  _looksLikeCalculationExpression(candidate) {
    const text = String(candidate || '').trim();
    if (!text || !/\d/.test(text)) {
      return false;
    }

    const operatorWords = [
      'plus',
      'add',
      'minus',
      'subtract',
      'times',
      'multiply',
      'multiplied',
      'divide',
      'divided',
      'over',
      'power',
      'squared',
      'cubed',
      'root',
      'percent'
    ];
    const hasOperator = /[+\-*/%^]/.test(text) ||
      new RegExp(`\\b(?:${operatorWords.join('|')})\\b`, 'i').test(text);
    if (!hasOperator) {
      return false;
    }

    const allowedWords = [
      ...operatorWords,
      'by',
      'of',
      'to',
      'the',
      'square',
      'sqrt',
      'absolute',
      'abs'
    ];
    const wordMatches = text.match(/[a-z]+/gi) || [];
    return wordMatches.every(word => allowedWords.includes(word.toLowerCase())) &&
      /^[\d\s+\-*/%^().,%a-z]+$/i.test(text);
  }

  _resolveLocalFileListIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!/\b(?:file|files|folder|folders|items|contents)\b/.test(input)) {
      return null;
    }

    const listRequest = /^(?:what|which|show|list|tell)\b/.test(input) &&
      /\b(?:are|is|in|on|inside|under|from|files|folders|items|contents)\b/.test(input);
    if (!listRequest) {
      return null;
    }

    const localLocation = this._extractLocalListLocation(input);
    if (!localLocation) {
      return null;
    }

    const fileListIntent = this.intentRegistry.get('file.list');
    return fileListIntent
      ? { intent: fileListIntent, confidence: 1, entities: { path: localLocation } }
      : null;
  }

  _extractLocalListLocation(input) {
    const locations = ['desktop', 'downloads', 'documents', 'pictures', 'music', 'videos', 'home'];
    for (const location of locations) {
      if (new RegExp(`\\b${location}\\b`, 'i').test(input)) {
        return location;
      }
    }

    return null;
  }

  _resolveGeneralQuestionSearchIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!/^(what|who|when|where|why|how)\b/.test(input)) {
      return null;
    }

    const intentTokens = Array.isArray(preparedInput?.intentTokens) ? preparedInput.intentTokens : [];
    if (intentTokens.length === 0) {
      return null;
    }

    const browserSearchIntent = this.intentRegistry.get('browser.search');
    return browserSearchIntent
      ? { intent: browserSearchIntent, confidence: 0.92, entities: this._buildSearchEntities(rawText, preparedInput) }
      : null;
  }

  _buildSearchEntities(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim();
    const raw = String(rawText || corrected || '').trim();
    const isQuestion = /^(?:what|who|when|where|why|how)\b/i.test(corrected || raw);
    let query = isQuestion
      ? (raw || corrected)
      : (this.entityExtractor._extractQuery(corrected.toLowerCase(), raw) || raw || corrected);
    const openInBrowser = /\b(?:open|show|search|look\s+up|google).*\b(?:in|on)\s+(?:chrome|browser)\b/i.test(raw)
      || /\b(?:open|show)\s+(?:it|results?)\s+(?:in|on)\s+(?:chrome|browser)\b/i.test(raw);

    query = String(query || '').replace(/\s+(?:in|on)\s+(?:chrome|browser)\s*$/i, '').trim();

    return {
      query,
      openInBrowser
    };
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

  _containsActionVerb(text, verbs) {
    const normalizedText = String(text || '').trim().toLowerCase();
    if (!normalizedText) {
      return false;
    }

    const tokens = normalizedText.split(/\s+/).filter(Boolean);
    const candidates = new Set();
    const firstToken = tokens[0] || '';

    tokens.forEach((token, index) => {
      candidates.add(token);
      if (index < tokens.length - 1) {
        candidates.add(`${token} ${tokens[index + 1]}`);
      }
    });

    return Array.from(candidates).some(candidate => {
      if (verbs.includes(candidate)) {
        return true;
      }

      return false;
    }) || Boolean(Normalizer.findClosestOption(firstToken, verbs, {
      minSimilarity: 0.58,
      maxDistance: firstToken.length >= 5 ? 2 : 1
    }));
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
