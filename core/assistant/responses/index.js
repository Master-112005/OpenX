const path = require('path');
const { applyFormalAddress } = require('./style');

function hashSeed(value) {
  const source = String(value || '');
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function chooseVariant(seed, variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return '';
  }

  return variants[hashSeed(seed) % variants.length];
}

function valueFromContext(context, key, fallback = '') {
  if (!context) return fallback;
  if (context.result?.data && context.result.data[key] !== undefined) return context.result.data[key];
  if (context.entities && context.entities[key] !== undefined) return context.entities[key];
  if (context[key] !== undefined) return context[key];
  return fallback;
}

function basenameOrValue(input) {
  if (!input || typeof input !== 'string') return '';
  return path.basename(input);
}

function pathLabel(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';

  const normalized = filePath.toLowerCase();
  if (normalized.includes('\\desktop\\')) return 'Desktop';
  if (normalized.includes('\\documents\\')) return 'Documents';
  if (normalized.includes('\\downloads\\')) return 'Downloads';
  if (normalized.includes('\\pictures\\')) return 'Pictures';
  if (normalized.includes('\\music\\')) return 'Music';
  if (normalized.includes('\\videos\\')) return 'Videos';
  return path.dirname(filePath);
}

function humanizeError(error) {
  const message = String(error || '').trim();
  if (!message) {
    return 'Something went wrong while carrying out that request';
  }

  const lowered = message.toLowerCase();
  if (lowered.includes('file not found')) return 'Unable to find that file';
  if (lowered.includes('folder not found')) return 'Unable to find that folder';
  if (lowered.includes('source not found')) return 'Unable to find the source item';
  if (lowered.includes('destination could not be resolved')) return 'Unable to determine the destination for that move or copy operation';
  if (lowered.includes('permission')) return 'I do not have permission to complete that action';
  if (lowered.includes('invalid filename')) return 'That filename is not valid on this system';
  if (lowered.includes('invalid folder name')) return 'That folder name is not valid on this system';
  if (lowered.includes('already exists')) return 'That item already exists';
  if (lowered.includes('not supported')) return 'That action is not supported on this device';
  if (lowered.includes('unknown action')) return 'I recognised the request, but the action is not wired into the assistant yet';
  if (lowered.includes('invalid timer duration')) return 'I need a valid timer duration';
  if (lowered.includes('invalid alarm time')) return 'I could not understand the alarm time';
  if (lowered.includes('invalid reminder time')) return 'I could not understand when you want the reminder';
  if (lowered.includes('reminder text is required')) return 'I need to know what you want to be reminded about';
  if (lowered.includes('could not schedule')) return 'I could not schedule that right now';
  if (lowered.includes('contact not found')) return 'I could not find that contact in the assistant contact book';
  if (lowered.includes('contact does not have a phone number')) return 'That contact does not have a phone number saved';
  if (lowered.includes('messaging platform not supported')) return 'That messaging platform is not supported yet';
  if (lowered.includes('direct whatsapp calling is not supported')) return 'Direct WhatsApp calling is not available through this assistant yet';
  if (lowered.includes('whatsapp desktop automation failed')) return 'I could not complete the WhatsApp desktop action';
  if (lowered.includes('call state could not be confirmed')) return 'I opened the WhatsApp chat, but I could not confirm that the voice call started';
  if (lowered.includes('no message text provided')) return 'I need the message text before I can prepare that message';
  if (lowered.includes('no contact name provided')) return 'I need the contact name before I can continue';
  if (lowered.includes('window not found')) return 'I could not find that window on the desktop';
  if (lowered.includes('no active window')) return 'There is no active desktop window for me to control right now';
  if (lowered.includes('unable to reuse')) return 'I found the player window, but I could not hand playback over to it';
  if (lowered.includes('failed to open')) return 'I could not open that request successfully';

  return message.charAt(0).toUpperCase() + message.slice(1);
}

