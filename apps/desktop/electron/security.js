const path = require('path');
const { fileURLToPath } = require('url');

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ALLOWED_COMMAND_SOURCES = new Set(['chat', 'voice']);
const PHONE_PERMISSION_NAMES = new Set([
  'remoteCommands', 'fileTransfer', 'receiveFiles', 'sendFiles', 'powerActions'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, name = 'payload') {
  if (!isPlainObject(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function requireString(value, name, options = {}) {
  const maxLength = options.maxLength || 5000;
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (!options.allowEmpty && !normalized) {
    throw new TypeError(`${name} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new RangeError(`${name} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function validateJsonValue(value, name, state = { seen: new Set(), nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 2000 || depth > 12) {
    throw new RangeError(`${name} is too complex`);
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') {
    throw new TypeError(`${name} contains an unsupported value`);
  }
  if (state.seen.has(value)) {
    throw new TypeError(`${name} must not contain circular references`);
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 500) throw new RangeError(`${name} contains too many items`);
    value.forEach((item, index) => validateJsonValue(item, `${name}[${index}]`, state, depth + 1));
  } else {
    requirePlainObject(value, name);
    const entries = Object.entries(value);
    if (entries.length > 200) throw new RangeError(`${name} contains too many fields`);
    for (const [key, child] of entries) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) {
        throw new TypeError(`${name} contains a forbidden field`);
      }
      validateJsonValue(child, `${name}.${key}`, state, depth + 1);
    }
  }
  state.seen.delete(value);
}

function validateStructuredPayload(value, name, maxBytes) {
  requirePlainObject(value, name);
  validateJsonValue(value, name);
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > maxBytes) throw new RangeError(`${name} exceeds ${maxBytes} bytes`);
  return value;
}

function validateCommand(payload) {
  requirePlainObject(payload);
  const input = requireString(payload.input, 'input', { maxLength: 5000 });
  const source = payload.source === undefined
    ? 'chat'
    : requireString(payload.source, 'source', { maxLength: 20 });
  if (!ALLOWED_COMMAND_SOURCES.has(source)) throw new TypeError('source is not supported');
  return { input, source };
}

function validateConfirmation(payload) {
  requirePlainObject(payload);
  const commandId = requireString(payload.commandId, 'commandId', { maxLength: 128 });
  const intentId = requireString(payload.intentId, 'intentId', { maxLength: 128 });
  const entities = payload.entities === undefined
    ? {}
    : validateStructuredPayload(payload.entities, 'entities', 64 * 1024);
  return { commandId, intentId, entities };
}

function validateSpeech(payload) {
  requirePlainObject(payload);
  return { text: requireString(payload.text, 'text', { maxLength: 4000 }) };
}

function validateSettings(payload) {
  return validateStructuredPayload(payload, 'settings', 256 * 1024);
}

function validateScheduleAction(payload) {
  requirePlainObject(payload);
  const id = requireString(payload.id, 'id', { maxLength: 200 });
  const action = requireString(payload.action, 'action', { maxLength: 20 });
  if (!['snooze', 'stop'].includes(action)) throw new TypeError('schedule action is not supported');
  const minutes = Math.max(1, Math.min(60, Number(payload.minutes) || 5));
  return { id, action, minutes };
}

function validatePhoneDevice(payload) {
  requirePlainObject(payload);
  const deviceId = requireString(payload.deviceId, 'deviceId', { maxLength: 128 });
  if (!/^[A-Za-z0-9._-]+$/.test(deviceId)) throw new TypeError('deviceId is invalid');
  return { deviceId };
}

function validatePhonePermissions(payload) {
  const { deviceId } = validatePhoneDevice(payload);
  const permissions = requirePlainObject(payload.permissions, 'permissions');
  const entries = Object.entries(permissions);
  if (entries.length === 0) throw new TypeError('permissions must not be empty');
  const normalized = {};
  for (const [name, value] of entries) {
    if (!PHONE_PERMISSION_NAMES.has(name) || typeof value !== 'boolean') {
      throw new TypeError('permissions are invalid');
    }
    normalized[name] = value;
  }
  return { deviceId, permissions: normalized };
}

function validateEmpty(payload) {
  if (payload !== undefined) throw new TypeError('This channel does not accept a payload');
  return undefined;
}

const IPC_VALIDATORS = Object.freeze({
  'command:process': validateCommand,
  'command:confirm': validateConfirmation,
  'assistant:status': validateEmpty,
  'tts:speak': validateSpeech,
  'tts:stop': validateEmpty,
  'window:openChat': validateEmpty,
  'window:openSettings': validateEmpty,
  'config:get': validateEmpty,
  'settings:get': validateEmpty,
  'phone:pairingQR:create': validateEmpty,
  'phone:server:status': validateEmpty,
  'phone:devices:list': validateEmpty,
  'phone:device:permissions:update': validatePhonePermissions,
  'phone:device:remove': validatePhoneDevice,
  'phone:device:disconnect': validatePhoneDevice,
  'settings:save': validateSettings,
  'settings:reset': validateEmpty,
  'schedule:alertAction': validateScheduleAction,
  'app:quit': validateEmpty
});

function isTrustedRendererUrl(url, rendererRoot) {
  if (typeof url !== 'string' || !url || !rendererRoot) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const filePath = path.resolve(fileURLToPath(parsed));
    const trustedRoot = path.resolve(rendererRoot);
    const relative = path.relative(trustedRoot, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch (_) {
    return false;
  }
}

function getIpcSenderUrl(event) {
  return event?.senderFrame?.url || event?.sender?.getURL?.() || '';
}

function assertTrustedIpcSender(event, rendererRoot) {
  const senderUrl = getIpcSenderUrl(event);
  if (!isTrustedRendererUrl(senderUrl, rendererRoot)) {
    throw new Error('IPC sender is not a trusted local renderer');
  }
  return senderUrl;
}

function createSecureWebPreferences(preloadPath) {
  return Object.freeze({
    preload: preloadPath,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    backgroundThrottling: false,
    allowRunningInsecureContent: false,
    enableRemoteModule: false,
    webviewTag: false,
    spellcheck: false
  });
}

module.exports = {
  IPC_VALIDATORS,
  assertTrustedIpcSender,
  createSecureWebPreferences,
  getIpcSenderUrl,
  isPlainObject,
  isTrustedRendererUrl,
  validateJsonValue
};
