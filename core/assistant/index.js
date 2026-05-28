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
    this.automation = dependencies.automation || new AutomationEngine(config);
    this.router = dependencies.router || new ActionRouter(config, this.automation);
    this.context = new ContextManager(config);
    this.personality = new Personality(config);
    this.responses = new ResponseGenerator(config);
    this.isProcessing = false;
    this.pendingConfirmation = null;
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

      const result = await this.router.process(input, source);
      this.context.record(input, {}, result);

      let response = result.response || '';
      response = this.personality.applyToResponse(response);

      if (result.requiresConfirmation) {
        this.pendingConfirmation = {
          commandId: result.commandId,
          intentId: result.intent,
          entities: { ...(result.entities || {}) },
          source
        };
      } else if (result.success) {
        this.pendingConfirmation = null;
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
      recentCommands: this.context.getRecentCommands(),
      conversation: this.context.getConversationSummary()
    };
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
      const candidate = String(prepared?.correctedText || prepared?.normalizedText || '').trim();
      return candidate || raw;
    } catch (error) {
      this.logger.warn('Voice NLP preparation failed', error.message);
      return raw;
    }
  }
}

module.exports = Assistant;