const RESPONSE_BUILDERS = {
  success: {
    'volume.up': context => `I have successfully increased the system volume to ${valueFromContext(context, 'value')}%`,
    'volume.down': context => `I have successfully decreased the system volume to ${valueFromContext(context, 'value')}%`,
    'volume.set': context => `The system volume has been successfully adjusted to ${valueFromContext(context, 'value')}%`,
    'volume.get': context => `The current system volume is active at ${valueFromContext(context, 'value')}%`,
    'brightness.up': context => `I have successfully increased the screen brightness to ${valueFromContext(context, 'value')}%`,
    'brightness.down': context => `I have successfully decreased the screen brightness to ${valueFromContext(context, 'value')}%`,
    'brightness.set': context => `The screen brightness has been successfully adjusted to ${valueFromContext(context, 'value')}%`,
    'brightness.get': context => `The current screen brightness is set to ${valueFromContext(context, 'value')}%`,
    'volume.mute': () => 'The system audio has been successfully muted',
    'volume.unmute': context => `The system audio has been unmuted and restored to ${valueFromContext(context, 'value', 50)}%`,
    'app.open': context => {
      const name = valueFromContext(context, 'appName');
      return chooseVariant(`app.open:${name}`, [
        `${name} is open`,
        `Opening ${name} now`
      ]);
    },
    'app.close': context => `I have successfully terminated and closed the ${valueFromContext(context, 'appName')} application`,
    'app.switch': context => `I have successfully switched focus to the ${valueFromContext(context, 'appName')} application`,
    'file.create': context => {
      const filePath = valueFromContext(context, 'path', valueFromContext(context, 'filename'));
      const fileName = valueFromContext(context, 'filename', basenameOrValue(filePath));
      const location = pathLabel(filePath);
      return location
        ? `I have successfully created the file ${fileName} in your ${location} directory`
        : `I have successfully created the file ${fileName}`;
    },
    'file.open': context => `I have successfully opened the file ${valueFromContext(context, 'filename', basenameOrValue(valueFromContext(context, 'path')))}`,
    'file.delete': context => `I have successfully deleted the specified file, ${valueFromContext(context, 'filename')}`,
    'file.rename': context => 'I have successfully renamed the file as requested',
    'file.copy': context => `I have successfully copied ${basenameOrValue(valueFromContext(context, 'source'))} to the target destination`,
    'file.move': context => `I have successfully moved ${basenameOrValue(valueFromContext(context, 'source'))} to the target destination`,
    'file.search': context => {
      const count = valueFromContext(context, 'count', context.result?.data?.count || 0);
      return count === 0
        ? 'I could not find any matching files in the specified location'
        : `I have successfully located ${count} matching ${count === 1 ? 'file' : 'files'} as requested`;
    },
    'folder.create': context => {
      const folderPath = valueFromContext(context, 'path');
      const folderName = valueFromContext(context, 'folderName', basenameOrValue(folderPath));
      const location = pathLabel(folderPath);
      return location
        ? `I have successfully created the ${folderName} folder in your ${location} directory`
        : `I have successfully created the ${folderName} folder`;
    },
    'folder.delete': context => `I have successfully deleted the ${valueFromContext(context, 'folderName')} folder and all of its contents`,
    'folder.move': context => `I have successfully moved the ${basenameOrValue(valueFromContext(context, 'source'))} folder to the new location`,
    'folder.open': context => `I have successfully opened the ${valueFromContext(context, 'folderName')} folder in file explorer`,
    'browser.open': context => `I opened ${valueFromContext(context, 'url')} in your browser`,
    'browser.search': context => `I searched the web for ${valueFromContext(context, 'query')}`,
    'media.play': context => {
      const query = valueFromContext(context, 'query', valueFromContext(context, 'mediaQuery', ''));
      const rawPlatform = valueFromContext(context, 'platform', valueFromContext(context, 'mediaPlatform', 'YouTube'));
      const appName = valueFromContext(context, 'appName', rawPlatform);
      const displayName = String(appName).charAt(0).toUpperCase() + String(appName).slice(1);
      const method = valueFromContext(context, 'launchMethod', 'browser');
      const replacedExisting = Boolean(valueFromContext(context, 'replacedExisting', false));
      if (method === 'existing-window') {
        return replacedExisting
          ? `I replaced the current playback with "${query}" on ${displayName}`
          : `I switched the current ${displayName} session to "${query}"`;
      }
      if (method === 'browser') {
        return `I opened ${displayName} for "${query}" in the browser`;
      }
      return `Now playing "${query}" on ${displayName}`;
    },
    'media.next': () => 'Skipped to the next track',
    'media.previous': () => 'Moved back to the previous track',
    'media.pause': () => 'Playback is paused',
    'media.resume': () => 'Playback has resumed',
    'message.send': context => {
      const contactName = valueFromContext(context, 'contactName');
      const platform = valueFromContext(context, 'platform', 'message');
      const delivery = valueFromContext(context, 'delivery');
      if (platform === 'whatsapp') {
        if (delivery === 'sent') {
          return `I have successfully dispatched the WhatsApp message to ${contactName}`;
        }
        return `I have prepared the WhatsApp message for ${contactName} as requested. Please review it on your screen before sending`;
      }
      return `I have prepared the message for ${contactName} and it is ready for your review`;
    },
    'call.start': context => {
      const contactName = valueFromContext(context, 'contactName');
      const platform = valueFromContext(context, 'platform', 'phone');
      return platform === 'whatsapp'
        ? `I have successfully initiated a WhatsApp voice call to ${contactName}`
        : `I have successfully placed a direct voice call to ${contactName}`;
    },
    'timer.set': context => `I have successfully established a timer for ${valueFromContext(context, 'duration')} minute${valueFromContext(context, 'duration') === 1 ? '' : 's'}`,
    'alarm.set': context => `I have successfully scheduled an alarm for ${valueFromContext(context, 'timeExpression')}`,
    'reminder.set': context => `I have successfully configured a reminder to ${valueFromContext(context, 'reminderText')}`,
    'system.shutdown': () => 'I am now initiating a complete system shutdown',
    'system.restart': () => 'I am now initiating a system restart',
    'system.sleep': () => 'I am now placing the system into low-power sleep mode',
    'system.lock': () => 'I have successfully secured and locked the computer console',
    'system.status': context => `The current system health is excellent. The active processor utilization stands at ${valueFromContext(context, 'cpu')}% and system memory utilization is at ${valueFromContext(context, 'ram')}%`,
    'system.cpu': context => `The current CPU utilization is recorded at ${valueFromContext(context, 'cpu')}%`,
    'system.memory': context => `System memory utilization is currently at ${valueFromContext(context, 'ram')}%, representing ${valueFromContext(context, 'used')} gigabytes in active use out of ${valueFromContext(context, 'total')} gigabytes total capacity`,
    'system.battery': context => `The active power reservoir status indicates a battery level of ${valueFromContext(context, 'battery')}%`,
    'system.disk': context => `The storage volume labeled ${valueFromContext(context, 'label')} reports ${valueFromContext(context, 'free')} gigabytes of available free space out of a total capacity of ${valueFromContext(context, 'total')} gigabytes`,
    'system.processes': context => `There are currently ${valueFromContext(context, 'count')} active system processes executing on the machine`,
    'window.minimize': context => `I minimized ${valueFromContext(context, 'matchedWindow', 'the requested window')}`,
    'window.maximize': context => `I maximized ${valueFromContext(context, 'matchedWindow', 'the requested window')}`,
    'window.close': context => `I closed ${valueFromContext(context, 'matchedWindow', 'the requested window')}`,
    'help': () => 'I can manage apps, files, folders, playback, system settings, web searches, messages, and reminders. Tell me what you want done',
    'greeting': () => chooseVariant('greeting', [
      'At your service',
      'Please tell me what you need'
    ]),
    'thanks': () => chooseVariant('thanks', [
      'You are welcome',
      'Always at your service'
    ]),
    default: () => 'The requested operation has completed successfully'
  },

  error: {
    unknownCommand: context => {
      const suggestions = Array.isArray(context?.suggestions) ? context.suggestions.filter(Boolean) : [];
      if (suggestions.length > 0) {
        return `I could not fully understand that request. You can rephrase it, or try one of these commands: ${suggestions.join(', ')}`;
      }
      return 'I could not understand that request. Please rephrase it or ask for help';
    },
    executionFailed: context => humanizeError(context?.error),
    permissionDenied: () => 'I do not have permission to do that',
    missingEntities: context => {
      const names = valueFromContext(context, 'names', context?.entities?.names || 'details');
      return `I need a little more information to do that. Please specify: ${names}`;
    },
    noCommand: () => 'I am ready for your next instruction',
    notFound: () => 'I was unable to locate the item or resource you requested',
    timeout: () => 'The requested operation has timed out because it exceeded the allocated execution threshold',
    default: context => humanizeError(context?.error)
  },

  confirmation: {
    confirmAction: context => `Please confirm that I should proceed with: ${valueFromContext(context, 'action')}`,
    confirmDelete: context => `I require your authorization before deleting. This operation will permanently remove ${valueFromContext(context, 'count')} item${valueFromContext(context, 'count') === 1 ? '' : 's'}. Do you authorize this deletion?`,
    confirmShutdown: () => 'Please confirm that you authorize the system to initiate a complete shutdown',
    confirmRestart: () => 'Please confirm that you authorize the system to initiate a reboot',
    default: () => 'I require your explicit confirmation before proceeding with this operation'
  },

  info: {
    listening: () => 'Listening',
    processing: () => 'Working on that now',
    idle: () => 'Awaiting your next command',
    wakeWord: () => 'Yes, sir. I am at your service',
    default: () => ''
  }
};

