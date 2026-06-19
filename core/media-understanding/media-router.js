'use strict';

const Logger = require('../shared/index').Logger;
const { MediaParser } = require('./parser');

const EXECUTABLE_CONFIDENCE = 0.58;

class MediaUnderstandingRouter {
  constructor(options = {}) {
    this.logger = options.logger || new Logger(options.logging || { level: 'info' });
    this.parser = options.parser || new MediaParser(options);
    this.contextProvider = options.contextProvider || null;
  }

  parse(input, context = {}) {
    return this.parser.parse(input, context);
  }

  route(input, options = {}) {
    const source = options.source || 'voice-command';
    const context = {
      ...this._getContext(),
      ...(options.context || {}),
      source
    };
    const parsed = this.parser.parse(input, context);

    if (!parsed.intent || parsed.confidence < EXECUTABLE_CONFIDENCE) {
      return {
        success: false,
        parsed,
        reason: parsed.intent ? 'low-confidence' : 'not-media'
      };
    }

    const payload = this._payloadFor(parsed, source);
    this.logger.info(`[Media] Routed -> ${payload.action}`);
    return {
      success: true,
      parsed,
      payload
    };
  }

  _payloadFor(parsed, source) {
    const payload = {
      action: parsed.intent,
      platform: parsed.platform,
      query: parsed.query,
      source,
      confidence: parsed.confidence
    };

    if (parsed.intent === 'media.play' || parsed.intent === 'media.search') {
      payload.mediaQuery = parsed.query;
      payload.mediaPlatform = parsed.platform;
      payload.genre = parsed.genre;
    }

    return payload;
  }

  _getContext() {
    if (!this.contextProvider) {
      return {};
    }

    try {
      if (typeof this.contextProvider === 'function') {
        return this.contextProvider() || {};
      }
      if (typeof this.contextProvider.getSnapshot === 'function') {
        return this.contextProvider.getSnapshot() || {};
      }
    } catch (err) {
      this.logger.warn('[Media] Context read failed', err.message);
    }

    return {};
  }
}

module.exports = {
  MediaUnderstandingRouter,
  EXECUTABLE_CONFIDENCE
};
