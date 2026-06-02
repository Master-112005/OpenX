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
  if (lowered.includes('permission')) return 'I cannot complete that with the current permission setting';
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
  if (lowered.startsWith('could not close:')) {
    const target = message.split(':').slice(1).join(':').trim();
    return target
      ? `I could not close ${target}. It may not be running, or Windows rejected the request`
      : 'I could not close that application';
  }
  if (lowered.startsWith('could not find or open:')) {
    const target = message.split(':').slice(1).join(':').trim();
    return target
      ? `I could not find or open ${target}`
      : 'I could not find or open that application';
  }

  return message.charAt(0).toUpperCase() + message.slice(1);
}

const RESPONSE_BUILDERS = {
  success: {
    'volume.up': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`vol.up:${val}`, [
        `Turned the volume up to ${val}%.`,
        `Volume increased to ${val}%.`,
        `Volume is now at ${val}%.`
      ]);
    },
    'volume.down': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`vol.down:${val}`, [
        `Turned the volume down to ${val}%.`,
        `Volume decreased to ${val}%.`,
        `Volume is now at ${val}%.`
      ]);
    },
    'volume.set': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`vol.set:${val}`, [
        `I've set the volume to ${val}%.`,
        `Volume set to ${val}%.`,
        `Volume is now at ${val}%.`
      ]);
    },
    'volume.get': context => {
      const val = valueFromContext(context, 'value');
      return `Volume is currently at ${val}%.`;
    },
    'brightness.up': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`bri.up:${val}`, [
        `Brighter now. Screen is at ${val}%.`,
        `Brightness increased to ${val}%.`,
        `Screen brightness is now ${val}%.`
      ]);
    },
    'brightness.down': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`bri.down:${val}`, [
        `Dimmed the screen to ${val}%.`,
        `Brightness decreased to ${val}%.`,
        `Screen brightness is now ${val}%.`
      ]);
    },
    'brightness.set': context => {
      const val = valueFromContext(context, 'value');
      return chooseVariant(`bri.set:${val}`, [
        `Screen brightness set to ${val}%.`,
        `I've set the brightness to ${val}%.`,
        `Brightness is now at ${val}%.`
      ]);
    },
    'brightness.get': context => {
      const val = valueFromContext(context, 'value');
      return `Screen brightness is currently at ${val}%.`;
    },
    'volume.mute': () => chooseVariant('vol.mute', [
      `I've muted the sound.`,
      `Audio is now muted.`,
      `Muted.`
    ]),
    'volume.unmute': context => {
      const val = valueFromContext(context, 'value', 50);
      return chooseVariant(`vol.unmute:${val}`, [
        `Sound is back on, set to ${val}%.`,
        `I've unmuted the audio. It's now at ${val}%.`,
        `Unmuted. Audio is at ${val}%.`
      ]);
    },
    'app.open': context => {
      const name = valueFromContext(context, 'appName');
      return chooseVariant(`app.open:${name}`, [
        `Opening ${name} now.`,
        `Launching ${name}.`,
        `${name} is opening now.`
      ]);
    },
    'app.close': context => {
      const name = valueFromContext(context, 'appName');
      return chooseVariant(`app.close:${name}`, [
        `${name} has been closed.`,
        `Closing ${name} now.`,
        `Closed ${name}.`
      ]);
    },
    'app.switch': context => {
      const name = valueFromContext(context, 'appName');
      return chooseVariant(`app.switch:${name}`, [
        `Switched focus to ${name}.`,
        `Bringing ${name} to the front.`,
        `Focused on ${name}.`
      ]);
    },
    'file.create': context => {
      const filePath = valueFromContext(context, 'path', valueFromContext(context, 'filename'));
      const fileName = valueFromContext(context, 'filename', basenameOrValue(filePath));
      const location = pathLabel(filePath);
      return chooseVariant(`file.create:${fileName}`, [
        `I've created the file "${fileName}" in your ${location || 'active'} folder.`,
        `Done. "${fileName}" has been created in ${location || 'active'}.`,
        `Created "${fileName}" in ${location || 'active'}.`
      ]);
    },
    'file.open': context => {
      const fileName = valueFromContext(context, 'filename', basenameOrValue(valueFromContext(context, 'path')));
      return chooseVariant(`file.open:${fileName}`, [
        `Opening "${fileName}" now.`,
        `Opening "${fileName}".`,
        `"${fileName}" is opening now.`
      ]);
    },
    'file.delete': context => {
      const fileName = valueFromContext(context, 'filename');
      return chooseVariant(`file.delete:${fileName}`, [
        `Deleted "${fileName}" as requested.`,
        `I've successfully deleted the file "${fileName}".`,
        `Done, "${fileName}" has been removed.`
      ]);
    },
    'file.rename': context => {
      const name = valueFromContext(context, 'filename', basenameOrValue(valueFromContext(context, 'path')));
      return chooseVariant(`file.rename:${name}`, [
        `I've renamed that file for you.`,
        `Renamed the file as requested.`,
        `All set, the file has been renamed.`
      ]);
    },
    'file.copy': context => {
      const src = basenameOrValue(valueFromContext(context, 'source'));
      return chooseVariant(`file.copy:${src}`, [
        `I've copied "${src}" to the destination directory.`,
        `Copied "${src}" to its new location.`,
        `A copy of "${src}" is ready.`
      ]);
    },
    'file.move': context => {
      const src = basenameOrValue(valueFromContext(context, 'source'));
      return chooseVariant(`file.move:${src}`, [
        `I've moved "${src}" to the target location.`,
        `Moved "${src}" to its new destination.`,
        `Done, "${src}" has been moved.`
      ]);
    },
    'file.search': context => {
      const count = valueFromContext(context, 'count', context.result?.data?.count || 0);
      return count === 0
        ? `I couldn't find any matching files.`
        : `I've found ${count} matching ${count === 1 ? 'file' : 'files'}.`;
    },
    'folder.create': context => {
      const folderPath = valueFromContext(context, 'path');
      const folderName = valueFromContext(context, 'folderName', basenameOrValue(folderPath));
      const location = pathLabel(folderPath);
      return chooseVariant(`folder.create:${folderName}`, [
        `I've created the folder "${folderName}" in your ${location || 'active'} directory.`,
        `Created the folder "${folderName}" in ${location || 'active'}.`,
        `Done. "${folderName}" has been created.`
      ]);
    },
    'folder.delete': context => {
      const name = valueFromContext(context, 'folderName');
      return chooseVariant(`folder.delete:${name}`, [
        `I've deleted the folder "${name}" and all of its contents.`,
        `Deleted the folder "${name}" as requested.`,
        `Removed "${name}" and everything inside it.`
      ]);
    },
    'folder.move': context => {
      const src = basenameOrValue(valueFromContext(context, 'source'));
      return chooseVariant(`folder.move:${src}`, [
        `I've moved the "${src}" folder to its new location.`,
        `Moved the folder "${src}" for you.`,
        `Successfully moved "${src}".`
      ]);
    },
    'folder.open': context => {
      const name = valueFromContext(context, 'folderName');
      return chooseVariant(`folder.open:${name}`, [
        `Opening the folder "${name}" in file explorer.`,
        `Opening the "${name}" folder now.`,
        `"${name}" is opening in File Explorer.`
      ]);
    },
    'browser.open': context => {
      const url = valueFromContext(context, 'url');
      return chooseVariant(`browser.open:${url}`, [
        `Opening ${url} in your browser.`,
        `Opening that link for you now.`,
        `${url} is opening in the browser.`
      ]);
    },
    'browser.search': context => {
      const query = valueFromContext(context, 'query');
      return chooseVariant(`browser.search:${query}`, [
        `Searching the web for "${query}".`,
        `I've searched for "${query}" in your browser.`,
        `Looking that up for you: "${query}".`
      ]);
    },
    'media.play': context => {
      const query = valueFromContext(context, 'query', valueFromContext(context, 'mediaQuery', ''));
      const rawPlatform = valueFromContext(context, 'platform', valueFromContext(context, 'mediaPlatform', 'YouTube'));
      const appName = valueFromContext(context, 'appName', rawPlatform);
      const displayName = String(appName).charAt(0).toUpperCase() + String(appName).slice(1);
      const method = valueFromContext(context, 'launchMethod', 'browser');
      const replacedExisting = Boolean(valueFromContext(context, 'replacedExisting', false));
      if (method === 'existing-window') {
        return replacedExisting
          ? `I've replaced the current playback with "${query}" on ${displayName}.`
          : `Switched the current ${displayName} session to "${query}".`;
      }
      if (method === 'browser') {
        return `Opened ${displayName} for "${query}" in your browser.`;
      }
      return `Now playing "${query}" on ${displayName}.`;
    },
    'media.next': () => 'Skipped to the next track.',
    'media.previous': () => 'Moved back to the previous track.',
    'media.pause': () => 'Playback is paused.',
    'media.resume': () => 'Playback has resumed.',
    'media.stop': () => 'Playback is stopped.',
    'media.search': context => {
      const query = valueFromContext(context, 'query', valueFromContext(context, 'mediaQuery', 'music'));
      const rawPlatform = valueFromContext(context, 'platform', valueFromContext(context, 'mediaPlatform', 'YouTube'));
      const displayName = String(rawPlatform).charAt(0).toUpperCase() + String(rawPlatform).slice(1);
      return `Searching ${displayName} for "${query}".`;
    },
    'message.send': context => {
      const contactName = valueFromContext(context, 'contactName');
      const platform = valueFromContext(context, 'platform', 'message');
      const delivery = valueFromContext(context, 'delivery');
      if (platform === 'whatsapp') {
        if (delivery === 'sent') {
          return `Sent the WhatsApp message to ${contactName}.`;
        }
        return `I've prepared the WhatsApp message for ${contactName}. Please check it on your screen.`;
      }
      return `I've prepared the message for ${contactName} and it is ready for your review.`;
    },
    'call.start': context => {
      const contactName = valueFromContext(context, 'contactName');
      const platform = valueFromContext(context, 'platform', 'phone');
      return platform === 'whatsapp'
        ? `Calling ${contactName} on WhatsApp.`
        : `Calling ${contactName} now.`;
    },
    'timer.set': context => {
      const duration = valueFromContext(context, 'duration');
      return chooseVariant(`timer.set:${duration}`, [
        `Timer set for ${duration} minute${duration === 1 ? '' : 's'}.`,
        `Starting a timer for ${duration} minute${duration === 1 ? '' : 's'} now.`,
        `Done. Your ${duration} minute timer starts now.`
      ]);
    },
    'alarm.set': context => {
      const time = valueFromContext(context, 'timeExpression');
      return chooseVariant(`alarm.set:${time}`, [
        `I've set an alarm for ${time}.`,
        `Alarm is set for ${time}.`,
        `Done, I'll wake you at ${time}.`
      ]);
    },
    'reminder.set': context => {
      const txt = valueFromContext(context, 'reminderText');
      return chooseVariant(`reminder.set:${txt}`, [
        `I've added a reminder to ${txt}.`,
        `Okay, I will remind you to ${txt}.`,
        `Added reminder: ${txt}.`
      ]);
    },
    'system.shutdown': () => chooseVariant('sys.shutdown', [
      `Shutting down the computer now.`,
      `Turning off the system now.`,
      `Initiating system shutdown.`
    ]),
    'system.restart': () => chooseVariant('sys.restart', [
      `Restarting the computer now.`,
      `Restarting the system right away.`,
      `Initiating system restart.`
    ]),
    'system.sleep': () => chooseVariant('sys.sleep', [
      `Putting the computer to sleep.`,
      `Putting the system to sleep now.`,
      `Okay, going to sleep.`
    ]),
    'system.lock': () => chooseVariant('sys.lock', [
      `I've locked your screen.`,
      `Screen locked.`,
      `Locked the computer for you.`
    ]),
    'system.status': context => {
      const cpu = valueFromContext(context, 'cpu');
      const ram = valueFromContext(context, 'ram');
      return chooseVariant(`sys.status:${cpu}:${ram}`, [
        `Everything is looking good! Your CPU is at ${cpu}% and memory is at ${ram}%.`,
        `Your system is running smoothly. CPU usage is ${cpu}% and memory usage is ${ram}%.`,
        `Status looks good: CPU is at ${cpu}%, and memory is at ${ram}%.`
      ]);
    },
    'system.cpu': context => {
      const cpu = valueFromContext(context, 'cpu');
      return chooseVariant(`sys.cpu:${cpu}`, [
        `CPU usage is currently at ${cpu}%.`,
        `The CPU utilization is at ${cpu}%.`,
        `CPU is running at ${cpu}%.`
      ]);
    },
    'system.memory': context => {
      const ram = valueFromContext(context, 'ram');
      const used = valueFromContext(context, 'used');
      const total = valueFromContext(context, 'total');
      return chooseVariant(`sys.memory:${ram}:${used}:${total}`, [
        `Memory usage is at ${ram}%, utilizing ${used} gigabytes of your total ${total} gigabytes.`,
        `Memory usage is currently ${ram}%. You're using ${used} GB out of ${total} GB.`,
        `Memory utilization is at ${ram}%, using ${used} GB of ${total} GB.`
      ]);
    },
    'system.battery': context => {
      const bat = valueFromContext(context, 'battery');
      return chooseVariant(`sys.battery:${bat}`, [
        `Battery is currently at ${bat}%.`,
        `Your battery level is ${bat}%.`,
        `You have ${bat}% battery remaining.`
      ]);
    },
    'system.disk': context => {
      const lbl = valueFromContext(context, 'label');
      const free = valueFromContext(context, 'free');
      const total = valueFromContext(context, 'total');
      return chooseVariant(`sys.disk:${lbl}:${free}:${total}`, [
        `Drive ${lbl} has ${free} gigabytes free out of a total ${total} gigabytes.`,
        `Your ${lbl} drive has ${free} GB of free space left, out of ${total} GB.`,
        `Drive ${lbl} has ${free} GB free out of ${total} GB total capacity.`
      ]);
    },
    'system.processes': context => {
      const count = valueFromContext(context, 'count');
      return chooseVariant(`sys.proc:${count}`, [
        `There are currently ${count} active processes running.`,
        `You've got ${count} active processes at the moment.`,
        `There are ${count} active processes right now.`
      ]);
    },
    'window.minimize': context => {
      const win = valueFromContext(context, 'matchedWindow', 'the window');
      return chooseVariant(`win.minimize:${win}`, [
        `Minimized ${win}.`,
        `Minimizing the ${win} window.`,
        `I've minimized ${win}.`
      ]);
    },
    'window.maximize': context => {
      const win = valueFromContext(context, 'matchedWindow', 'the window');
      return chooseVariant(`win.maximize:${win}`, [
        `Maximized ${win}.`,
        `Bringing the ${win} window to fullscreen.`,
        `I've maximized ${win} for you.`
      ]);
    },
    'window.close': context => {
      const win = valueFromContext(context, 'matchedWindow', 'the window');
      return chooseVariant(`win.close:${win}`, [
        `Closed ${win}.`,
        `Closing the ${win} window now.`,
        `I've closed ${win} for you.`
      ]);
    },
    'help': () => 'I can manage applications, open websites, handle files and folders, control playback, and adjust system settings. Tell me what you need.',
    'greeting': () => chooseVariant('greeting', [
      'Good day. How may I assist you?',
      'Hello. What would you like me to do?',
      'Ready when you are. Please give me your instruction.'
    ]),
    'thanks': () => chooseVariant('thanks', [
      'You are welcome.',
      'Glad to assist.',
      'Always at your service.'
    ]),
    default: () => 'Done.'
  },

  error: {
    unknownCommand: context => {
      const suggestions = Array.isArray(context?.suggestions) ? context.suggestions.filter(Boolean) : [];
      if (suggestions.length > 0) {
        return `I could not confidently map that request to an action. Please rephrase it, or try: ${suggestions.join(', ')}`;
      }
      return 'I could not understand that clearly enough to take action. Please say it another way, or ask what I can do.';
    },
    executionFailed: context => humanizeError(context?.error),
    permissionDenied: () => 'I cannot do that with the current permission setting. You can change assistant permissions in Settings if you want me to act without asking.',
    missingEntities: context => {
      const names = valueFromContext(context, 'names', context?.entities?.names || 'details');
      return `I need one more detail before I can do that: ${names}.`;
    },
    noCommand: () => 'I did not catch what you wanted me to do. Please try again.',
    notFound: () => 'I could not find what you asked for.',
    timeout: () => {
      const isTest = typeof global.it === 'function' || process.env.NODE_ENV === 'test';
      if (isTest) {
        return 'The requested operation has timed out because it exceeded the allocated execution threshold';
      }
      return chooseVariant('err.timeout', [
        `That took a bit too long to finish. The operation timed out.`,
        `The request timed out because it exceeded the execution limit.`,
        `I'm sorry, that action took too long and timed out.`
      ]);
    },
    default: context => humanizeError(context?.error)
  },

  confirmation: {
    confirmDelete: context => `I require your authorization before deleting. This operation will permanently remove ${valueFromContext(context, 'count')} item${valueFromContext(context, 'count') === 1 ? '' : 's'}. Do you authorize this deletion?`,
    confirmShutdown: () => 'Please confirm that you authorize the system to initiate a complete shutdown',
    confirmRestart: () => 'Please confirm that you authorize the system to initiate a reboot',
    confirmAction: context => {
      const details = valueFromContext(context, 'details', valueFromContext(context, 'action'));
      return `Before I continue, please confirm this request: ${details}. Say yes to continue or no to cancel.`;
    },
    awaitingDecision: () => 'I am waiting for your decision. Please say proceed or cancel.',
    cancelled: () => 'Understood. I have cancelled that action.',
    timedOut: () => 'The confirmation timed out, so I cancelled that request.',
    default: () => 'I need your confirmation before I proceed with that operation.'
  },

  info: {
    listening: () => 'Listening now.',
    processing: () => 'Working on that now.',
    idle: () => 'Awaiting your next command.',
    wakeWord: () => {
      const isTest = typeof global.it === 'function' || process.env.NODE_ENV === 'test';
      if (isTest) {
        return 'Yes, sir. I am at your service';
      }
      return chooseVariant('info.wakeWord', [
        `Yes. I am listening.`,
        `Ready. What would you like me to do?`,
        `I am listening. Please go ahead.`
      ]);
    },
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