class ResponseGenerator {
  constructor(config) {
    this.config = config;
  }

  generate(type, templateId, context) {
    const bucket = RESPONSE_BUILDERS[type] || RESPONSE_BUILDERS.info;
    const builder = bucket[templateId] || bucket.default || RESPONSE_BUILDERS.info.default;

    if (typeof builder === 'function') {
      return this._polish(builder(context || {}));
    }

    if (typeof builder === 'string') {
      return this._polish(this._interpolateString(builder, context || {}));
    }

    return '';
  }

  _interpolateString(template, context) {
    let result = String(template || '');
    const sources = [context.entities, context.result?.data, context];

    sources.forEach(source => {
      if (!source || typeof source !== 'object') return;

      Object.entries(source).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value ?? '');
      });
    });

    return result;
  }

  _polish(text) {
    const result = String(text || '').replace(/\s+/g, ' ').trim();
    if (!result) return '';
    return applyFormalAddress(result, this.config);
  }

  getTemplate(type, templateId) {
    return RESPONSE_BUILDERS[type]?.[templateId] || null;
  }

  addTemplate(type, templateId, template) {
    if (!RESPONSE_BUILDERS[type]) {
      RESPONSE_BUILDERS[type] = {};
    }
    RESPONSE_BUILDERS[type][templateId] = template;
  }

  static getTemplates() {
    return RESPONSE_BUILDERS;
  }
}

module.exports = ResponseGenerator;
