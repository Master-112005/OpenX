const Logger = require('../../shared/index').Logger;
const IdGenerator = require('../../shared/index').IdGenerator;
const Normalizer = require('../../shared/index').Normalizer;
const IntentRegistry = require('../intents/index').IntentRegistry;
const InputParser = require('../parser/index');
const EntityExtractor = require('../entities/index');
const PermissionValidator = require('../../permissions/index');
const NlpProcessor = require('../nlp/index');
const { normalizeWebTarget } = require('../nlp/web-targets');
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
    this.learningStore = config?.learningStore || null;
    this.mediaUnderstanding = new MediaUnderstandingRouter({
      logging: config?.logging,
      contextProvider: config?.contextEngine || config?.contextProvider || null
    });
  }

  async process(inputText, source = 'chat', options = {}) {
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
    const useNoisyRepair = this._shouldUseNoisyRepair(
      initialPreparedInput,
      parseResult.rawCommandText || parseResult.commandText,
      source
    );
    const effectiveCommandText = useNoisyRepair
      ? String(initialPreparedInput.repairedCommandText || '').trim()
      : String(parseResult.commandText || '').trim();
    const preparedInput = effectiveCommandText === parseResult.commandText
      ? initialPreparedInput
      : this.nlp.prepare(effectiveCommandText);
    const rawCommandText = useNoisyRepair
      ? effectiveCommandText
      : (parseResult.rawCommandText || parseResult.commandText);

    if (options.allowMulti !== false) {
      const multiPlan = this._buildMultiCommandPlan(rawCommandText, source);
      if (multiPlan) {
        return this._executeMultiCommand(commandId, multiPlan, source);
      }
    }

    const intentResult = this._resolveIntent(rawCommandText, preparedInput, source);
    if (!intentResult || intentResult.confidence < CONFIDENCE_THRESHOLD) {
      return {
        commandId,
        success: false,
        error: 'Could not determine intent',
        response: this._buildResponse('error', 'unknownCommand', {
          input: rawCommandText,
          suggestions: this._suggestAlternatives(preparedInput)
        }),
        normalizedInput: preparedInput.correctedText || parseResult.commandText,
        languageUnderstanding: this._buildLanguageUnderstanding(preparedInput, intentResult, [], 'failed')
      };
    }

    return this._completeIntent(commandId, intentResult, rawCommandText, source, preparedInput);
  }

  _resolveIntent(rawCommandText, preparedInput, source) {
    if (this._isIncompleteCommand(rawCommandText, preparedInput)) {
      return null;
    }

    return (
      this._resolveExplicitReminderIntent(rawCommandText, preparedInput) ||
      this._resolveSystemSettingsIntent(rawCommandText, preparedInput) ||
      this._resolveSystemInsightIntent(rawCommandText, preparedInput) ||
      this._resolveWorkspaceSetupIntent(rawCommandText, preparedInput) ||
      this._resolveScreenshotIntent(rawCommandText, preparedInput) ||
      this._resolveSmartFileIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitFileIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitFolderMoveIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitMediaControlIntent(rawCommandText, preparedInput) ||
      this._resolveMediaUnderstandingIntent(rawCommandText, source) ||
      this._resolveExplicitMediaIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitModeIntent(rawCommandText, preparedInput) ||
      this._resolveBrowserTabIntent(rawCommandText, preparedInput) ||
      this._resolveLocalInfoIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitAppIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitWindowIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitCommunicationIntent(rawCommandText, preparedInput) ||
      this._resolveBrowserFollowupIntent(rawCommandText, preparedInput) ||
      this._resolveSiteSearchIntent(rawCommandText, preparedInput) ||
      this._resolvePersonalPhotoIntent(rawCommandText, preparedInput) ||
      this._resolveKnownWebOpenIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitOpenIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitAppOpenIntent(rawCommandText, preparedInput) ||
      this._resolveCalculationIntent(rawCommandText, preparedInput) ||
      this._resolveLocalFileListIntent(rawCommandText, preparedInput) ||
      this._resolveAssistantConversationIntent(rawCommandText, preparedInput) ||
      this._resolveLocalFileSearchIntent(rawCommandText, preparedInput) ||
      this._resolveExplicitSearchIntent(rawCommandText, preparedInput) ||
      this._resolveBareKnowledgeSearchIntent(rawCommandText, preparedInput) ||
      this._resolveGeneralQuestionSearchIntent(rawCommandText, preparedInput) ||
      this._matchIntent(preparedInput)
    );
  }

  _isIncompleteCommand(rawCommandText, preparedInput = {}) {
    const raw = String(rawCommandText || '').trim();
    const corrected = String(preparedInput?.correctedText || raw).trim().toLowerCase();
    if (!corrected) {
      return true;
    }

    if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+your\s+name|whats\s+your\s+name)\b/i.test(corrected)) {
      return false;
    }

    const standaloneCommands = new Set([
      'cancel',
      'continue',
      'help',
      'mute',
      'next',
      'pause',
      'previous',
      'resume',
      'skip',
      'stop',
      'unmute',
      'volume down',
      'volume up'
    ]);
    if (standaloneCommands.has(corrected)) {
      return false;
    }

    const tokens = Array.isArray(preparedInput?.tokens) && preparedInput.tokens.length
      ? preparedInput.tokens
      : Normalizer.tokenize(corrected);
    if (!tokens.length) {
      return true;
    }

    const actionAliases = new Set([
      'attach',
      'call',
      'close',
      'copy',
      'create',
      'delete',
      'draft',
      'extract',
      'find',
      'google',
      'launch',
      'look',
      'message',
      'minimize',
      'move',
      'open',
      'read',
      'remind',
      'rename',
      'run',
      'search',
      'send',
      'set',
      'share',
      'show',
      'start',
      'switch',
      'turn'
    ]);
    const actionIndex = tokens.findIndex(token => actionAliases.has(token));
    if (actionIndex < 0) {
      return false;
    }

    const ignorableTargetTokens = new Set([
      'a',
      'an',
      'any',
      'for',
      'from',
      'it',
      'me',
      'my',
      'now',
      'of',
      'on',
      'one',
      'please',
      'some',
      'that',
      'the',
      'them',
      'there',
      'this',
      'to',
      'up',
      'with',
      'you',
      'your'
    ]);
    const targetTokens = tokens
      .slice(actionIndex + 1)
      .filter(token => !ignorableTargetTokens.has(token));

    if (targetTokens.length > 0) {
      return false;
    }

    const action = tokens[actionIndex];
    if (action === 'remind' && /^remind\s+me\b/i.test(corrected)) {
      return true;
    }

    return [
      'attach',
      'call',
      'close',
      'copy',
      'create',
      'delete',
      'draft',
      'extract',
      'find',
      'google',
      'launch',
      'look',
      'message',
      'minimize',
      'move',
      'open',
      'read',
      'rename',
      'run',
      'search',
      'send',
      'set',
      'share',
      'show',
      'start',
      'switch',
      'turn'
    ].includes(action);
  }

  async _completeIntent(commandId, intentResult, rawCommandText, source, preparedInput = null) {
    let entities = intentResult.entities || this.entityExtractor.extract(
      intentResult.intent,
      rawCommandText
    );
    if (this.learningStore?.adaptEntities) {
      entities = this.learningStore.adaptEntities(intentResult.intent.id, entities, {
        rawCommandText,
        source
      });
    }
    const missingRequired = this._checkRequiredEntities(intentResult.intent, entities);
    const languageUnderstanding = this._buildLanguageUnderstanding(
      preparedInput || this.nlp.prepare(rawCommandText),
      intentResult,
      missingRequired,
      missingRequired.length > 0 ? 'incomplete' : 'passed'
    );

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
        entities,
        languageUnderstanding
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
        permissionLevel: intentResult.intent.permissionLevel,
        languageUnderstanding
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
        }),
        languageUnderstanding
      };
    }
    return this._execute(commandId, intentResult, entities, rawCommandText, source, languageUnderstanding);
  }

  _buildMultiCommandPlan(rawText, source) {
    const text = String(rawText || '').trim();
    if (!text || !/\b(?:and|then|after that|afterwards)\b|[;]/i.test(text)) {
      return null;
    }

    if (this._looksLikeSingleMediaPlatformRequest(text)) {
      return null;
    }

    const preparedWholeText = this.nlp.prepare(text);
    const wholeLocalInfo = this._resolveLocalInfoIntent(text, preparedWholeText);
    if (wholeLocalInfo?.intent?.id === 'system.processes' && wholeLocalInfo.entities?.queryApp) {
      return null;
    }

    let clauses = text
      .split(/\s*(?:;|\b(?:and then|then|after that|afterwards|and)\b)\s*/i)
      .map(part => part.trim())
      .filter(Boolean)
      .slice(0, 6);

    if (clauses.length > 0 && this._isPoliteLeadInClause(clauses[0])) {
      clauses = clauses.slice(1);
    }

    if (clauses.length < 2) {
      return null;
    }

    clauses = this._normalizeMultiClauses(clauses);

    const actionableClauses = clauses.filter(clause => this._clauseLooksActionable(clause, source));
    if (actionableClauses.length < 2) {
      return null;
    }

    return clauses;
  }

  _looksLikeSingleMediaPlatformRequest(text) {
    const source = String(text || '').trim().toLowerCase();
    return /^(?:open|launch|start)\s+(?:youtube|spotify|apple\s+music|amazon\s+music|soundcloud)\s+and\s+(?:play|stream|listen|watch)\b/.test(source);
  }

  _normalizeMultiClauses(clauses) {
    const verbsThatCanCarry = new Set([
      'open',
      'launch',
      'start',
      'run',
      'close',
      'quit',
      'exit',
      'terminate',
      'minimize',
      'maximize',
      'switch',
      'focus'
    ]);
    let carriedVerb = null;

    return clauses.map(clause => {
      const prepared = this.nlp.prepare(clause);
      const corrected = String(prepared.correctedText || clause || '').trim();
      const normalized = corrected.toLowerCase();
      const verbMatch = normalized.match(/^(open|launch|start|run|close|quit|exit|terminate|minimize|maximize|switch|focus|pause|resume|unpause|stop|set)\b/);
      const standaloneQuestionMatch = normalized.match(/^ask\s+(.+)$/);
      if (standaloneQuestionMatch?.[1] && /^(?:what|who|when|where|why|how|which)\b/i.test(standaloneQuestionMatch[1].trim())) {
        carriedVerb = null;
        return `search for ${standaloneQuestionMatch[1].trim()}`;
      }

      if (/^(?:ask|tell|message|text|search|google|look\s+up|find|what|who|when|where|why|how|which|remind|set|turn)\b/.test(normalized)) {
        carriedVerb = null;
        return corrected;
      }

      if (verbMatch) {
        if (verbsThatCanCarry.has(verbMatch[1])) {
          carriedVerb = verbMatch[1];
        }
        return corrected;
      }

      if (carriedVerb && /^[a-z0-9][a-z0-9\s.-]*$/i.test(corrected)) {
        return `${carriedVerb} ${corrected}`;
      }

      return corrected;
    });
  }

  _extractModeCommandsFromData(data) {
    if (!data || !Array.isArray(data.commands)) {
      return [];
    }

    return data.commands
      .map(command => String(command || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  _clauseLooksActionable(clause, source) {
    if (this._isPoliteLeadInClause(clause)) {
      return false;
    }

    const prepared = this.nlp.prepare(clause);
    const intentResult = this._resolveIntent(clause, prepared, source);
    return Boolean(intentResult && intentResult.confidence >= CONFIDENCE_THRESHOLD);
  }

  _isPoliteLeadInClause(clause) {
    return /^(?:go\s+ahead|please|kindly|ok|okay|sure|can\s+you|could\s+you|would\s+you)$/i.test(String(clause || '').trim());
  }

  async _executeMultiCommand(commandId, clauses, source) {
    const steps = [];

    for (const clause of clauses) {
      const result = await this.process(clause, source, { allowMulti: false });
      steps.push({
        input: clause,
        success: result.success,
        intent: result.intent,
        entities: result.entities,
        response: result.response,
        error: result.error || null
      });

      if (result.requiresConfirmation || !result.success) {
        return {
          commandId,
          success: false,
          intent: 'multi.command',
          confidence: 1,
          entities: { commands: clauses },
          steps,
          response: result.requiresConfirmation
            ? result.response
            : this._buildMultiCommandResponse(steps),
          requiresConfirmation: result.requiresConfirmation,
          confirmationMessage: result.confirmationMessage,
          permissionLevel: result.permissionLevel
        };
      }
    }

    return {
      commandId,
      success: true,
      intent: 'multi.command',
      confidence: 1,
      entities: { commands: clauses },
      steps,
      response: this._buildMultiCommandResponse(steps)
    };
  }

  _buildMultiCommandResponse(steps) {
    const completed = steps.filter(step => step.success).length;
    const failed = steps.find(step => !step.success);
    if (failed) {
      return `${completed} command${completed === 1 ? '' : 's'} completed. ${failed.response || failed.error || 'One command failed.'}`;
    }

    return `Completed ${completed} command${completed === 1 ? '' : 's'}.`;
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

    return this._execute(commandId, { intent, confidence: 1.0 }, entities, '', 'confirmation');
  }

  async _execute(commandId, intentResult, entities, rawCommandText = '', source = 'chat', languageUnderstanding = null) {
    try {
      const result = await this.automationEngine.execute(intentResult.intent.action, entities);
      this.logger.info(`Execution result: ${commandId}`, { success: result.success });

      const modeCommandSteps = [];
      if (result.success && intentResult.intent.id === 'mode.start') {
        const modeCommands = this._extractModeCommandsFromData(result.data);
        for (const command of modeCommands) {
          const stepResult = await this.process(command, source, { allowMulti: true });
          modeCommandSteps.push({
            input: command,
            success: stepResult.success,
            intent: stepResult.intent,
            entities: stepResult.entities,
            steps: stepResult.steps || null,
            response: stepResult.response,
            error: stepResult.error || null
          });
        }
      }

      const responseData = modeCommandSteps.length > 0
        ? { ...(result.data || {}), commandSteps: modeCommandSteps }
        : result.data;
      const responseResult = { ...result, data: responseData };

      return {
        commandId,
        success: result.success && modeCommandSteps.every(step => step.success),
        needsClarification: Boolean(result.needsClarification),
        intent: intentResult.intent.id,
        confidence: intentResult.confidence,
        entities,
        response: result.needsClarification
          ? (result.error || 'Please clarify which target to use.')
          : result.success
          ? this._buildResponse('success', intentResult.intent.id, {
              entities,
              result: responseResult,
              intent: intentResult.intent,
              input: rawCommandText,
              source
            })
          : this._buildResponse('error', 'executionFailed', {
              error: result.error,
              intent: intentResult.intent
        }),
        error: result.error || null,
        languageUnderstanding,
        validation: result.validation || result.data?.validation || null,
        verification: result.verification || result.data?.verification || null,
        data: responseData || result.data || null
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

  _buildLanguageUnderstanding(preparedInput, intentResult, missingRequired = [], status = 'passed') {
    const intent = intentResult?.intent || null;
    const missing = Array.isArray(missingRequired) ? missingRequired : [];
    return {
      status,
      normalizedText: preparedInput?.normalizedText || '',
      correctedText: preparedInput?.correctedText || '',
      intentText: preparedInput?.intentText || '',
      queryType: preparedInput?.query?.type || 'unknown',
      actionVerb: preparedInput?.query?.actionVerb || null,
      intent: intent?.id || null,
      action: intent?.action || null,
      confidence: Number(intentResult?.confidence || 0),
      missingEntities: missing,
      validation: {
        status: missing.length > 0 ? 'failed' : 'passed',
        reason: missing.length > 0
          ? `Missing required entities: ${missing.join(', ')}`
          : 'Intent and required entities are complete'
      }
    };
  }

  _shouldUseNoisyRepair(preparedInput, rawText, source) {
    if (/\b(?:setup|session|workspace|focus\s+mode|everything\s+i\s+need|apps?\s+i\s+use)\b/i.test(String(rawText || ''))) {
      return false;
    }

    if (/^\s*(?:what|who|when|where|why|how|which)\b/i.test(String(rawText || ''))) {
      return false;
    }

    if (/\b(?:ipl|cricket|score|scores|live|today'?s?|latest|current|standings?|fifa|world\s+cup|match(?:es)?|fixtures?|schedule|news|release\s+date|premiere|price|best\s+movies?|top\s+movies?)\b/i.test(String(rawText || ''))) {
      return false;
    }

    if (/^\s*(?:open|show|search|look\s+up|google)\b.*\b(?:in|on)\s+(?:chrome|browser|edge|firefox)\s*$/i.test(String(rawText || ''))) {
      return false;
    }

    if (this._resolveLocalInfoIntent(rawText, preparedInput)) {
      return false;
    }

    const repaired = String(preparedInput?.repairedCommandText || '').trim();
    const corrected = String(preparedInput?.correctedText || rawText || '').trim();
    if (!repaired || repaired === corrected) {
      return false;
    }

    const hasLocalScope = /\b(?:on|in)\s+(?:my\s+)?(?:laptop|pc|computer|system|device|windows)\b|\b(?:local|offline|this\s+(?:laptop|pc|computer|system|device))\b/i;
    if (hasLocalScope.test(corrected) && !hasLocalScope.test(repaired)) {
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

    if (/\.[A-Za-z0-9]{1,10}\b/.test(String(rawText || ''))) {
      return null;
    }

    if (/\b(?:open|close|launch|start|run|quit|exit|terminate)\b/.test(textToUse)) {
      return null;
    }

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

    if (/\b(stop\s*music|stop\s*song|stop\s*playback|stop\s*media)\b/i.test(textToUse)) {
      const intent = this.intentRegistry.get('media.stop');
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
    if (/\.[A-Za-z0-9]{1,10}\b/.test(input)) {
      return null;
    }
    if (/^(?:remind|set\s+reminder)\b/i.test(correctedText)) {
      return null;
    }

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
    if (/\.[A-Za-z0-9]{1,10}\b/.test(String(rawText || ''))) {
      return null;
    }

    if (/^\s*(?:remind|set\s+reminder)\b/i.test(String(rawText || ''))) {
      return null;
    }

    if (/^\s*(?:close|quit|exit|terminate|stop)\b/i.test(String(rawText || '')) &&
      /\b(?:app|application|chrome|edge|firefox|browser|youtube|spotify|google\s+chat|discord|teams)\b/i.test(String(rawText || ''))) {
      return null;
    }

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

  _resolveScreenshotIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!input) {
      return null;
    }

    if (/\b(?:show|open|view)\b.*\b(?:latest|last|recent|newest)\b.*\bscreenshots?\b/.test(input)) {
      const fileIntent = this.intentRegistry.get('file.open');
      return fileIntent
        ? { intent: fileIntent, confidence: 1, entities: { filename: 'screenshot in pictures' } }
        : null;
    }

    if (!/\b(?:screenshot|screen\s+shot|capture\s+screen|screen\s+capture|snap\s+screen)\b/.test(input)) {
      return null;
    }

    const intent = this.intentRegistry.get('system.screenshot');
    return intent ? { intent, confidence: 1, entities: {} } : null;
  }

  _resolveWorkspaceSetupIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const raw = String(rawText || corrected || '').trim().toLowerCase();
    const input = `${raw} ${corrected}`.replace(/\s+/g, ' ').trim();
    if (!input) {
      return null;
    }

    const modeIntent = this.intentRegistry.get('mode.start');
    const appIntent = this.intentRegistry.get('app.open');
    if (/\b(?:app|application)\s+i\s+use\s+most\s+for\s+coding\b/.test(raw) ||
      /\b(?:app|application)\s+i\s+use\s+most\s+for\s+coding\b/.test(corrected)) {
      return appIntent
        ? { intent: appIntent, confidence: 0.98, entities: { appName: 'code' } }
        : null;
    }

    const modeMap = [
      { modeName: 'development', pattern: /\b(?:coding|development|developer|project)\b/ },
      { modeName: 'work', pattern: /\b(?:work\s+setup|workspace|work\s+session)\b/ },
      { modeName: 'study', pattern: /\b(?:study\s+session|study\s+setup)\b/ },
      { modeName: 'focus', pattern: /\b(?:focus\s+mode|close\s+distractions|prepare\s+my\s+workspace)\b/ },
      { modeName: 'communication', pattern: /\b(?:communication\s+apps?|chat\s+apps?|messaging\s+apps?)\b/ },
      { modeName: 'daily', pattern: /\b(?:apps?\s+i\s+use\s+daily|daily\s+apps?)\b/ }
    ];

    if (!/\b(?:open|start|prepare|launch|activate|close)\b/.test(input) &&
      !/\b(?:focus\s+mode|close\s+distractions)\b/.test(input)) {
      return null;
    }

    const matched = modeMap.find(entry => entry.pattern.test(input));
    return matched && modeIntent
      ? { intent: modeIntent, confidence: 0.96, entities: { modeName: matched.modeName } }
      : null;
  }

  _resolveSystemInsightIntent(rawText, preparedInput) {
    const input = this._normalizeSystemCommandText(preparedInput?.correctedText || rawText);
    const intent = this.intentRegistry.get('system.insight');
    if (!intent || !input) {
      return null;
    }

    if (/\b(?:which|what)\b.*\b(?:app|process)\b.*\b(?:most\s+memory|using\s+the\s+most\s+memory|memory)\b/.test(input)) {
      return { intent, confidence: 1, entities: { insightType: 'topMemoryApp' } };
    }

    if (/\b(?:which|what)\b.*\b(?:process|app)\b.*\b(?:most\s+cpu|cpu)\b|\bconsuming\s+the\s+most\s+cpu\b/.test(input)) {
      return { intent, confidence: 1, entities: { insightType: 'topCpuProcess' } };
    }

    if (/\b(?:slowing\s+down|fan\s+running|fan\s+so\s+fast|computer\s+slow|laptop\s+slow)\b/.test(input)) {
      return { intent, confidence: 1, entities: { insightType: 'systemSlowdown' } };
    }

    if (/\b(?:taking\s+up\s+space|storage\s+usage|what\s+uses\s+space|largest\s+folders?)\b/.test(input)) {
      return { intent, confidence: 1, entities: { insightType: 'storageUsage' } };
    }

    if (/\b(?:recently|newly|last)\s+installed\s+(?:apps?|applications?|programs?)\b/.test(input)) {
      return { intent, confidence: 1, entities: { insightType: 'recentlyInstalledApps' } };
    }

    return null;
  }

  _resolveSmartFileIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const raw = String(rawText || corrected || '').trim().toLowerCase();
    const input = `${raw} ${corrected}`.replace(/\s+/g, ' ').trim();
    if (!input) {
      return null;
    }

    if (/[^\s]+\.[A-Za-z0-9]{1,10}\b/.test(input)) {
      return null;
    }

    const hasFileCue = /\b(?:file|files|pdf|pdfs|document|documents|resume|resumes|screenshot|screenshots|image|images|photo|photos|picture|pictures|presentation|presentations|download|downloaded|downloads|interview|interviews|project|projects|shortcut|shortcuts)\b/.test(input);
    const hasSmartCue = /\b(?:newest|latest|largest|recent|recently|edited|modified|opened|downloaded|created|today|yesterday|morning|last\s+week|6\s+months|duplicate|duplicates|contains|containing|mentioning|related\s+to|where\s+did|where\s+is|save|saved|worked\s+on)\b/.test(input);
    if (!hasFileCue || !hasSmartCue) {
      return null;
    }

    const intent = this.intentRegistry.get('file.smartFind');
    if (!intent) {
      return null;
    }

    const entities = this._buildSmartFileEntities(input);
    return entities
      ? { intent, confidence: 0.98, entities }
      : null;
  }

  _buildSmartFileEntities(input) {
    const entities = {
      query: '',
      location: this._extractSmartFileLocation(input),
      fileType: this._extractSmartFileType(input),
      sortBy: this._extractSmartFileSort(input),
      timeFilter: this._extractSmartFileTime(input),
      openResult: /\b(?:open|play|watch)\b/.test(input),
      groupDuplicates: /\bduplicates?\b/.test(input)
    };

    entities.query = this._extractSmartFileQuery(input, entities);
    if (!entities.query && /\bresumes?\b/.test(input)) {
      entities.query = 'resume';
    }
    if (!entities.query && /\binterviews?\b/.test(input)) {
      entities.query = 'interview';
    }
    if (!entities.query && /\bopenx\b/.test(input)) {
      entities.query = 'openx';
    }

    return entities;
  }

  _extractSmartFileLocation(input) {
    if (/\bdownloads?\b/.test(input)) return 'downloads';
    if (/\bdesktop\b/.test(input)) return 'desktop';
    if (/\bdocuments?\b/.test(input)) return 'documents';
    if (/\bpictures?|photos?\b/.test(input)) return 'pictures';
    if (/\bvideos?\b/.test(input)) return 'videos';
    if (/\bmusic\b/.test(input)) return 'music';
    return '';
  }

  _extractSmartFileType(input) {
    if (/\bpdfs?\b/.test(input)) return 'pdf';
    if (/\b(?:images?|photos?|pictures?|screenshots?)\b/.test(input)) return 'image';
    if (/\b(?:videos?|movies?)\b/.test(input)) return 'video';
    if (/\b(?:songs?|music|audio)\b/.test(input)) return 'audio';
    if (/\b(?:presentations?|slides?)\b/.test(input)) return 'presentation';
    if (/\b(?:zip|archive)\b/.test(input)) return 'archive';
    if (/\b(?:documents?|resume|resumes)\b/.test(input)) return 'document';
    return '';
  }

  _extractSmartFileSort(input) {
    if (/\blargest\b|\bbigger\b|\bmore\s+than\s+\d+\s*(?:mb|gb)\b/.test(input)) return 'sizeDesc';
    if (/\bcreated\b|\bdownloaded\b/.test(input)) return 'createdDesc';
    if (/\bopened\b|\baccessed\b/.test(input)) return 'accessedAsc';
    return 'modifiedDesc';
  }

  _extractSmartFileTime(input) {
    if (/\btoday\b/.test(input)) return 'today';
    if (/\byesterday\b/.test(input)) return 'yesterday';
    if (/\bthis\s+morning\b|\bmorning\b/.test(input)) return 'thisMorning';
    if (/\blast\s+week\b/.test(input)) return 'lastWeek';
    if (/\b6\s+months\b|\bsix\s+months\b/.test(input)) return 'olderThan6MonthsAccess';
    return '';
  }

  _extractSmartFileQuery(input, entities) {
    if (/\bscreenshots?\b/.test(input)) return 'screenshot';
    if (/\bresumes?\b/.test(input)) return 'resume';
    if (/\binterviews?\b/.test(input)) return 'interview';
    if (/\bproject\s+files?\b/.test(input)) return 'project';
    if (/\bapi\s+keys?\b/.test(input)) return 'api key';
    const afterFor = input.match(/\b(?:for|containing|mentioning|related\s+to)\s+([a-z0-9 ._-]+)$/i);
    if (afterFor?.[1]) {
      return afterFor[1]
        .replace(/\b(?:on|in)\s+(?:my\s+)?(?:computer|pc|downloads?|documents?|desktop|folder|folders)$/i, '')
        .trim();
    }
    if (entities.fileType || entities.timeFilter || entities.sortBy !== 'modifiedDesc' || entities.groupDuplicates) {
      return '';
    }
    return '';
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

  _resolveExplicitFileIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const rawLower = String(rawText || '').trim().toLowerCase();
    if (!input) {
      return null;
    }

    if (/\b(?:folder|directory)\b/.test(input)) {
      return null;
    }

    if (/^(?:open|show|launch|start|run)\s+(?:downloads|documents|desktop|pictures|music|videos|home)$/i.test(input)) {
      return null;
    }

    if (/^(?:search|search\s+for|look\s+up|google)\b/i.test(input) && this._looksLikeWebSearchQuery(input)) {
      return null;
    }

    const configs = [
      { intentId: 'file.open', pattern: /^(?:open|show|play|watch)\b/ },
      { intentId: 'file.create', pattern: /^(?:create|new|make)\b/ },
      { intentId: 'file.delete', pattern: /^(?:delete|remove|erase)\b/ },
      { intentId: 'file.copy', pattern: /^copy\b/ },
      { intentId: 'file.move', pattern: /^(?:move|bring)\b/ },
      { intentId: 'file.search', pattern: /^(?:locate|find|search)\b/ }
    ];

    const canBeImplicitLocate = /^(?:locate)\b/.test(input) && this._extractLocalFileSearchQuery(rawText || input, input);
    if (!canBeImplicitLocate && !/\b(?:file|location|path)\b|[^\s]+\.[A-Za-z0-9]{1,10}\b/i.test(`${input} ${rawText || ''}`)) {
      return null;
    }

    for (const config of configs) {
      if (!config.pattern.test(input) && !config.pattern.test(rawLower)) {
        continue;
      }
      const intent = this.intentRegistry.get(config.intentId);
      if (!intent) {
        continue;
      }
      const rawEntities = this.entityExtractor.extract(intent, rawText);
      const correctedEntities = this.entityExtractor.extract(intent, input);
      const entities = { ...correctedEntities, ...rawEntities };
      if (correctedEntities.destination && correctedEntities.destination !== rawEntities.destination) {
        entities.destination = correctedEntities.destination;
      }
      if (correctedEntities.path && correctedEntities.path !== rawEntities.path) {
        entities.path = correctedEntities.path;
      }
      if (config.intentId === 'file.search') {
        entities.query = this._extractLocalFileSearchQuery(rawText, input) || entities.query;
      }
      const missing = this._checkRequiredEntities(intent, entities);
      if (missing.length === 0) {
        return { intent, confidence: 1, entities };
      }
    }

    return null;
  }

  _resolveExplicitModeIntent(rawText, preparedInput) {
    const correctedText = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!correctedText) {
      return null;
    }

    if (!/\b(?:start|open|launch|run|activate)\b/.test(correctedText) || !/\bmode\b/.test(correctedText)) {
      return null;
    }

    const intent = this.intentRegistry.get('mode.start');
    if (!intent) {
      return null;
    }

    const entities = this.entityExtractor.extract(intent, rawText);
    const correctedEntities = this.entityExtractor.extract(intent, correctedText);
    const modeName = entities.modeName || correctedEntities.modeName;
    if (!modeName) {
      return null;
    }

    return { intent, confidence: 1, entities: { modeName } };
  }

  _resolveLiveKnowledgeIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim();
    const raw = String(rawText || corrected || '').trim();
    const input = corrected.toLowerCase();
    if (!input) {
      return null;
    }

    if (/^(?:open|close|launch|start|run|switch|focus|activate|set|turn|play|pause|resume|stop|create|delete|move|copy|rename|remind|search|google|look\s+up)\b/.test(input)) {
      return null;
    }

    const hasLiveCue = /\b(?:score|scores|live|today|latest|current|standings?|table|fixture|fixtures|schedule|news)\b/.test(input);
    const hasPublicTopic = /\b(?:ipl|cricket|fifa|world\s+cup|football|soccer|match|matches|team|teams|japan|react|node|javascript|ai)\b/.test(input);
    if (!hasLiveCue || !hasPublicTopic) {
      return null;
    }

    const intent = this.intentRegistry.get('browser.search');
    return intent
      ? { intent, confidence: 1, entities: { query: raw.toLowerCase(), openInBrowser: false } }
      : null;
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
    if (browserIntent && /^(?:open|launch|start|show)\s+(?:my\s+)?browser\b/i.test(lower)) {
      return { intent: browserIntent, confidence: 1, entities: { url: 'about:blank' } };
    }

    if (browserIntent && this._looksLikeUrlRequest(rawText)) {
      return { intent: browserIntent, confidence: 1 };
    }

    const fileIntent = this.intentRegistry.get('file.open');
    if (fileIntent) {
      const fileEntities = this.entityExtractor.extract(fileIntent, rawText);
      if (fileEntities.filename && this._looksLikeFileReference(fileEntities.filename, rawText)) {
        return { intent: fileIntent, confidence: 1, entities: fileEntities };
      }
    }

    const browserSearchIntent = this.intentRegistry.get('browser.search');
    const browserSearchEntities = this._extractOpenInBrowserSearch(rawText, preparedInput);
    if (browserSearchIntent && browserSearchEntities) {
      return { intent: browserSearchIntent, confidence: 1, entities: browserSearchEntities };
    }

    const folderIntent = this.intentRegistry.get('folder.open');
    if (folderIntent && this._looksLikeFolderOpenRequest(rawText)) {
      const rawFolderEntities = this.entityExtractor.extract(folderIntent, rawText);
      const correctedFolderEntities = this.entityExtractor.extract(folderIntent, input);
      const folderEntities = { ...correctedFolderEntities, ...rawFolderEntities };
      if (correctedFolderEntities.folderName && correctedFolderEntities.folderName !== rawFolderEntities.folderName) {
        folderEntities.folderName = correctedFolderEntities.folderName;
      }
      if (folderEntities.folderName) {
        return { intent: folderIntent, confidence: 0.98, entities: folderEntities };
      }
    }

    return null;
  }

  _resolveKnownWebOpenIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const match = input.match(/^(?:open|launch|start|go\s+to|show(?:\s+me)?)\s+(.+?)(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?$/i);
    if (!match?.[1]) {
      return null;
    }

    const requestedTarget = String(preparedInput?.semanticFrame?.targetText || match[1] || '').trim();
    if (this._looksLikeLocalPhotosTarget(requestedTarget, rawText)) {
      const appIntent = this.intentRegistry.get('app.open');
      return appIntent
        ? { intent: appIntent, confidence: 1, entities: { appName: 'photos' } }
        : null;
    }

    const query = preparedInput?.semanticFrame?.webTarget || this._normalizeKnownWebTarget(requestedTarget);
    if (!query) {
      return null;
    }

    const intent = this.intentRegistry.get('browser.openFirstResult');
    return intent
      ? { intent, confidence: 1, entities: { query } }
      : null;
  }

  _normalizeKnownWebTarget(value) {
    return normalizeWebTarget(value);
  }

  _looksLikeLocalPhotosTarget(target, rawText) {
    const normalizedTarget = String(target || '').toLowerCase();
    const normalizedRaw = String(rawText || '').toLowerCase();
    if (/\bgoogle\b/.test(normalizedTarget)) {
      return false;
    }
    if (!/\b(?:photos?|photesw?|phots|pictures?)\b/.test(normalizedTarget)) {
      return false;
    }
    return /\b(?:on|in)\s+(?:my\s+)?(?:laptop|pc|computer|system|device|windows)\b|\b(?:local|offline|this\s+(?:laptop|pc|computer|system|device))\b/.test(normalizedRaw);
  }

  _resolveExplicitCommunicationIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    if (!input) return null;

    const lower = input.toLowerCase();
    const emailIntent = this.intentRegistry.get('email.compose');
    if (emailIntent && /^(?:send\s+)?(?:email|mail)\b/i.test(lower)) {
      const entities = this._extractEmailComposeEntities(rawText);
      if (entities.contactName) {
        return { intent: emailIntent, confidence: 1, entities };
      }
    }

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

    if (/^(?:what|who|when|where|why|how|which)\b/.test(correctedText)) {
      return null;
    }

    if (this._looksLikeUrlRequest(rawText)) {
      return null;
    }

    const fileIntent = this.intentRegistry.get('file.open');
    if (fileIntent) {
      const fileEntities = this.entityExtractor.extract(fileIntent, rawText);
      if (fileEntities.filename && this._looksLikeFileReference(fileEntities.filename, rawText)) {
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

  _looksLikeFileReference(filename, rawText) {
    const fileName = String(filename || '').trim();
    const text = String(rawText || fileName || '').toLowerCase();
    return /\.[A-Za-z0-9]{1,10}$/.test(fileName) ||
      /\b(?:file|document|pdf|docx?|xlsx?|pptx?|txt|csv|json|js|ts|html|css|java|py|md|png|jpe?g|gif|mp4|mp3)\b/i.test(text);
  }

  _extractOpenInBrowserSearch(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    const match = input.match(/^open\s+(.+?)\s+(?:in|on)\s+(chrome|browser|edge|firefox)$/i);
    if (!match || !match[1]) {
      return null;
    }

    const query = match[1]
      .replace(/^(?:the|a|an)\s+/i, '')
      .trim();
    if (!query || this._looksLikeFileReference(query, rawText)) {
      return null;
    }

    return {
      query,
      openInBrowser: true
    };
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

    if (/^(search for|search the web for|search web|search|google|look up|find on web)\b/i.test(lower)) {
      return browserSearchIntent
        ? { intent: browserSearchIntent, confidence: 1, entities: this._buildSearchEntities(rawText, preparedInput) }
        : null;
    }

    return null;
  }

  _resolveBareKnowledgeSearchIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!input || /^(?:what|who|when|where|why|how|which)\b/.test(input)) {
      return null;
    }

    if (/^(?:open|close|launch|start|run|play|pause|resume|stop|send|message|call|create|delete|move|copy|rename|set|turn|switch|minimize|maximize)\b/.test(input)) {
      return null;
    }

    const query = preparedInput?.query || {};
    if (query.isLocal) {
      return null;
    }

    const hasKnowledgeSignal = this._looksLikeWebSearchQuery(input) ||
      /\b(?:ipl|cricket|fifa|world\s+cup|match(?:es)?|fixtures?|schedule|score|scores|winner|winners|champion|champions|event|release|released|premiere|price|latest|current|today'?s?|news|best|top|list|movie|movies|paper|journal|research|documentation|docs|tutorials?|examples?|guide)\b/.test(input);
    if (!hasKnowledgeSignal) {
      return null;
    }

    const browserSearchIntent = this.intentRegistry.get('browser.search');
    if (!browserSearchIntent) {
      return null;
    }

    const entities = this._buildSearchEntities(rawText, preparedInput);
    return {
      intent: browserSearchIntent,
      confidence: 0.9,
      entities: {
        ...entities,
        query: String(rawText || input).trim().toLowerCase().replace(/\btoday\s+s\b/g, "today's")
      }
    };
  }

  _looksLikeWebSearchQuery(input) {
    const text = String(input || '').toLowerCase();
    return /\b(?:tutorials?|documentation|docs?|examples?|guide|learn|react|angular|node|javascript|typescript|python|java|api|framework|weather|news|score|scores|latest|best|capital|difference|meaning)\b/.test(text);
  }

  _resolveBrowserTabIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '')
      .trim()
      .toLowerCase()
      .replace(/\bphotes\b/g, 'photos')
      .replace(/\bchromem\b/g, 'chrome')
      .replace(/\bchromme\b/g, 'chrome')
      .replace(/\bchrom\b/g, 'chrome')
      .replace(/\btaqbs?\b/g, 'tabs');
    const rawInput = String(rawText || '')
      .trim()
      .toLowerCase()
      .replace(/\bphotes\b/g, 'photos')
      .replace(/\bchromem\b/g, 'chrome')
      .replace(/\bchromme\b/g, 'chrome')
      .replace(/\bchrom\b/g, 'chrome')
      .replace(/\btaqbs?\b/g, 'tabs');
    const tabInput = `${input} ${rawInput}`.replace(/\s+/g, ' ').trim();
    const browserMatch = (tabInput.match(/\b(?:in|on)\s+(chrome|browser|edge|firefox)\b/));

    if (
      /^(?:what|which|show|list|tell)\b/.test(input) &&
      /\btabs?\b/.test(tabInput) &&
      /\b(?:open|opened|active|running|in|on|chrome|browser|edge|firefox)\b/.test(tabInput)
    ) {
      const intent = this.intentRegistry.get('browser.listTabs');
      return intent
        ? {
            intent,
            confidence: 1,
            entities: {
              browserName: browserMatch?.[1] || 'browser'
            }
          }
        : null;
    }

    if (/^(?:open\s+)?(?:a\s+)?new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?$/.test(input)) {
      const intent = this.intentRegistry.get('browser.open');
      return intent
        ? { intent, confidence: 1, entities: { url: 'about:blank' } }
        : null;
    }

    const targetedClose = input.match(/^(?:close|remove|shut)\s+(?:the\s+)?(.+?)\s+tabs?(?:\s+(?:in|on)\s+(chrome|browser|edge|firefox))?$/i);
    if (targetedClose?.[1]) {
      const tabQuery = this._normalizeBrowserTabQuery(targetedClose[1]);
      if (/^(?:current|active|empty|blank|first|1|one|selected|this)$/.test(tabQuery)) {
        const intent = this.intentRegistry.get('browser.closeTab');
        return intent
          ? {
              intent,
              confidence: 1,
              entities: {
                browserName: targetedClose[2] || browserMatch?.[1] || 'browser'
              }
            }
          : null;
      }

      if (tabQuery) {
        const intent = this.intentRegistry.get('browser.closeTab');
        return intent
          ? {
              intent,
              confidence: 1,
              entities: {
                browserName: targetedClose[2] || browserMatch?.[1] || 'browser',
                tabQuery
              }
            }
          : null;
      }
    }

    if (!/^(?:close|remove|shut)\s+(?:(?:the\s+)?(?:current|active|empty|blank|first|1|one|selected|this)\s+)?tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?$/.test(input)) {
      return null;
    }

    const intent = this.intentRegistry.get('browser.closeTab');
    return intent
      ? {
          intent,
          confidence: 1,
          entities: {
            browserName: browserMatch?.[1] || 'browser'
          }
        }
        : null;
  }

  _normalizeBrowserTabQuery(value) {
    const cleaned = String(value || '')
      .toLowerCase()
      .replace(/\bphotes\b/g, 'photos')
      .replace(/\bgoogle\s+photo\b/g, 'google photos')
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/\s+(?:tab|tabs|page|pages)$/i, '')
      .trim();
    if (!cleaned || /^(?:tab|tabs|page|pages)$/.test(cleaned)) {
      return '';
    }
    if (/^(?:first|1|one|current|active|selected|this|empty|blank)$/.test(cleaned)) {
      return cleaned;
    }
    return this._normalizeKnownWebTarget(cleaned) || cleaned;
  }

  _extractEmailComposeEntities(input) {
    const source = String(input || '').trim();
    const normalized = source
      .replace(/^send\s+(?:an?\s+)?(?:email|mail)\s+/i, 'email ')
      .replace(/^mail\s+/i, 'email ')
      .trim();
    const contactMatch = normalized.match(/^email\s+(?:to\s+)?(.+?)(?:\s+(?:about|regarding|with\s+subject|subject)\s+(.+?))?(?:\s+(?:saying|body|message|that|and\s+say)\s+(.+))?$/i);
    if (!contactMatch?.[1]) {
      return {};
    }

    const contactName = contactMatch[1]
      .replace(/\s+(?:please|now)$/i, '')
      .trim();
    const subject = String(contactMatch[2] || '').trim();
    const body = String(contactMatch[3] || '').trim();
    return {
      contactName,
      subject,
      body
    };
  }

  _resolveSiteSearchIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim();
    const raw = String(rawText || corrected || '').trim();
    const candidates = [corrected, raw].filter(Boolean);
    const intent = this.intentRegistry.get('browser.siteSearch');
    if (!intent) {
      return null;
    }

    const personalEmail = String(rawText || corrected || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .match(/^(?:search|find|show)\s+(?:my\s+)?emails?\s+(?:for|from|about)\s+(.+)$/i);
    if (personalEmail?.[1]) {
      return {
        intent,
        confidence: 1,
        entities: {
          site: 'gmail',
          query: personalEmail[1].trim()
        }
      };
    }

    for (const candidate of candidates) {
      const parsed = this._extractSiteSearch(candidate);
      if (parsed) {
        return {
          intent,
          confidence: 1,
          entities: parsed
        };
      }
    }

    return null;
  }

  _extractSiteSearch(input) {
    const normalized = String(input || '')
      .toLowerCase()
      .replace(/\bphotes\b/g, 'photos')
      .replace(/\bfo\b/g, 'for')
      .replace(/\bclass\s+mates\b/g, 'classmates')
      .replace(/\s+/g, ' ')
      .trim();
    const sitePattern = '(google photos?|photos|youtube|you tube|gmail|google mail|mail|google drive|drive|google maps?|maps|chrome settings?|browser settings|chatgpt|chat gpt)';
    const patterns = [
      new RegExp(`^(?:in|on|inside)\\s+${sitePattern}\\s+(?:search|find|look\\s+for|look\\s+up)\\s+(?:for\\s+)?(.+)$`, 'i'),
      new RegExp(`^(?:search|find|look\\s+for|look\\s+up|google)\\s+(?:for\\s+)?(.+?)\\s+(?:in|on|inside)\\s+${sitePattern}$`, 'i'),
      new RegExp(`^(?:search|find|look\\s+for|look\\s+up)\\s+${sitePattern}\\s+(?:for\\s+)?(.+)$`, 'i'),
      new RegExp(`^(?:open|show|go\\s+to)\\s+${sitePattern}\\s+(?:and\\s+)?(?:search|find|look\\s+for)\\s+(?:for\\s+)?(.+)$`, 'i')
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (!match) {
        continue;
      }

      const groups = match.slice(1).filter(Boolean);
      const site = groups.find(value => this._normalizeSiteSearchTarget(value));
      const query = groups.find(value => value !== site);
      const cleanQuery = this._cleanSiteSearchQuery(query);
      const normalizedSite = this._normalizeSiteSearchTarget(site);
      if (normalizedSite && cleanQuery) {
        return {
          site: normalizedSite,
          query: normalizedSite === 'google photos'
            ? this._refinePhotoSiteSearchQuery(cleanQuery)
            : cleanQuery
        };
      }
    }

    return null;
  }

  _normalizeSiteSearchTarget(value) {
    const target = String(value || '').trim().toLowerCase();
    const aliases = {
      photos: 'google photos',
      photo: 'google photos',
      'google photo': 'google photos',
      'google photos': 'google photos',
      youtube: 'youtube',
      'you tube': 'youtube',
      gmail: 'gmail',
      mail: 'gmail',
      'google mail': 'gmail',
      drive: 'google drive',
      'google drive': 'google drive',
      maps: 'google maps',
      'google map': 'google maps',
      'google maps': 'google maps',
      'chrome setting': 'chrome settings',
      'chrome settings': 'chrome settings',
      'browser settings': 'chrome settings',
      chatgpt: 'chatgpt',
      'chat gpt': 'chatgpt'
    };
    return aliases[target] || null;
  }

  _cleanSiteSearchQuery(value) {
    const cleaned = String(value || '')
      .replace(/^(?:for|the|a|an)\s+/i, '')
      .replace(/^(?:in|on)\s+(?:chrome|browser|edge|firefox)$/i, '')
      .replace(/\s+(?:please|in\s+chrome|on\s+chrome|in\s+browser|on\s+browser)$/i, '')
      .trim();
    return /[a-z0-9]/i.test(cleaned) ? cleaned : '';
  }

  _refinePhotoSiteSearchQuery(query) {
    const personalQuery = this._extractPersonalPhotoQuery(query);
    return personalQuery && personalQuery !== 'photos'
      ? personalQuery
      : query;
  }

  _resolveSystemSettingsIntent(rawText, preparedInput) {
    const input = this._normalizeSystemCommandText(preparedInput?.correctedText || rawText);
    if (!/\b(?:wifi|wi\s*fi|bluetooth|hotspot|mobile\s+hotspot)\b/.test(input)) {
      return null;
    }

    if (/\bbluetooth\b/.test(input)) {
      const intent = this.intentRegistry.get('system.bluetooth');
      if (!intent) {
        return null;
      }

      const asksStatus = /\b(?:what|status|about|is|are)\b/.test(input);
      const turnsOn = /\b(?:(?:turn|switch|put)\s+on|enable|activate)\b|\b(?:turn|switch|put)\s+bluetooth\s+on\b/.test(input);
      const turnsOff = /\b(?:(?:turn|switch|put)\s+(?:off|of)|disable|deactivate)\b|\b(?:turn|switch|put)\s+bluetooth\s+(?:off|of)\b/.test(input);
      if (turnsOn && !asksStatus) {
        return { intent, confidence: 1, entities: { enabled: true } };
      }
      if (turnsOff && !asksStatus) {
        return { intent, confidence: 1, entities: { enabled: false } };
      }
      if (/^(?:what|tell|show|check|is|are)\b|\b(?:status|about|enabled|disabled|on|off)\b/.test(input)) {
        return { intent, confidence: 1, entities: {} };
      }
    }

    const isSettingsLikeRequest =
      /^(?:turn|switch|enable|disable|open|show|check)\b/.test(input) ||
      /\b(?:is|are)\s+(?:on|off|enabled|disabled)\b/.test(input);
    if (!isSettingsLikeRequest) {
      return null;
    }

    const target = /\bhotspot|mobile\s+hotspot\b/.test(input)
      ? 'ms-settings:network-mobilehotspot'
      : /\bbluetooth\b/.test(input)
        ? 'ms-settings:bluetooth'
        : 'ms-settings:network-wifi';
    const intent = this.intentRegistry.get('app.open');
    return intent
      ? { intent, confidence: 1, entities: { appName: target } }
      : null;
  }

  _resolveBrowserFollowupIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    if (!/^(?:click|open|go\s+to)\s+(?:the\s+)?first\s+(?:link|result|search\s+result)\b/.test(input)) {
      return null;
    }

    const intent = this.intentRegistry.get('browser.openFirstResult');
    const queryMatch = input.match(/\b(?:for|of)\s+(.+)$/i);
    const query = queryMatch?.[1]
      ? queryMatch[1].replace(/\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)\s*$/i, '').trim()
      : '';
    return intent ? { intent, confidence: 1, entities: query ? { query } : {} } : null;
  }

  _resolveExplicitReminderIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    if (!/^remind\b/i.test(input)) {
      return null;
    }

    const intent = this.intentRegistry.get('reminder.set');
    if (!intent) {
      return null;
    }

    const entities = this.entityExtractor.extract(intent, rawText);
    if (!entities.reminderText) {
      const fallbackText = input
        .replace(/^remind(?:\s+me)?\s+(?:to\s+)?/i, '')
        .trim();
      if (fallbackText && !/^(?:me|myself)$/i.test(fallbackText)) {
        entities.reminderText = fallbackText;
      }
    }

    return entities.reminderText
      ? { intent, confidence: 1, entities }
      : null;
  }

  _resolveLocalInfoIntent(rawText, preparedInput) {
    const input = this._normalizeSystemCommandText(preparedInput?.correctedText || rawText);
    const publicKnowledgeContext = /\b(?:ipl|cricket|fifa|world\s+cup|match(?:es)?|fixtures?|schedule|score|scores|winner|winners|champion|champions|event|release|released|premiere|price|news|movie|movies)\b/.test(input);
    const systemTimeIntent = this.intentRegistry.get('system.time');
    const systemDateIntent = this.intentRegistry.get('system.date');
    const systemStatusIntent = this.intentRegistry.get('system.status');
    const systemCpuIntent = this.intentRegistry.get('system.cpu');
    const systemMemoryIntent = this.intentRegistry.get('system.memory');
    const systemProcessesIntent = this.intentRegistry.get('system.processes');
    const systemBatteryIntent = this.intentRegistry.get('system.battery');
    const systemDiskIntent = this.intentRegistry.get('system.disk');

    if (/\b(?:time)\b/.test(input) && /^(?:what|when|tell|show|current|time)\b/.test(input)) {
      return systemTimeIntent ? { intent: systemTimeIntent, confidence: 1, entities: {} } : null;
    }

    if (!publicKnowledgeContext && /\b(?:date|day|today)\b/.test(input) && /^(?:what|which|tell|show|current|date|day)\b/.test(input)) {
      return systemDateIntent ? { intent: systemDateIntent, confidence: 1, entities: {} } : null;
    }

    if (/\b(?:cpu|processor)\b/.test(input) && /\b(?:usage|status|use|using|load|percent|percentage|how\s+much|current)\b/.test(input)) {
      return systemCpuIntent ? { intent: systemCpuIntent, confidence: 1, entities: {} } : null;
    }

    if (/\b(?:ram|memory)\b/.test(input) && /\b(?:usage|status|use|using|used|available|free|left|about|how\s+much|current)\b/.test(input)) {
      return systemMemoryIntent ? { intent: systemMemoryIntent, confidence: 1, entities: {} } : null;
    }

    if (/\b(?:battery|charge|power)\b/.test(input) && /\b(?:status|level|percent|percentage|remaining|left|how\s+much|current|battery|charge)\b/.test(input)) {
      return systemBatteryIntent ? { intent: systemBatteryIntent, confidence: 1, entities: {} } : null;
    }

    if (/\b(?:disk|storage|drive|space)\b/.test(input) && /\b(?:space|storage|disk|drive|free|left|available|usage|used|status|how\s+much)\b/.test(input)) {
      return systemDiskIntent ? { intent: systemDiskIntent, confidence: 1, entities: {} } : null;
    }

    if (
      /\b(?:running|open|opened|active|visible|in\s+use|being\s+used|used)\b/.test(input) &&
      /\b(?:apps?|applications?|processes|programs?|system)\b/.test(input)
    ) {
      const target = /\b(?:apps?|applications?|programs?|windows?)\b/.test(input) && !/\bprocesses\b/.test(input)
        ? 'apps'
        : 'processes';
      const queryApp = target === 'apps' ? this._extractRunningAppQuery(input) : '';
      return systemProcessesIntent
        ? {
            intent: systemProcessesIntent,
            confidence: 1,
            entities: queryApp ? { target, queryApp } : { target }
          }
        : null;
    }

    const queryApp = this._extractRunningAppQuery(input);
    if (queryApp && /\b(?:is|are|check|tell|whether|if|see)\b/.test(input) && /\b(?:running|open|opened|active|visible|in\s+use|being\s+used|used)\b/.test(input)) {
      return systemProcessesIntent
        ? { intent: systemProcessesIntent, confidence: 1, entities: { target: 'apps', queryApp } }
        : null;
    }

    if (/\b(?:system|computer|pc|laptop|machine)\b/.test(input) && /\b(?:status|health|usage|running|about|info|information|performance|condition|doing)\b/.test(input)) {
      return systemStatusIntent ? { intent: systemStatusIntent, confidence: 1, entities: {} } : null;
    }

    return null;
  }

  _extractRunningAppQuery(input) {
    const text = this._normalizeSystemCommandText(input);
    const patterns = [
      /\bif\s+(.+?)\s+(?:is|are)\s+(?:running|open|opened|active)\b/,
      /\b(?:is|are)\s+(.+?)\s+(?:running|open|opened|active)\b/,
      /\b(?:check|tell\s+me|see)\s+(?:if|whether)\s+(.+?)\s+(?:is|are)\s+(?:running|open|opened|active)\b/,
      /\b(?:check|tell\s+me|see)\s+(.+?)\s+(?:running|open|opened|active)\b/,
      /\b(.+?)\s+(?:is|are)\s+(?:running|open|opened|active)\b/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const candidate = match?.[1]
        ?.replace(/\b(?:the|app|application|program|window|and|what|which|apps?|are|running|open|opened|active|tell|me|check|if|whether)\b/g, ' ')
        .replace(/\b(?:is|are)\s*$/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (candidate && /^[a-z0-9][a-z0-9 ._-]{1,40}$/i.test(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  _normalizeSystemCommandText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\bblue\s+tooth\b/g, 'bluetooth')
      .replace(/\bblu\s+tooth\b/g, 'bluetooth')
      .replace(/\bblutooth\b/g, 'bluetooth')
      .replace(/\bmemry\b/g, 'memory')
      .replace(/\bmemeory\b/g, 'memory')
      .replace(/\bstroage\b/g, 'storage')
      .replace(/\bproceses\b/g, 'processes')
      .replace(/\bproccesses\b/g, 'processes')
      .replace(/\bproccess\b/g, 'process')
      .replace(/\bopend\b/g, 'opened')
      .replace(/\busing\b/g, 'in use')
      .replace(/\s+/g, ' ');
  }

  _resolveAssistantConversationIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const raw = String(rawText || corrected || '').trim().toLowerCase();
    const combined = `${raw} ${corrected}`.trim();
    const variants = [corrected, raw, combined].filter(Boolean);

    if (variants.some(text => /^(?:what|who)\s+(?:is|am)\s+(?:my|i)\s+(?:name|called)\b|^do\s+you\s+know\s+my\s+name\b/.test(text))) {
      const intent = this.intentRegistry.get('assistant.userName');
      return intent ? { intent, confidence: 1, entities: {} } : null;
    }

    if (variants.some(text => /^(?:what|who)\s+(?:is|are)\s+(?:your|you)\s+(?:name|called)\b|^who\s+are\s+you\b/.test(text))) {
      const intent = this.intentRegistry.get('assistant.identity');
      return intent ? { intent, confidence: 1, entities: {} } : null;
    }

    if (
      variants.some(text => /^(?:how\s+are\s+you|how\s+do\s+you\s+do|are\s+you\s+(?:ok|okay|ready))\b/.test(text)) ||
      variants.some(text => /^(?:hello|hi|hey|good\s+(?:morning|afternoon|evening))\b/.test(text))
    ) {
      const intent = this.intentRegistry.get('greeting');
      if (!intent) {
        return null;
      }

      const greetingType = /\bgood\s+morning\b/.test(combined)
        ? 'morning'
        : /\bgood\s+afternoon\b/.test(combined)
          ? 'afternoon'
          : /\bgood\s+evening\b/.test(combined)
            ? 'evening'
            : /^how\s+are\s+you\b/.test(combined)
              ? 'wellbeing'
              : /^hi\b/.test(combined)
                ? 'hi'
                : /^hey\b/.test(combined)
                  ? 'hey'
                  : 'hello';
      return { intent, confidence: 1, entities: { greetingType } };
    }

    if (
      /\b(?:what\s+can\s+you\s+do|what\s+can\s+i\s+say|show\s+help|help\s+me|how\s+do\s+you\s+help\s+me)\b/.test(combined) ||
      /\b(?:your\s+(?:work|job|role|purpose|capabilities|commands)|you\s+do\s+for\s+me)\b/.test(combined)
    ) {
      const intent = this.intentRegistry.get('help');
      return intent ? { intent, confidence: 1, entities: {} } : null;
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
    const query = preparedInput?.query || {};
    if (!/\b(?:file|files|folder|folders|items|contents|pdf|pdfs|images?|photos?|pictures?|videos?|audio|music)\b/.test(input)) {
      return null;
    }

    const listRequest = query.isLocalFileQuestion || (
      /^(?:what|which|show|list|tell)\b/.test(input) &&
      /\b(?:are|is|in|on|inside|under|from|files|folders|items|contents)\b/.test(input)
    );
    if (!listRequest) {
      return null;
    }

    const localLocation = query.localLocation || this._extractLocalListLocation(input);
    if (!localLocation) {
      return null;
    }

    const fileListIntent = this.intentRegistry.get('file.list');
    return fileListIntent
      ? { intent: fileListIntent, confidence: 1, entities: { path: localLocation, fileType: query.requestedFileType || null } }
      : null;
  }

  _resolveLocalFileSearchIntent(rawText, preparedInput) {
    const input = String(preparedInput?.correctedText || rawText || '').trim();
    const lower = input.toLowerCase();
    if (!/^(?:locate|find|search|where\s+is|where\s+are|what\s+is\s+the\s+location\s+of|show\s+me\s+where)\b/.test(lower)) {
      return null;
    }
    const query = this._extractLocalFileSearchQuery(rawText || input, input);
    if (!query) {
      return null;
    }
    if (!/^(?:locate)\b/i.test(input) && !/\b(?:file|folder|directory|location|path)\b|[^\s]+\.[A-Za-z0-9]{1,10}\b/i.test(`${input} ${rawText || ''}`)) {
      return null;
    }

    const intent = this.intentRegistry.get('file.search');
    if (!intent) {
      return null;
    }

    return { intent, confidence: 1, entities: { query } };
  }

  _extractLocalFileSearchQuery(rawText, correctedText = rawText) {
    const clean = value => String(value || '')
      .trim()
      .replace(/^(?:locate|find|search(?:\s+for)?|where\s+(?:is|are|i)|whare\s+i|what\s+is\s+the\s+location\s+of|show\s+me\s+where)\s+/i, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/\s+(?:on|in)\s+(?:my\s+)?(?:computer|pc|laptop|system|files?|folders?)$/i, '')
      .replace(/\s+(?:file|folder|directory|location|path)$/i, '')
      .replace(/\b([a-z0-9_-]+)\s+(pdf|txt|docx?|xlsx?|pptx?|csv|json|xml|html?|js|ts|py|java|md|png|jpe?g|gif|webp|mp[34]|mkv|wav|zip|rar)$/i, '$1.$2')
      .trim();

    const source = String(rawText || '').trim();
    const fallback = String(correctedText || '').trim();
    const sourceQuery = clean(source);
    const fallbackQuery = clean(fallback);
    const query = sourceQuery && sourceQuery !== source
      ? sourceQuery
      : fallbackQuery && fallbackQuery !== fallback
        ? fallbackQuery
        : sourceQuery;
    return query && !/^(?:file|folder|directory|location|path)$/i.test(query)
      ? query.toLowerCase()
      : '';
  }

  _resolvePersonalPhotoIntent(rawText, preparedInput) {
    const corrected = String(preparedInput?.correctedText || rawText || '').trim().toLowerCase();
    const raw = String(rawText || corrected || '').trim().toLowerCase();
    const input = `${raw} ${corrected}`
      .replace(/\bclassmetes\b/g, 'classmates')
      .replace(/\bclassm[eai]tes\b/g, 'classmates')
      .replace(/\bpics?\b/g, 'photos')
      .replace(/\s+/g, ' ')
      .trim();

    if (!/\b(?:find|show|open|search|look)\b/.test(input)) {
      return null;
    }

    if (!/\b(?:photos?|pictures?|images?)\b/.test(input)) {
      return null;
    }

    const personalCue = /\b(?:my|me|mine|class|classmates|friends?|family|recent|memories|google\s+photos?|photos\s+app|in\s+the\s+photos?)\b/.test(input);
    if (!personalCue) {
      return null;
    }

    const photoLibrary = this.learningStore?.getPreference?.('photoLibrary')?.value || '';
    const wantsGooglePhotos = /\bgoogle\s+photos?\b/.test(input) || photoLibrary === 'googlePhotos';
    if (wantsGooglePhotos) {
      const intent = this.intentRegistry.get('browser.siteSearch');
      return intent
        ? {
            intent,
            confidence: 0.95,
            entities: {
              site: 'google photos',
              query: this._extractPersonalPhotoQuery(input)
            }
          }
        : null;
    }

    const wantsWindowsPhotos = /\b(?:microsoft\s+photos|windows\s+photos|photos\s+app)\b/.test(input) ||
      photoLibrary === 'windowsPhotos';
    if (wantsWindowsPhotos) {
      const intent = this.intentRegistry.get('app.open');
      return intent ? { intent, confidence: 0.92, entities: { appName: 'photos' } } : null;
    }

    const intent = this.intentRegistry.get('file.search');
    return intent
      ? {
          intent,
          confidence: 0.95,
          entities: {
            query: this._extractPersonalPhotoQuery(input),
            personalSearchType: 'photo'
          }
        }
      : null;
  }

  _extractPersonalPhotoQuery(input) {
    const text = String(input || '')
      .toLowerCase()
      .replace(/\bclassmetes\b/g, 'classmates')
      .replace(/\bclassm[eai]tes\b/g, 'classmates');
    const priorityTerms = [
      ['classmates', /\b(?:classmates?|class\s+mates?|college\s+friends?|school\s+friends?)\b/],
      ['friends', /\bfriends?\b/],
      ['family', /\bfamily\b/],
      ['me', /\b(?:me|myself|mine)\b/],
      ['recent', /\brecent\b/]
    ];
    const matched = priorityTerms
      .filter(([, pattern]) => pattern.test(text))
      .map(([term]) => term);
    return matched.length > 0
      ? Array.from(new Set(matched)).join(' ')
      : 'photos';
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
    const query = preparedInput?.query || {};
    if (!/^(what|who|when|where|why|how|which)\b/.test(input) && !query.isKnowledgeQuestion) {
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
    const isQuestion = /^(?:what|who|when|where|why|how|which)\b/i.test(corrected || raw);
    const rawSearchQuery = this._extractRawSearchQuery(raw);
    let query = isQuestion
      ? (corrected || raw)
      : (rawSearchQuery ||
        this.entityExtractor._extractQuery(corrected.toLowerCase(), corrected) ||
        this.entityExtractor._extractQuery(corrected.toLowerCase(), raw) ||
        raw ||
        corrected);
    const browserHintSource = `${raw} ${corrected}`.trim();
    const openInBrowser = /\b(?:open|show|search|look\s+up|google).*\b(?:in|on)\s+(?:chrome|browser|edge|firefox)\b/i.test(browserHintSource)
      || /\bnew\s+tab\b/i.test(browserHintSource)
      || /\b(?:open|show)\s+(?:it|results?)\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)\b/i.test(browserHintSource);

    query = String(query || '')
      .replace(/\s+(?:in|on)\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
      .replace(/\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
      .replace(/\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)\s*$/i, '')
      .trim();

    return {
      query,
      openInBrowser
    };
  }

  _extractRawSearchQuery(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return '';
    }

    const match = text.match(/^(?:could\s+you\s+please\s+|can\s+you\s+please\s+|please\s+)?(?:search\s+for|search\s+the\s+web\s+for|search\s+web\s+for|search\s+web|search|google|look\s+up|find\s+on\s+web)\s+(.+)$/i);
    if (!match?.[1]) {
      return '';
    }

    return match[1]
      .replace(/\s+(?:in|on)\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
      .replace(/\s+new\s+tab(?:\s+(?:in|on)\s+(?:chrome|browser|edge|firefox))?\s*$/i, '')
      .replace(/\s+(?:in|on)\s+(?:chrome|browser|edge|firefox)\s*$/i, '')
      .trim();
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
