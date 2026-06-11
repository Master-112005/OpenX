const EventEmitter = require('events');
const {
  AssistantEventBus,
  EVENTS,
  Logger,
  Normalizer
} = require('../shared/index');
const ActionRouter = require('./router/index');
const AutomationEngine = require('../automation/index');
const ContextManager = require('./context/index');
const ActiveLearningStore = require('./learning/index');
const Personality = require('./personality/index');
const ResponseGenerator = require('./responses/index');

const CONFIRM_PHRASES = [
  'approve',
  'carry on',
  'confirm',
  'continue',
  'do it',
  'execute it',
  'go ahead',
  'ok',
  'okay',
  'please continue',
  'proceed',
  'run it',
  'sure',
  'yes',
  'yeah',
  'yep'
];

const CANCEL_PHRASES = [
  'abort',
  'canle',
  'cancle',
  'cancel',
  'cancel it',
  'cancel that',
  'do not continue',
  'do not do it',
  'do not proceed',
  'do not run it',
  'dont',
  'dont continue',
  'dont do it',
  'dont proceed',
  'forget it',
  'leave it',
  'nah',
  'never mind',
  'nevermind',
  'no',
  'nope',
  'stop',
  'stop it'
];

const CANCEL_PATTERNS = [
  /\b(?:abort|canle|cancle|cancel|nevermind|no|nope|stop)\b/,
  /\bnever\s+mind\b/,
  /\b(?:forget|leave)\s+(?:it|that)\b/,
  /\b(?:do\s+not|dont)\s+(?:continue|do|proceed|run|execute|close|delete|shutdown|restart)\b/
];

const CONFIRM_PATTERNS = [
  /\b(?:approve|confirm|continue|proceed|yes|yeah|yep|sure|ok|okay)\b/,
  /\b(?:carry\s+on|do\s+it|execute\s+it|go\s+ahead|run\s+it)\b/
];

class Assistant extends EventEmitter {
  constructor(config, dependencies = {}) {
    super();
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.eventBus = dependencies.eventBus || config?.eventBus || new AssistantEventBus();
    this.learning = dependencies.learning || new ActiveLearningStore(config);
    const routerConfig = {
      ...(config || {}),
      learningStore: this.learning
    };
    this.automation = dependencies.automation || new AutomationEngine(config);
    this.router = dependencies.router || new ActionRouter(routerConfig, this.automation);
    if (this.router && !this.router.learningStore) {
      this.router.learningStore = this.learning;
    }
    this.context = new ContextManager(config);
    this.personality = new Personality(config);
    this.responses = new ResponseGenerator(config);
    this.isProcessing = false;
    this.pendingConfirmation = null;
    this.pendingClarification = null;
    this.pendingFeedback = null;
    this.pendingLearningCorrection = null;
  }

  async processCommand(input, source = 'chat') {
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      return {
        success: false,
        response: this.responses.generate('error', 'noCommand'),
        source
      };
    }

    this.isProcessing = true;
    this.eventBus.publish(EVENTS.COMMAND_RECEIVED, { input, source });
    this.emit('processing', { input, source });

