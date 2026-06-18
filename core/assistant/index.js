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

      const sessionContextResult = this._answerSessionContextQuestion(input, source) ||
        this._answerTimeUntilQuestion(input, source) ||
        this._answerUnsupportedPersonalIntegration(input, source);
      if (sessionContextResult) {
        this.context.record(input, {}, sessionContextResult);
        return sessionContextResult;
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
      const contextAwareError = this._generateContextAwareErrorResponse(result, input);
      if (contextAwareError) {
        response = contextAwareError;
      }
      if (!contextAwareError) {
        response = this._appendLearningPrompt(response, input, routedInput, result);
      }
      response = this.personality.applyToResponse(response);

      if (result.requiresConfirmation) {
        const pendingStep = result.intent === 'multi.command'
          ? result.data?.pendingStep
          : null;
        this.pendingConfirmation = {
          commandId: pendingStep?.commandId || result.commandId,
          intentId: pendingStep?.intent || result.intent,
          entities: { ...(pendingStep?.entities || result.entities || {}) },
          originalInput: input,
          source,
          multiCommand: pendingStep ? {
            parentCommandId: result.commandId,
            originalInput: input,
            completedSteps: Array.isArray(result.data?.completedSteps)
              ? result.data.completedSteps
              : [],
            confirmedInput: pendingStep.input,
            remainingCommands: Array.isArray(result.data?.remainingCommands)
              ? result.data.remainingCommands
              : []
          } : null
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
          languageUnderstanding: result.languageUnderstanding || null,
          validation: result.validation || result.data?.validation || null,
          verification: result.verification || result.data?.verification || null,
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
    const pending = this.pendingConfirmation && this.pendingConfirmation.commandId === commandId
      ? this.pendingConfirmation
      : null;
    if (this.pendingConfirmation && this.pendingConfirmation.commandId === commandId) {
      this.pendingConfirmation = null;
    }
    const result = await this.router.confirmAndExecute(commandId, intentId, entities);
    if (result.success && pending?.multiCommand) {
      return this._continuePendingMultiCommand(pending, result, pending.source || 'chat');
    }
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

  _answerSessionContextQuestion(input, source) {
    const normalized = Normalizer.normalizeText(String(input || '').trim());
    if (!normalized) {
      return null;
    }

    if (/^(?:what\s+did\s+i\s+just\s+say|what\s+was\s+my\s+last\s+(?:message|question)|what\s+did\s+i\s+say\s+(?:before|earlier|last))\b/.test(normalized)) {
      const previous = this.context.getPreviousUserUtterance();
      return this._directContextResult(source, previous
        ? `You just said: ${previous}.`
        : 'I do not have a previous message in this session yet.');
    }

    if (/^(?:what\s+(?:were|are)\s+we\s+(?:talking|discussing)\s+about|what\s+was\s+i\s+talking\s+about|summarize\s+(?:our|this)\s+(?:chat|conversation)|recap\s+(?:our|this)\s+(?:chat|conversation))\b/.test(normalized)) {
      const digest = this.context.buildConversationDigest({ limit: 8 });
      return this._directContextResult(source, digest.summaryText || 'I do not have enough chat history to summarize yet.');
    }

    if (/^(?:what\s+did\s+we\s+talk\s+about\s+last\s+time|what\s+did\s+you\s+remember\s+from\s+(?:the\s+)?last\s+(?:chat|conversation))\b/.test(normalized)) {
      const remembered = this.learning?.getUserFact?.('last_conversation_summary');
      return this._directContextResult(source, remembered?.value
        ? remembered.value
        : 'I do not have a saved previous conversation summary yet.');
    }

    const saidAboutMatch = normalized.match(/^what\s+did\s+i\s+(?:say|ask|tell\s+you)\s+about\s+(.+)$/);
    if (saidAboutMatch?.[1]) {
      const topic = saidAboutMatch[1].trim();
      const relevant = this.context.getRelevantHistory(topic, 4)
        .filter(entry => entry.input && !/^what\s+did\s+i\s+/i.test(entry.input));
      if (relevant.length > 0) {
        const lines = relevant.map(entry => entry.input).join('; ');
        return this._directContextResult(source, `You mentioned ${topic} in: ${lines}.`);
      }
      return this._directContextResult(source, `I do not remember you mentioning ${topic} in this session.`);
    }

    if (/^(?:what\s+were\s+)?(?:the\s+)?last\s+three\s+commands\s+i\s+gave\b/.test(normalized)) {
      const commands = this.context.getRecentCommands(3);
      return this._directContextResult(source, commands.length
        ? `Your last three commands were: ${commands.join('; ')}.`
        : 'I do not have three commands in this session yet.');
    }

    if (/^what\s+did\s+i\s+ask\s+you\s+to\s+do\s+today\b/.test(normalized)) {
      const commands = this.context.getCommandsToday()
        .map(entry => entry.input)
        .filter(Boolean)
        .slice(-8);
      return this._directContextResult(source, commands.length
        ? `Today you asked me to: ${commands.join('; ')}.`
        : 'I do not have any commands recorded for today yet.');
    }

    if (/^what\s+was\s+my\s+first\s+command\b/.test(normalized)) {
      const first = this.context.getFirstCommandToday();
      return this._directContextResult(source, first?.input
        ? `Your first command today was: ${first.input}.`
        : 'I do not have a first command recorded for today yet.');
    }

    if (/^what\s+was\s+my\s+last\s+command\b/.test(normalized)) {
      const last = this.context.getLastCommand();
      return this._directContextResult(source, last?.input
        ? `Your last command was: ${last.input}.`
        : 'I do not have a previous command recorded yet.');
    }

    if (/^(?:what\s+was\s+)?(?:the\s+)?last\s+thing\s+i\s+searched\b/.test(normalized)) {
      const search = this.context.getLastSearch();
      const query = search?.entities?.query || search?.data?.query || '';
      return this._directContextResult(source, query
        ? `Your last search was: ${query}.`
        : 'I do not have a previous search recorded yet.');
    }

    if (/^which\s+one\s+did\s+i\s+search\s+first\b/.test(normalized)) {
      const search = this.context.getFirstSearchToday();
      const query = search?.entities?.query || search?.data?.query || '';
      return this._directContextResult(source, query
        ? `The first search I have for today is: ${query}.`
        : 'I do not have a search recorded for today yet.');
    }

    if (/^which\s+app\s+did\s+i\s+open\s+before\s+this\b/.test(normalized)) {
      const previous = this.context.getPreviousAppOpen();
      return this._directContextResult(source, previous?.entities?.appName
        ? `Before this, you opened ${previous.entities.appName}.`
        : 'I do not have an earlier app open recorded in this session.');
    }

    if (/^which\s+app\s+did\s+you\s+close\b/.test(normalized)) {
      const closed = this.context.getLastAppAction('app.close');
      return this._directContextResult(source, closed?.entities?.appName
        ? `I last closed ${closed.entities.appName}.`
        : 'I do not have a closed app recorded in this session.');
    }

    if (/^(?:what\s+file\s+(?:were\s+we\s+discussing|did\s+i\s+open)\s+earlier|what\s+file\s+is\s+this)\b/.test(normalized)) {
      const fileEntry = this.context.getLastFileReference();
      const file = this.context.getFileReference(fileEntry);
      return this._directContextResult(source, file?.name
        ? `The file in context is ${file.name}${file.path ? ` at ${file.path}` : ''}.`
        : 'I do not have a file in context yet.');
    }

    if (/^(?:what\s+is\s+)?(?:its|the)\s+file\s+name\b/.test(normalized)) {
      const fileEntry = this.context.getLastFileReference();
      const file = this.context.getFileReference(fileEntry);
      return this._directContextResult(source, file?.name
        ? `The file name is ${file.name}.`
        : 'I do not have a file in context yet.');
    }

    return null;
  }

  _answerTimeUntilQuestion(input, source) {
    const text = String(input || '').trim();
    const match = text.match(/\b(?:how\s+long\s+until|time\s+until|calculate\s+how\s+long\s+until)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (!match) {
      return null;
    }

    const now = new Date();
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = String(match[3] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }

    const diffMs = target.getTime() - now.getTime();
    const totalMinutes = Math.max(0, Math.round(diffMs / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const parts = [
      hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '',
      minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : ''
    ].filter(Boolean);
    return this._directContextResult(source, `${parts.join(' and ') || 'less than a minute'} until ${match[1]}${match[2] ? `:${match[2]}` : ''}${meridiem ? ` ${meridiem.toUpperCase()}` : ''}.`);
  }

  _answerUnsupportedPersonalIntegration(input, source) {
    const normalized = Normalizer.normalizeText(String(input || '').trim());
    if (!normalized) {
      return null;
    }

    if (/\b(?:meetings?|calendar|next\s+event)\b/.test(normalized)) {
      return this._directContextResult(source, 'Calendar reading is not connected yet, so I cannot reliably list your meetings from the system.');
    }

    if (/\b(?:read|summarize|show)\b.*\b(?:unread\s+)?emails?\b/.test(normalized)) {
      return this._directContextResult(source, 'Email reading is not connected yet. I can open or search Gmail, but I cannot read your inbox locally.');
    }

    if (/^if\s+.+\b(?:warn|notify|remind)\s+me\b/.test(normalized)) {
      return this._directContextResult(source, 'Continuous condition monitoring is not connected yet. I can check the current status now, but I will not pretend a background watcher was created.');
    }

    return null;
  }

  _directContextResult(source, response) {
    return {
      commandId: null,
      success: true,
      intent: 'assistant.context',
      confidence: 1,
      entities: {},
      data: {},
      response: this.personality.applyToResponse(response),
      source
    };
  }

  _getRecentAppAction(intent = null) {
    const history = this.context.getHistory(10).slice().reverse();
    for (const entry of history) {
      if (entry?.success && entry?.intent?.startsWith('app.')) {
        if (!intent || entry.intent === intent) {
          return entry;
        }
      }
    }
    return null;
  }

  _generateContextAwareErrorResponse(result, input) {
    if (result.success !== false) {
      return null;
    }

    const intent = result.intent;
    const entities = result.entities || {};
    const error = result.error || '';
    const loweredError = String(error).toLowerCase();
    const appName = entities.appName || '';

    if (intent === 'app.close' && appName) {
      const recentOpen = this.context.findRecent(
        entry => entry?.success && !entry?.requiresConfirmation && entry?.intent === 'app.open' && entry?.entities?.appName?.toLowerCase() === appName.toLowerCase(),
        10
      );
      if (recentOpen) {
        if (loweredError.includes('could not close')) {
          return this.personality.applyToResponse(
            `I opened ${appName} for you earlier, sir, but I am having trouble closing it. It may not be running, or Windows rejected the request. Would you like me to try again?`
          );
        }
      }

      if (loweredError.includes('could not close')) {
        return this.personality.applyToResponse(
          `I could not close ${appName}, sir. It may not be running, or Windows rejected the request. Would you like me to try opening it first?`
        );
      }
    }

    return null;
  }

  _buildRoutedInput(input) {
    const contextual = this._resolveContextualFollowUp(input);
    const contextualChanged = contextual && contextual !== input;
    const personalSource = contextualChanged ? '' : this._resolvePersonalSourceRouting(input);
    const routedInput = contextualChanged ? contextual : (personalSource || contextual || input);
    const contextualForLearning = routedInput;
    const learned = this.learning?.findCorrection?.(contextualForLearning);
    this._lastRoutingLearning = learned || null;
    this._lastContextualRewrite = contextualForLearning !== input ? { input, correction: contextualForLearning } : null;
    return learned?.correction || contextualForLearning;
  }

  _resolvePersonalSourceRouting(input) {
    const normalized = Normalizer.normalizeText(String(input || '').trim());
    if (!normalized) {
      return '';
    }

    const emailSearch = normalized.match(/^search\s+(?:my\s+)?emails?\s+(?:for|about)\s+(.+)$/);
    if (emailSearch?.[1]) {
      return `search ${emailSearch[1].trim()} in gmail`;
    }

    return '';
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

    const chatMemory = this._rememberCurrentChatRequest(raw, source);
    if (chatMemory) {
      return chatMemory;
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
      languageUnderstanding: result.languageUnderstanding || null,
      validation: result.validation || result.data?.validation || null,
      verification: result.verification || result.data?.verification || null,
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

    if (/^media\./.test(result.intent)) {
      return false;
    }

    return /^(?:app|file|folder|browser|message|call|mode|window)\./.test(result.intent) ||
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
      const interest = this._extractInterestSignal(input, routedInput, result);
      if (interest) {
        this.learning.rememberPreference?.(`interest.${interest.key}`, interest.value, {
          source: 'successful-command',
          intent: result.intent || null
        });
      }
      return;
    }
    this.learning.recordFeedback({
      input,
      routedInput,
      intent: result.intent || null,
      success: false,
      rating: 'negative',
      note: result.error || result.response || '',
      languageUnderstanding: result.languageUnderstanding || null,
      validation: result.validation || result.data?.validation || null,
      verification: result.verification || result.data?.verification || null
    });
  }

  _extractInterestSignal(input, routedInput, result) {
    const intent = result?.intent || '';
    if (!/^(?:browser\.search|browser\.siteSearch|browser\.openFirstResult|media\.play|media\.search)$/.test(intent)) {
      return null;
    }

    const raw = String(
      result.entities?.query ||
      result.entities?.mediaQuery ||
      result.data?.query ||
      routedInput ||
      input ||
      ''
    ).trim();
    const topic = this._cleanKnowledgeTopic(raw)
      .replace(/\b(?:latest|good|best|interesting|relaxing|funny|videos?|music|podcast|course|tutorial)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!topic || topic.length < 3) {
      return null;
    }
    const key = topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    return key ? { key, value: topic } : null;
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
      .find(entry => entry && entry.success === false && entry.input);
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
      if (pending.multiCommand) {
        return this._continuePendingMultiCommand(pending, result, source);
      }
      const response = this.personality.applyToResponse(result.response || '');
      this.context.record(pending.originalInput || input, result.entities || {}, result);
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
      response: this.personality.applyToResponse(this._buildPendingConfirmationPrompt())
    };
  }

  _buildPendingConfirmationPrompt() {
    const pending = this.pendingConfirmation;
    const appName = String(pending?.entities?.appName || '').trim();
    if (pending?.intentId === 'app.close' && appName) {
      return `I am waiting for your decision. Please say proceed or cancel. Say yes to close ${appName}, or no to cancel.`;
    }
    return this.responses.generate('confirmation', 'awaitingDecision');
  }

  async _continuePendingMultiCommand(pending, confirmedResult, source) {
    const multi = pending?.multiCommand || {};
    const steps = Array.isArray(multi.completedSteps)
      ? multi.completedSteps.slice()
      : [];

    steps.push({
      commandId: confirmedResult.commandId || pending.commandId || null,
      input: multi.confirmedInput || pending.originalInput || '',
      success: Boolean(confirmedResult.success),
      intent: confirmedResult.intent || pending.intentId || null,
      entities: confirmedResult.entities || pending.entities || {},
      response: confirmedResult.response || '',
      error: confirmedResult.error || null,
      requiresConfirmation: Boolean(confirmedResult.requiresConfirmation),
      confirmationMessage: confirmedResult.confirmationMessage || null,
      permissionLevel: confirmedResult.permissionLevel || null
    });

    if (!confirmedResult.success || confirmedResult.requiresConfirmation) {
      const result = {
        commandId: multi.parentCommandId || confirmedResult.commandId || null,
        success: false,
        intent: 'multi.command',
        confidence: 1,
        entities: { commands: [multi.confirmedInput, ...(multi.remainingCommands || [])].filter(Boolean) },
        steps,
        response: this._buildMultiCommandResponse(steps),
        source
      };
      this.context.record(pending.originalInput || multi.confirmedInput || '', result.entities, result);
      return {
        ...result,
        response: this.personality.applyToResponse(result.response)
      };
    }

    const remaining = Array.isArray(multi.remainingCommands) ? multi.remainingCommands : [];
    for (let index = 0; index < remaining.length; index += 1) {
      const clause = remaining[index];
      const result = await this.router.process(clause, source, { allowMulti: false });
      const step = {
        commandId: result.commandId || null,
        input: clause,
        success: Boolean(result.success),
        intent: result.intent || null,
        entities: result.entities || {},
        response: result.response || '',
        error: result.error || null,
        requiresConfirmation: Boolean(result.requiresConfirmation),
        confirmationMessage: result.confirmationMessage || null,
        permissionLevel: result.permissionLevel || null
      };
      steps.push(step);

      if (result.requiresConfirmation) {
        this.pendingConfirmation = {
          commandId: step.commandId,
          intentId: step.intent,
          entities: { ...(step.entities || {}) },
          originalInput: pending.originalInput,
          source,
          multiCommand: {
            parentCommandId: multi.parentCommandId,
            originalInput: pending.originalInput,
            completedSteps: steps.slice(0, -1),
            confirmedInput: clause,
            remainingCommands: remaining.slice(index + 1)
          }
        };
        return {
          ...result,
          intent: 'multi.command',
          steps,
          response: this.personality.applyToResponse(result.response || ''),
          source
        };
      }

      if (!result.success) {
        const failed = {
          commandId: multi.parentCommandId || result.commandId || null,
          success: false,
          intent: 'multi.command',
          confidence: 1,
          entities: { commands: [multi.confirmedInput, ...remaining].filter(Boolean) },
          steps,
          response: this._buildMultiCommandResponse(steps),
          source
        };
        this.context.record(pending.originalInput || clause, failed.entities, failed);
        return {
          ...failed,
          response: this.personality.applyToResponse(failed.response)
        };
      }
    }

    const completed = {
      commandId: multi.parentCommandId || confirmedResult.commandId || null,
      success: true,
      intent: 'multi.command',
      confidence: 1,
      entities: { commands: [multi.confirmedInput, ...remaining].filter(Boolean) },
      steps,
      response: this._buildMultiCommandResponse(steps),
      source
    };
    this.context.record(pending.originalInput || multi.confirmedInput || '', completed.entities, completed);
    return {
      ...completed,
      response: this.personality.applyToResponse(completed.response)
    };
  }

  _buildMultiCommandResponse(steps) {
    if (this.router && typeof this.router._buildMultiCommandResponse === 'function') {
      return this.router._buildMultiCommandResponse(steps);
    }
    const completed = steps.filter(step => step.success).length;
    const failed = steps.find(step => !step.success);
    return failed
      ? `${completed} command${completed === 1 ? '' : 's'} completed. ${failed.response || failed.error || 'One command failed.'}`
      : `Completed ${completed} command${completed === 1 ? '' : 's'}.`;
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
      if (!this._looksLikeChoiceResponse(normalized, pending.data?.choices || [])) {
        this.pendingClarification = null;
        return null;
      }
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

  _looksLikeChoiceResponse(input, choices) {
    const normalized = String(input || '').trim().toLowerCase();
    if (!normalized) return false;
    const list = Array.isArray(choices) ? choices : [];
    if (list.length === 0) return false;

    if (/^\d+$/.test(normalized)) return true;

    if (normalized.length > 0 && normalized.length < 50) {
      const match = list.find(choice => {
        const title = Normalizer.normalizeText(choice.title || '').toLowerCase();
        const choicePath = Normalizer.normalizeText(choice.path || '').toLowerCase();
        return title.includes(normalized) || normalized.includes(title) ||
          choicePath.includes(normalized) || normalized.includes(choicePath);
      });
      if (match) return true;
    }

    if (/^(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)$/i.test(normalized)) return true;

    return false;
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

    const repeatTarget = this._resolveRepeatRequest(normalized);
    if (repeatTarget) {
      return repeatTarget;
    }

    const yearFollowUp = normalized.match(/^(?:what\s+about|and|who\s+won\s+in)\s+((?:19|20)\d{2})$/);
    if (yearFollowUp?.[1]) {
      const lastSearch = this.context.getLastSearch();
      const query = String(lastSearch?.entities?.query || lastSearch?.data?.query || '').trim();
      if (query) {
        return /\bipl\b/i.test(query)
          ? `who won IPL in ${yearFollowUp[1]}`
          : `search for ${query} ${yearFollowUp[1]}`;
      }
    }

    if (/^what\s+about\s+the\s+year\s+before\s+that$/.test(normalized)) {
      const recentWithYear = this.context.findRecent(entry => /(?:19|20)\d{2}/.test(String(entry?.input || entry?.entities?.query || '')), 20);
      const year = String(recentWithYear?.input || recentWithYear?.entities?.query || '').match(/((?:19|20)\d{2})/)?.[1];
      const lastSearch = this.context.getLastSearch();
      const query = String(lastSearch?.entities?.query || lastSearch?.data?.query || '').trim();
      if (year && query) {
        const previousYear = Number(year) - 1;
        return /\bipl\b/i.test(query)
          ? `who won IPL in ${previousYear}`
          : `search for ${query} ${previousYear}`;
      }
    }

    const earlyLastFileEntry = this.context.getLastFileReference();
    const earlyLastFile = this.context.getFileReference(earlyLastFileEntry);
    if (/^(?:where\s+is\s+(?:it|that)\s+(?:located|saved)|where\s+did\s+i\s+save\s+(?:it|that))$/i.test(normalized)) {
      return earlyLastFile?.path || earlyLastFile?.name
        ? `what is the location of ${earlyLastFile.path || earlyLastFile.name}`
        : '';
    }

    if (/^open\s+(?:its|it|that|the)\s+folder$/i.test(normalized)) {
      if (earlyLastFile?.path) {
        const path = require('path');
        return `open ${path.dirname(earlyLastFile.path)}`;
      }
      return '';
    }

    const lastReference = this._getLastReferenceTarget();
    const lastFileEntry = this.context.getLastFileReference();
    const lastFile = this.context.getFileReference(lastFileEntry);

    if (/^(?:maxmize|maximize|minimize)\s+(?:it|that|this|current\s+one|current\s+app)$/i.test(normalized)) {
      const verb = /^minimize\b/i.test(normalized) ? 'minimize' : 'maximize';
      return lastReference ? `${verb} ${lastReference}` : '';
    }

    if (/^(?:close|quit|exit)\s+(?:it|that|this|current\s+one|current\s+app)$/i.test(normalized)) {
      return lastReference ? `close ${lastReference}` : '';
    }

    if (/^(?:open|reopen)\s+(?:it|that|that\s+one|this|this\s+one)(?:\s+again)?$/i.test(normalized)) {
      if (lastFile?.path || lastFile?.name) {
        return `open ${lastFile.path || lastFile.name}`;
      }
      return lastReference ? `open ${lastReference}` : '';
    }

    if (/^(?:where\s+is\s+(?:it|that)\s+(?:located|saved)|where\s+did\s+i\s+save\s+(?:it|that))$/i.test(normalized)) {
      return lastFile?.path || lastFile?.name
        ? `what is the location of ${lastFile.path || lastFile.name}`
        : '';
    }

    if (/^open\s+(?:its|it|that|the)\s+folder$/i.test(normalized)) {
      if (lastFile?.path) {
        const path = require('path');
        return `open ${path.dirname(lastFile.path)}`;
      }
      return '';
    }

    if (/^(?:what\s+is\s+)?(?:its|the)\s+file\s+name$/i.test(normalized)) {
      return '';
    }

    const knowledgeFollowUp = this._resolveKnowledgeFollowUp(normalized);
    if (knowledgeFollowUp) {
      return knowledgeFollowUp;
    }

    const listFollowUp = /^(?:list|show|tell|display|open)?\s*(?:them|those|these|it|that)(?:\s+again)?$/.test(normalized) ||
      /^(?:list|show|tell|display)\s+(?:them|those|these|it|that)\b/.test(normalized) ||
      /^(?:what|which)\s+(?:are|is)\s+(?:them|those|these|they|it|that)\b/.test(normalized);
    if (!listFollowUp) {
      return this._resolveVoiceReference(input);
    }

    const lastFileList = this.context.getHistory(8)
      .slice()
      .reverse()
      .find(entry => entry?.success && entry?.intent === 'file.list' && entry?.entities?.path);

    if (!lastFileList) {
      const lastFileSearch = this.context.getHistory(8)
        .slice()
        .reverse()
        .find(entry => entry?.success && /^(?:file\.search|file\.smartFind)$/.test(entry?.intent || '') && entry?.input);
      return lastFileSearch?.input || this._resolveVoiceReference(input);
    }

    const entities = lastFileList.entities || {};
    const type = String(entities.fileType || '').trim();
    const path = String(entities.path || '').trim();
    if (!path) {
      return this._resolveVoiceReference(input);
    }

    return `list ${type ? `${type} ` : ''}files in ${path}`;
  }

  _resolveKnowledgeFollowUp(normalized) {
    const topic = this._baseKnowledgeTopic(this._getLastKnowledgeTopic());
    if (!topic) {
      return '';
    }

    if (/^(?:can\s+you\s+)?(?:make\s+that|make\s+it|explain\s+it|explain\s+that)\s+(?:easier|simpler|simple|easy)(?:\s+to\s+understand)?$/.test(normalized) ||
      /^explain\s+it\s+like\s+i'?m\s+(?:a\s+)?beginner$/.test(normalized) ||
      /^explain\s+it\s+simply$/.test(normalized)) {
      return `search for ${topic} simple beginner explanation`;
    }

    if (/^(?:give\s+me\s+)?(?:a\s+)?real[-\s]?world\s+example$/.test(normalized) ||
      /^give\s+me\s+an?\s+example$/.test(normalized)) {
      return `search for ${topic} real world example`;
    }

    if (/^summarize\s+(?:that|it)(?:\s+in\s+one\s+minute)?$/.test(normalized) ||
      /^give\s+me\s+(?:a\s+)?summary$/.test(normalized)) {
      return `search for ${topic} one minute summary`;
    }

    if (/^(?:tell\s+me\s+more|more\s+details|go\s+deeper|continue\s+explaining)(?:\s+(?:about\s+)?(?:it|that|this))?$/.test(normalized)) {
      return `search for ${topic} detailed explanation`;
    }

    if (/^how\s+(?:does|do)\s+(?:it|that|this)\s+work\??$/.test(normalized)) {
      return `search for how ${topic} works`;
    }

    if (/^what\s+(?:is|are)\s+(?:its|their)\s+(?:uses?|benefits?|advantages?|examples?)\??$/.test(normalized)) {
      const aspect = normalized.match(/\b(uses?|benefits?|advantages?|examples?)\b/)?.[1] || 'uses';
      return `search for ${topic} ${aspect}`;
    }

    if (/^(?:why|where|when|who|what|how)\b.*\b(?:it|that|this)\b/.test(normalized)) {
      const rewritten = normalized
        .replace(/\b(?:it|that|this)\b/g, topic)
        .replace(/\s+/g, ' ')
        .trim();
      return `search for ${rewritten}`;
    }

    return '';
  }

  _getLastKnowledgeTopic() {
    const entry = this.context.getHistory(12)
      .slice()
      .reverse()
      .find(item => item?.success &&
        ['browser.search', 'browser.siteSearch', 'browser.openFirstResult'].includes(item.intent) &&
        (item.entities?.query || item.data?.query || item.input));
    const raw = String(entry?.entities?.query || entry?.data?.query || entry?.input || '').trim();
    const topic = this._cleanKnowledgeTopic(raw);
    if (topic) {
      return topic;
    }
    return this.context.getLastTopic()?.label || '';
  }

  _cleanKnowledgeTopic(value) {
    return Normalizer.normalizeText(String(value || '').trim())
      .replace(/^(?:search\s+for|search|google|look\s+up|find\s+information\s+about|find\s+information|can\s+you\s+find\s+information\s+about|explain|teach\s+me)\s+/i, '')
      .replace(/\b(?:in\s+simple\s+words?|simple\s+beginner\s+explanation|real[-\s]?world\s+example|one\s+minute\s+summary|simply|like\s+i'?m\s+(?:a\s+)?beginner|from\s+scratch|for\s+me)\b/gi, ' ')
      .replace(/[?.!]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _baseKnowledgeTopic(value) {
    return Normalizer.normalizeText(String(value || '').trim())
      .replace(/^how\s+(.+?)\s+works?$/i, '$1')
      .replace(/^what\s+is\s+(.+)$/i, '$1')
      .replace(/\b(?:uses?|benefits?|advantages?|examples?|detailed\s+explanation|one\s+minute\s+summary|simple\s+beginner\s+explanation)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _resolveRepeatRequest(normalized) {
    if (!/^(?:try\s+again|again|do\s+(?:that|it)\s+again|repeat(?:\s+(?:that|it|the\s+last\s+command))?|retry(?:\s+(?:that|it))?)$/.test(normalized)) {
      return '';
    }

    const recent = this.context.getHistory(12).slice().reverse();
    const failed = recent.find(entry => entry?.input && entry.success === false && entry.intent);
    const actionable = recent.find(entry => entry?.input && entry.intent && /^(?:app|file|folder|browser|media|message|email|call|mode|window|system\.(?:bluetooth|screenshot|processes|time|date|calculate))\b/.test(entry.intent));
    const target = failed || actionable;
    return target?.input || '';
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
    if (!/\b(?:it|that|same|current\s+one|current\s+app)\b/.test(normalized)) {
      return text;
    }

    const target = this._getLastReferenceTarget();
    if (!target) {
      return text;
    }

    return normalized
      .replace(/\b(?:it|that|same|current\s+one|current\s+app)\b/g, target)
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
      'queryApp',
      'contactName'
    ];

    for (const entry of history) {
      if (entry?.requiresConfirmation || entry?.needsClarification) {
        continue;
      }
      const entities = entry?.entities || {};
      for (const key of keys) {
        const value = String(entities[key] || '').trim();
        if (value) {
          return value.toLowerCase();
        }
      }

      const file = this.context.getFileReference(entry);
      if (file?.name) {
        return file.name.toLowerCase();
      }
    }

    return '';
  }

  _rememberCurrentChatRequest(input, source) {
    const normalized = Normalizer.normalizeText(String(input || '').trim());
    if (!/^(?:remember|save|store|keep)\s+(?:this\s+)?(?:chat|conversation|discussion)\b/.test(normalized)) {
      return null;
    }

    const digest = this.context.buildConversationDigest({ limit: 12 });
    if (!digest.summaryText) {
      return {
        success: false,
        learned: false,
        intent: 'assistant.memory',
        entities: { fact: 'last_conversation_summary' },
        data: { type: 'conversation-summary', known: false },
        source,
        response: this.personality.applyToResponse('I do not have enough chat history to remember yet.')
      };
    }

    const fact = this.learning.rememberUserFact('last_conversation_summary', digest.summaryText, {
      source: 'explicit-chat-memory',
      confidence: 0.9
    });

    return {
      success: Boolean(fact),
      learned: Boolean(fact),
      intent: 'assistant.memory',
      entities: { fact: 'last_conversation_summary' },
      data: { type: 'conversation-summary', summary: digest.summaryText },
      source,
      response: this.personality.applyToResponse('I will remember this chat summary.')
    };
  }
}

module.exports = Assistant;
