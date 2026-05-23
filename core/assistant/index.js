const EventEmitter = require('events');
const {
  AssistantEventBus,
  EVENTS,
  Logger
} = require('../shared/index');
const ActionRouter = require('./router/index');
const AutomationEngine = require('../automation/index');
const ContextManager = require('./context/index');
const Personality = require('./personality/index');
const ResponseGenerator = require('./responses/index');

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
      const result = await this.router.process(input, source);
      this.context.record(input, {}, result);

      let response = result.response || '';
      response = this.personality.applyToResponse(response);

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
    return this.processCommand(text, 'voice');
  }

  async confirmAction(commandId, intentId, entities) {
    const result = await this.router.confirmAndExecute(commandId, intentId, entities);
    return {
      ...result,
      response: this.personality.applyToResponse(result.response || '')
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
      recentCommands: this.context.getRecentCommands(),
      conversation: this.context.getConversationSummary()
    };
  }
}

module.exports = Assistant;