    try {
      const confirmationResult = await this._handlePendingConfirmation(input, source);
      if (confirmationResult) {
        return confirmationResult;
      }

      const clarificationResult = await this._handlePendingClarification(input, source);
      if (clarificationResult) {
        return clarificationResult;
      }

      const learningResult = await this._handleLearningInput(input, source);
      if (learningResult) {
        return learningResult;
      }

      const memoryResult = this._answerPersonalMemoryQuestion(input, source);
      if (memoryResult) {
        return memoryResult;
      }

      const routedInput = this._buildRoutedInput(input);
      const result = await this.router.process(routedInput, source);
      this.context.record(input, result.entities || {}, result);
      this._recordLearningOutcome(input, routedInput, result);

      let response = result.response || '';
      response = this._appendLearningPrompt(response, input, routedInput, result);
      response = this.personality.applyToResponse(response);

      if (result.requiresConfirmation) {
        this.pendingConfirmation = {
          commandId: result.commandId,
          intentId: result.intent,
          entities: { ...(result.entities || {}) },
          source
        };
      } else if (result.needsClarification) {
        this.pendingClarification = {
          commandId: result.commandId,
          intentId: result.intent,
          entities: { ...(result.entities || {}) },
          data: result.data || {},
          response
        };
      } else if (result.success) {
        this.pendingConfirmation = null;
        this.pendingClarification = null;
      }

      if (result.intent) {
        this.eventBus.publish(EVENTS.INTENT_DETECTED, {
          commandId: result.commandId,
          source,
          intent: result.intent,
          confidence: result.confidence ?? null,
          entities: result.entities || {}
        });
      }

      if (!result.requiresConfirmation && result.intent) {
        this.eventBus.publish(EVENTS.COMMAND_EXECUTED, {
          commandId: result.commandId,
          source,
          success: Boolean(result.success),
          intent: result.intent,
          entities: result.entities || {},
          data: result.data || null,
          error: result.error || null
        });
      }

      this.eventBus.publish(EVENTS.RESPONSE_GENERATED, {
        commandId: result.commandId,
        source,
        success: Boolean(result.success),
        intent: result.intent || null,
        response
      });
      this.emit('result', { ...result, response, source });
      return { ...result, response, source };
    } catch (err) {
      this.logger.error('Command processing error', err);
      const response = this.personality.applyToResponse(
        this.responses.generate('error', 'executionFailed', { error: err.message })
      );
      this.eventBus.publish(EVENTS.COMMAND_EXECUTED, {
        commandId: null,
        source,
        success: false,
        intent: null,
        entities: {},
        data: null,
        error: err.message
      });
      this.eventBus.publish(EVENTS.RESPONSE_GENERATED, {
        commandId: null,
        source,
        success: false,
        intent: null,
        response
      });
      return { success: false, response, source, error: err.message };
    } finally {
      this.isProcessing = false;
    }
  }

  processVoiceInput(text) {
    return this.processCommand(this._prepareVoiceInput(text), 'voice');
  }

  async confirmAction(commandId, intentId, entities) {
    if (this.pendingConfirmation && this.pendingConfirmation.commandId === commandId) {
      this.pendingConfirmation = null;
    }
    const result = await this.router.confirmAndExecute(commandId, intentId, entities);
    return {
      ...result,
      response: this.personality.applyToResponse(result.response || '')
    };
  }

  expirePendingConfirmation(reason = 'timeout', source = 'voice') {
    if (!this.pendingConfirmation) {
      return null;
    }

    this.pendingConfirmation = null;
    const templateId = reason === 'cancelled' ? 'cancelled' : 'timedOut';
    return {
      success: false,
      expired: reason === 'timeout',
      cancelled: reason === 'cancelled',
      source,
      response: this.personality.applyToResponse(
        this.responses.generate('confirmation', templateId)
      )
    };
  }

  getContext() {
    return this.context;
  }

  getPersonality() {
    return this.personality;
  }

  getStatus() {
    return {
      isProcessing: this.isProcessing,
      awaitingConfirmation: Boolean(this.pendingConfirmation),
      awaitingClarification: Boolean(this.pendingClarification),
      awaitingFeedback: Boolean(this.pendingFeedback),
      awaitingLearningCorrection: Boolean(this.pendingLearningCorrection),
      recentCommands: this.context.getRecentCommands(),
      conversation: this.context.getConversationSummary()
    };
  }

  _buildRoutedInput(input) {
    const contextual = this._resolveContextualFollowUp(input) || input;
    const learned = this.learning?.findCorrection?.(contextual);
    this._lastRoutingLearning = learned || null;
    this._lastContextualRewrite = contextual !== input ? { input, correction: contextual } : null;
    return learned?.correction || contextual;
  }

  _answerPersonalMemoryQuestion(input, source) {
    if (!this.learning?.enabled || !this.learning?.answerPersonalQuestion) {
      return null;
    }

    const answer = this.learning.answerPersonalQuestion(input);
    if (!answer) {
      return null;
    }

    const response = this.personality.applyToResponse(answer.response);
    return {
      success: answer.known,
      intent: 'assistant.memory',
      entities: { fact: answer.fact },
      data: answer,
      response,
      source
    };
  }

  async _handleLearningInput(input, source) {
    const raw = String(input || '').trim();
    if (!raw || !this.learning?.enabled) {
      return null;
    }

    if (this.pendingLearningCorrection) {
      const pending = this.pendingLearningCorrection;
      this.pendingLearningCorrection = null;
      const correction = this._extractCorrectionCommand(raw) || raw;
      return this._executeCorrectionBeforeLearning(pending, correction, source, {
        source: 'negative-feedback',
        reason: 'post-action-correction'
      });
    }

    if (this.pendingFeedback) {
      const commandAfterFeedback = this._extractCommandAfterFeedback(raw);
      if (commandAfterFeedback) {
        const pending = this.pendingFeedback;
        this.pendingFeedback = null;
        this.learning.recordFeedback({
          ...pending,
          rating: 'positive',
          note: 'positive-feedback-with-next-command'
        });
        return this.processCommand(commandAfterFeedback, source);
      }

      const feedback = this._classifyFeedback(raw);
      if (feedback === 'positive') {
        const pending = this.pendingFeedback;
        this.pendingFeedback = null;
        this.learning.recordFeedback({
          ...pending,
          rating: 'positive'
        });
        return {
          success: true,
          learned: true,
          source,
          response: this.personality.applyToResponse('Thanks. I will remember that this worked.')
        };
      }

      if (feedback === 'negative') {
        const pending = this.pendingFeedback;
        this.pendingFeedback = null;
        const correction = this._extractCorrectionCommand(raw);
        if (correction) {
          return this._executeCorrectionBeforeLearning(pending, correction, source, {
            source: 'negative-feedback',
            reason: 'embedded-correction'
          });
        }

        this.pendingLearningCorrection = pending;
        return {
          success: false,
          learned: false,
          source,
          response: this.personality.applyToResponse(
            `What should I do next time when you say "${pending.input}"?`
          )
        };
      }

      this.pendingFeedback = null;
    }

    const correction = this._extractCorrectionCommand(raw);
    if (correction && this._looksLikeCorrectiveUtterance(raw)) {
      const lastFailed = this._getLastFailedLearningTarget();
      if (lastFailed?.input) {
        return this._executeCorrectionBeforeLearning(lastFailed, correction, source, {
          source: 'corrective-command',
          reason: 'last-failed-command'
        });
      }
      const result = await this.processCommand(correction, source);
      return result;
    }

    if (this._looksLikeNegativeOutcomeReport(raw)) {
      const target = this._getLastActionableLearningTarget();
      if (target?.input) {
        this.learning.recordFeedback({
          ...target,
          rating: 'negative',
          note: raw
        });
        this.pendingLearningCorrection = target;
        return {
          success: false,
          learned: false,
          source,
          response: this.personality.applyToResponse(
            `What should I do instead next time when you say "${target.input}"?`
          )
        };
      }
    }

    const explicitLearning = this.learning.learnFromText(raw);
    if (explicitLearning) {
      return {
        success: true,
        learned: true,
        source,
        response: this.personality.applyToResponse(explicitLearning.response)
      };
    }

    return null;
  }

  _appendLearningPrompt(response, input, routedInput, result) {
    if (!this._shouldAskForLearningFeedback(result)) {
      return response;
    }

    const promptEntry = {
      input: String(input || '').trim(),
      routedInput: String(routedInput || input || '').trim(),
      intent: result.intent || null,
      entities: result.entities || {},
      confidence: result.confidence ?? 1,
      learnedCorrection: this._lastRoutingLearning,
      contextualRewrite: this._lastContextualRewrite
    };
    if (this.learning?.shouldAskForFeedback && !this.learning.shouldAskForFeedback(promptEntry)) {
      return response;
    }
    this.learning?.recordFeedbackPrompt?.(promptEntry);

    this.pendingFeedback = {
      ...promptEntry,
      success: Boolean(result.success)
    };
    return `${response} Did that work correctly?`;
  }

  _shouldAskForLearningFeedback(result) {
    if (!this.learning?.enabled || !this.learning?.askForFeedback) {
      return false;
    }
    if (!result?.success || result.requiresConfirmation || result.needsClarification || !result.intent) {
      return false;
    }

    return /^(?:app|file|folder|browser|media|message|call|mode|window)\./.test(result.intent) ||
      ['system.bluetooth', 'system.screenshot'].includes(result.intent);
  }

  async _executeCorrectionBeforeLearning(pending, correction, source, metadata = {}) {
    this.learning.recordFeedback({
      ...pending,
      rating: 'negative',
      correction
    });

    const result = await this.processCommand(correction, source);
    if (result.success && !result.requiresConfirmation && !result.needsClarification) {
      const rule = this.learning.rememberCorrection(pending.input, correction, metadata);
      return {
        ...result,
        learned: Boolean(rule),
        learningRule: rule,
        response: this.personality.applyToResponse(
          `I learned the correction. ${result.response || ''}`.trim()
        )
      };
    }

    return {
      ...result,
      learned: false,
      response: this.personality.applyToResponse(
        `I tried that correction, but I will not remember it because it did not complete. ${result.response || ''}`.trim()
      )
    };
  }

  _recordLearningOutcome(input, routedInput, result) {
    if (!this.learning?.enabled || !result) {
      return;
    }
    if (result.success) {
      return;
    }
    this.learning.recordFeedback({
      input,
      routedInput,
      intent: result.intent || null,
      success: false,
      rating: 'negative',
      note: result.error || result.response || ''
    });
  }

  _classifyFeedback(input) {
    const normalized = this._normalizeConfirmationText(input);
    if (!normalized) {
      return null;
    }
    if (/^(?:yes|yeah|yep|ya|correct|right|good|worked|it worked|that worked|done|perfect|properly)\b/.test(normalized) ||
      /\b(?:worked|correct|right|perfect|good job)\b/.test(normalized)) {
      return 'positive';
    }
    if (/^(?:no|nope|wrong|incorrect|bad|failed|not done|did not work|didnt work|that was wrong)\b/.test(normalized) ||
      /\b(?:wrong|incorrect|failed|did not work|didnt work|not what i wanted|mistake)\b/.test(normalized)) {
      return 'negative';
    }
    return null;
  }

  _extractCommandAfterFeedback(input) {
    const text = String(input || '').trim();
    const match = text.match(/^(?:yes|yeah|yep|ya|ok|okay|sure|correct|right)\s*,?\s*((?:open|close|search|find|play|set|turn|start|launch|show|list|send|call)\b.+)$/i) ||
      text.match(/^(?:yes|yeah|yep|ya|ok|okay|sure|correct|right)(open|close|search|find|play|set|turn|start|launch|show|list|send|call)\b(.+)$/i);
    if (!match) {
      return '';
    }
    return match[2] !== undefined
      ? `${match[1]}${match[2]}`.trim()
      : String(match[1] || '').trim();
  }

  _extractCorrectionCommand(input) {
    const text = String(input || '').trim();
    if (!text) {
      return '';
    }

    const stripped = text
      .replace(/^(?:no|nope|nah|wrong|incorrect|that\s+was\s+wrong|it\s+was\s+wrong|not\s+that|not\s+correct)\s*,?\s*/i, '')
      .replace(/^(?:i\s+said\s+to\s+|i\s+said\s+|i\s+meant\s+to\s+|i\s+meant\s+|you\s+should\s+have\s+|you\s+should\s+|next\s+time\s+|instead\s+|please\s+)/i, '')
      .replace(/^(open|close|search|find|play|set|turn|start|launch|show|list|send|call)\s+the\s+/i, '$1 ')
      .trim();
    if (!stripped || stripped === text && !/^(?:open|close|search|find|play|set|turn|start|launch|show|list|send|call)\b/i.test(stripped)) {
      return '';
    }
    return stripped;
  }

  _looksLikeCorrectiveUtterance(input) {
    return /^(?:i\s+said|i\s+meant|you\s+should\s+have|not\s+that|wrong|incorrect|nope|no,?\s+(?:open|close|search|find|play|set|turn|start|launch|show|list|send|call))\b/i.test(String(input || '').trim());
  }

  _looksLikeNegativeOutcomeReport(input) {
    const normalized = this._normalizeConfirmationText(input);
    return /^(?:you\s+did\s+wrong|that\s+was\s+wrong|wrong|incorrect|not\s+correct|not\s+what\s+i\s+wanted|task\s+not\s+done|not\s+done|did\s+not\s+work|didnt\s+work|it\s+failed|failed)\b/.test(normalized) ||
      /\b(?:you\s+did\s+wrong|that\s+was\s+wrong|not\s+what\s+i\s+wanted|task\s+not\s+done|did\s+not\s+work|didnt\s+work)\b/.test(normalized);
  }

  _getLastFailedLearningTarget() {
    return this.context.getHistory(8)
      .slice()
      .reverse()
      .find(entry => entry && entry.success === false && entry.input && entry.intent);
  }

  _getLastActionableLearningTarget() {
    return this.context.getHistory(12)
      .slice()
      .reverse()
      .find(entry => entry &&
        entry.input &&
        entry.intent &&
        /^(?:app|file|folder|browser|media|message|call|mode|window|system\.bluetooth|system\.screenshot)\b/.test(entry.intent));
  }

  async _handlePendingConfirmation(input, source) {
    if (!this.pendingConfirmation) {
      return null;
    }

    const normalized = this._normalizeConfirmationText(input);
    if (this._isCancelPhrase(normalized)) {
      this.pendingConfirmation = null;
      return {
        success: true,
        cancelled: true,
        source,
        response: this.personality.applyToResponse(
          this.responses.generate('confirmation', 'cancelled')
        )
      };
    }

    if (this._isConfirmPhrase(normalized)) {
      const pending = this.pendingConfirmation;
      this.pendingConfirmation = null;
      const result = await this.router.confirmAndExecute(
        pending.commandId,
        pending.intentId,
        pending.entities
      );
      const response = this.personality.applyToResponse(result.response || '');
      return {
        ...result,
        response,
        source
      };
    }

    return {
      success: false,
      requiresConfirmation: true,
      source,
      commandId: this.pendingConfirmation.commandId,
      intent: this.pendingConfirmation.intentId,
      entities: { ...this.pendingConfirmation.entities },
      response: this.personality.applyToResponse(
        this.responses.generate('confirmation', 'awaitingDecision')
      )
    };
  }

  async _handlePendingClarification(input, source) {
    if (!this.pendingClarification) {
      return null;
    }

    const normalized = this._normalizeConfirmationText(input);
    if (this._isCancelPhrase(normalized)) {
      this.pendingClarification = null;
      return {
        success: true,
        cancelled: true,
        source,
        response: this.personality.applyToResponse(
          this.responses.generate('confirmation', 'cancelled')
        )
      };
    }

    const pending = this.pendingClarification;
    if (pending.data?.confirmEntities && this._isConfirmPhrase(normalized)) {
      this.pendingClarification = null;
      const result = await this.router.confirmAndExecute(
        pending.commandId,
        pending.intentId,
        {
          ...pending.entities,
          ...pending.data.confirmEntities
        }
      );
      const response = this.personality.applyToResponse(result.response || '');
      return {
        ...result,
        response,
        source
      };
    }

    const choice = this._resolveClarificationChoice(normalized, pending.data?.choices || []);
    if (!choice) {
      return {
        success: false,
        needsClarification: true,
        source,
        commandId: pending.commandId,
        intent: pending.intentId,
        entities: { ...pending.entities },
        data: pending.data,
        response: pending.response || 'Please say the number or title of the window to close.'
      };
    }

    this.pendingClarification = null;
    const result = await this.router.confirmAndExecute(
      pending.commandId,
      pending.intentId,
      this._buildClarifiedEntities(pending.entities, choice)
    );
    const response = this.personality.applyToResponse(result.response || '');
    return {
      ...result,
      response,
      source
    };
  }

  _resolveClarificationChoice(input, choices) {
    const normalized = String(input || '').trim().toLowerCase();
    const list = Array.isArray(choices) ? choices : [];
    if (!normalized || list.length === 0) {
      return null;
    }

    const numeric = normalized.match(/\b(?:number\s*)?(\d+)\b/);
    if (numeric) {
      const index = parseInt(numeric[1], 10);
      const byIndex = list.find(choice => Number(choice.index) === index);
      if (byIndex) {
        return byIndex;
      }
    }

    return list.find(choice => {
      const title = Normalizer.normalizeText(choice.title || '');
      const choicePath = Normalizer.normalizeText(choice.path || '');
      return (title && (title.includes(normalized) || normalized.includes(title))) ||
        (choicePath && (choicePath.includes(normalized) || normalized.includes(choicePath)));
    }) || null;
  }

  _buildClarifiedEntities(baseEntities, choice) {
    const entities = {
      ...(baseEntities || {}),
      ...(choice.entities || {})
    };

    if (choice.id) {
      entities.targetProcessId = choice.id;
    }
    if (choice.title) {
      entities.targetWindowTitle = choice.title;
    }
    if (choice.path) {
      entities.selectedPath = choice.path;
    }

    return entities;
  }

  _resolveContextualFollowUp(input) {
    const normalized = Normalizer.normalizeText(String(input || '').trim());
    if (!normalized) {
      return '';
    }

    const listFollowUp = /^(?:list|show|tell|display|open)?\s*(?:them|those|these|it|that)(?:\s+again)?$/.test(normalized) ||
      /^(?:list|show|tell|display)\s+(?:them|those|these|it|that)\b/.test(normalized);
    if (!listFollowUp) {
      return this._resolveVoiceReference(input);
    }

    const lastFileList = this.context.getHistory(8)
      .slice()
      .reverse()
      .find(entry => entry?.success && entry?.intent === 'file.list' && entry?.entities?.path);

    if (!lastFileList) {
      return this._resolveVoiceReference(input);
    }

    const entities = lastFileList.entities || {};
    const type = String(entities.fileType || '').trim();
    const path = String(entities.path || '').trim();
    if (!path) {
      return this._resolveVoiceReference(input);
    }

    return `list ${type ? `${type} ` : ''}files in ${path}`;
  }

  _isConfirmPhrase(text) {
    return this._matchesConfirmationIntent(text, CONFIRM_PHRASES, CONFIRM_PATTERNS);
  }

  _isCancelPhrase(text) {
    return this._matchesConfirmationIntent(text, CANCEL_PHRASES, CANCEL_PATTERNS);
  }

  _normalizeConfirmationText(text) {
    const expanded = Normalizer.expandContractions(String(text || '').trim());
    return Normalizer.normalizeText(expanded)
      .replace(/\bplease\b/g, ' ')
      .replace(/\b(?:assistant|jarvis|hey)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _matchesConfirmationIntent(text, phrases, patterns) {
    const normalized = this._normalizeConfirmationText(text);
    if (!normalized) {
      return false;
    }

    if (patterns.some(pattern => pattern.test(normalized))) {
      return true;
    }

    if (phrases.some(phrase => normalized === phrase || normalized.startsWith(`${phrase} `))) {
      return true;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    const candidates = [
      tokens[0],
      tokens.slice(0, 2).join(' '),
      tokens.slice(0, 3).join(' '),
      tokens.slice(0, 4).join(' ')
    ].filter(Boolean);

    return candidates.some(candidate => Boolean(Normalizer.findClosestOption(candidate, phrases, {
      maxDistance: candidate.length >= 7 ? 2 : 1,
      minSimilarity: candidate.length >= 7 ? 0.78 : 0.84
    })));
  }

  _prepareVoiceInput(text) {
    const raw = String(text || '').trim();
    if (!raw || this.pendingConfirmation) {
      return raw;
    }

    try {
      const prepared = this.router?.nlp?.prepare?.(raw);
      const useNoisyRepair = prepared?.repairedCommandText
        && (
          Number(prepared?.noiseTokenCount || 0) > 0
          || Number(prepared?.repairContextTokenCount || 0) > 0
        )
        && Number(prepared?.actionTokenCount || 0) <= 1;
      const candidate = String(
        (useNoisyRepair ? prepared.repairedCommandText : '')
        || prepared?.correctedText
        || prepared?.normalizedText
        || ''
      ).trim();
      return this._resolveVoiceReference(candidate || raw);
    } catch (error) {
      this.logger.warn('Voice NLP preparation failed', error.message);
      return this._resolveVoiceReference(raw);
    }
  }

  _resolveVoiceReference(input) {
    const text = String(input || '').trim();
    if (!text) {
      return text;
    }

    const normalized = Normalizer.normalizeText(text);
    if (!/\b(?:it|that|same)\b/.test(normalized)) {
      return text;
    }

    const target = this._getLastReferenceTarget();
    if (!target) {
      return text;
    }

    return normalized
      .replace(/\b(?:it|that|same)\b/g, target)
      .replace(/^(?:can|could|would)\s+(?:you\s+)?(?:please\s+)?/i, '')
      .replace(/^please\s+/i, '')
      .replace(/\bthe\s+([a-z0-9][a-z0-9 ._-]*)$/i, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _getLastReferenceTarget() {
    const history = this.context.getHistory(8).slice().reverse();
    const keys = [
      'appName',
      'platform',
      'windowName',
      'folderName',
      'filename',
      'fileName',
      'query',
      'contactName'
    ];

    for (const entry of history) {
      const entities = entry?.entities || {};
      for (const key of keys) {
        const value = String(entities[key] || '').trim();
        if (value) {
          return value.toLowerCase();
        }
      }
    }

    return '';
  }
}

module.exports = Assistant;
