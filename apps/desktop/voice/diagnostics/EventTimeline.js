'use strict';

const { sanitizeMetadata } = require('./privacy');

/**
 * Purpose: Maintains ordered local Voice event timelines.
 * Responsibility: Record sanitized timestamped events by session.
 * Dependencies: Privacy sanitizer.
 * Lifecycle: DiagnosticsManager appends to it as observed events arrive.
 * Future extension notes: Do not store raw transcripts or audio payloads here.
 */
class EventTimeline {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date());
    this.events = [];
  }

  add(eventName, payload = {}) {
    const event = Object.freeze({
      eventName: String(eventName || 'voice.event'),
      sessionId: payload.session?.sessionId || payload.sessionId || null,
      timestamp: payload.at || this.clock().toISOString(),
      metadata: sanitizeMetadata(payload)
    });
    this.events.push(event);
    return event;
  }

  list(options = {}) {
    const sessionId = options.sessionId || null;
    const limit = Math.max(0, Number(options.limit) || 100);
    const events = sessionId
      ? this.events.filter(event => event.sessionId === sessionId)
      : this.events;
    return events.slice(-limit);
  }

  clear() {
    this.events = [];
    return { cleared: true };
  }
}

module.exports = EventTimeline;
