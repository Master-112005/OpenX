const Logger = require('../../shared/index').Logger;
const Normalizer = require('../../shared/index').Normalizer;

const INTENT_DEFINITIONS = [
  {
    id: 'volume.up',
    patterns: ['increase volume', 'volume up', 'make it louder', 'raise volume', 'turn up', 'turn the volume up', 'louder please', 'increase sound', 'volume higher', 'pump up the volume'],
    permissionLevel: 'low',
    action: 'volume.up',
    entities: [{ name: 'value', type: 'number', required: false }],
    description: 'Increase system volume'
  },
  {
    id: 'volume.down',
    patterns: ['decrease volume', 'volume down', 'make it quieter', 'lower volume', 'turn down', 'turn the volume down', 'quieter please', 'reduce volume', 'volume lower', 'shh'],
    permissionLevel: 'low',
    action: 'volume.down',
    entities: [{ name: 'value', type: 'number', required: false }],
    description: 'Decrease system volume'
  },
  {
    id: 'volume.set',
    patterns: ['set volume to', 'set the volume to', 'change volume to', 'volume to', 'set sound to'],
    permissionLevel: 'low',
    action: 'volume.set',
    entities: [{ name: 'value', type: 'number', required: true }],
    description: 'Set volume to specific level'
  },
  {
    id: 'brightness.up',
    patterns: ['increase brightness', 'brightness up', 'make it brighter', 'raise brightness', 'turn brightness up', 'brightness higher'],
    permissionLevel: 'low',
    action: 'brightness.up',
    entities: [{ name: 'value', type: 'number', required: false }],
    description: 'Increase screen brightness'
  },
  {
    id: 'brightness.down',
    patterns: ['decrease brightness', 'brightness down', 'make it dimmer', 'lower brightness', 'reduce brightness', 'turn brightness down', 'brightness lower'],
    permissionLevel: 'low',
    action: 'brightness.down',
    entities: [{ name: 'value', type: 'number', required: false }],
    description: 'Decrease screen brightness'
  },
  {
    id: 'brightness.set',
    patterns: ['set brightness to', 'set the brightness to', 'change brightness to', 'brightness to'],
    permissionLevel: 'low',
    action: 'brightness.set',
    entities: [{ name: 'value', type: 'number', required: true }],
    description: 'Set screen brightness to specific level'
  },
  {
    id: 'volume.mute',
    patterns: ['mute', 'mute volume', 'mute sound', 'silence', 'turn off sound'],
    permissionLevel: 'low',
    action: 'volume.mute',
    entities: [],
    description: 'Mute system volume'
  },
  {
    id: 'volume.unmute',
    patterns: ['unmute', 'unmute volume', 'unmute sound', 'turn on sound'],
    permissionLevel: 'low',
    action: 'volume.unmute',
    entities: [],
    description: 'Unmute system volume'
  },
  {
    id: 'app.open',
    patterns: ['open', 'launch', 'start', 'run', 'open up'],
    permissionLevel: 'low',
    action: 'app.open',
    entities: [{ name: 'appName', type: 'string', required: true }],
    description: 'Open an application'
  },
  {
    id: 'app.close',
    patterns: ['close', 'exit', 'quit', 'terminate'],
    permissionLevel: 'medium',
    action: 'app.close',
    entities: [{ name: 'appName', type: 'string', required: true }],
    description: 'Close an application'
  },
  {
    id: 'app.switch',
    patterns: ['switch to', 'go to', 'focus', 'switch window to'],
    permissionLevel: 'low',
    action: 'app.switch',
    entities: [{ name: 'appName', type: 'string', required: true }],
    description: 'Switch to a running application'
  },
  {
    id: 'file.create',
    patterns: ['create file', 'new file', 'make file', 'create a file'],
    permissionLevel: 'low',
    action: 'file.create',
    entities: [
      { name: 'filename', type: 'string', required: true },
      { name: 'path', type: 'string', required: false }
    ],
    description: 'Create a new file'
  },
  {
    id: 'file.open',
    patterns: ['open file', 'open document', 'show file'],
    permissionLevel: 'low',
    action: 'file.open',
    entities: [
      { name: 'filename', type: 'string', required: true },
      { name: 'path', type: 'string', required: false }
    ],
    description: 'Open a file'
  },
  {
    id: 'file.delete',
    patterns: ['delete file', 'remove file', 'erase file', 'delete', 'remove', 'delete a file'],
    permissionLevel: 'medium',
    action: 'file.delete',
    entities: [
      { name: 'filename', type: 'string', required: true },
      { name: 'path', type: 'string', required: false }
    ],
    description: 'Delete a file'
  },
  {
    id: 'file.rename',
    patterns: ['rename file', 'rename'],
    permissionLevel: 'low',
    action: 'file.rename',
    entities: [
      { name: 'oldName', type: 'string', required: true },
      { name: 'newName', type: 'string', required: true }
    ],
    description: 'Rename a file'
  },
  {
    id: 'file.copy',
    patterns: ['copy file', 'copy', 'copy this file'],
    permissionLevel: 'low',
    action: 'file.copy',
    entities: [
      { name: 'source', type: 'string', required: true },
      { name: 'destination', type: 'string', required: true }
    ],
    description: 'Copy a file'
  },
  {
    id: 'file.move',
    patterns: ['move file', 'move', 'move this file'],
    permissionLevel: 'low',
    action: 'file.move',
    entities: [
      { name: 'source', type: 'string', required: true },
      { name: 'destination', type: 'string', required: true }
    ],
    description: 'Move a file'
  },
  {
    id: 'file.search',
    patterns: ['search file', 'find file', 'look for file'],
    permissionLevel: 'low',
    action: 'file.search',
    entities: [{ name: 'query', type: 'string', required: true }],
    description: 'Search for files'
  },
  {
    id: 'folder.create',
    patterns: ['create folder', 'new folder', 'make folder', 'create a folder', 'create directory', 'new directory'],
    permissionLevel: 'low',
    action: 'folder.create',
    entities: [
      { name: 'folderName', type: 'string', required: true },
      { name: 'path', type: 'string', required: false }
    ],
    description: 'Create a new folder'
  },
  {
    id: 'folder.delete',
    patterns: ['delete folder', 'remove folder', 'erase folder', 'delete a folder', 'delete directory'],
    permissionLevel: 'high',
    action: 'folder.delete',
    entities: [
      { name: 'folderName', type: 'string', required: true },
      { name: 'path', type: 'string', required: false }
    ],
    description: 'Delete a folder'
  },
  {
    id: 'folder.move',
    patterns: ['move folder', 'move the folder', 'move directory'],
    permissionLevel: 'low',
    action: 'folder.move',
    entities: [
      { name: 'source', type: 'string', required: true },
      { name: 'destination', type: 'string', required: true }
    ],
    description: 'Move a folder'
  },
  {
    id: 'folder.open',
    patterns: ['open folder', 'open directory', 'show folder', 'navigate to', 'go to folder'],
    permissionLevel: 'low',
    action: 'folder.open',
    entities: [{ name: 'folderName', type: 'string', required: true }],
    description: 'Open a folder in explorer'
  },
  {
    id: 'browser.open',
    patterns: ['open website', 'go to website', 'open url', 'navigate to', 'browse to', 'open', 'go to'],
    permissionLevel: 'low',
    action: 'browser.open',
    entities: [{ name: 'url', type: 'string', required: true }],
    description: 'Open a website in browser'
  },
  {
    id: 'browser.search',
    patterns: ['search for', 'search the web for', 'search web', 'google', 'look up', 'find on web'],
    permissionLevel: 'low',
    action: 'browser.search',
    entities: [{ name: 'query', type: 'string', required: true }],
    description: 'Search the web'
  },
  {
    id: 'message.send',
    patterns: ['send message to', 'send a message to', 'send text to', 'message', 'text', 'ask', 'tell', 'msg'],
    permissionLevel: 'low',
    action: 'message.compose',
    entities: [
      { name: 'contactName', type: 'string', required: true },
      { name: 'messageText', type: 'string', required: true },
      { name: 'platform', type: 'string', required: false }
    ],
    description: 'Prepare a message for a contact'
  },
  {
    id: 'call.start',
    patterns: ['call', 'dial', 'phone', 'ring'],
    permissionLevel: 'low',
    action: 'call.start',
    entities: [
      { name: 'contactName', type: 'string', required: true },
      { name: 'platform', type: 'string', required: false }
    ],
    description: 'Start a call with a contact'
  },
  {
    id: 'timer.set',
    patterns: ['set timer for', 'start timer for', 'timer for'],
    permissionLevel: 'low',
    action: 'timer.set',
    entities: [{ name: 'duration', type: 'number', required: true }],
    description: 'Set a timer'
  },
  {
    id: 'alarm.set',
    patterns: ['set alarm for', 'alarm for', 'wake me at'],
    permissionLevel: 'low',
    action: 'alarm.set',
    entities: [{ name: 'timeExpression', type: 'string', required: true }],
    description: 'Set an alarm'
  },
  {
    id: 'reminder.set',
    patterns: ['remind me at', 'remind at', 'remind me in', 'remind in', 'set reminder for'],
    permissionLevel: 'low',
    action: 'reminder.set',
    entities: [
      { name: 'timeExpression', type: 'string', required: false },
      { name: 'duration', type: 'number', required: false },
      { name: 'reminderText', type: 'string', required: true }
    ],
    description: 'Set a reminder'
  },
  {
    id: 'system.shutdown',
    patterns: ['shutdown', 'shut down', 'turn off computer', 'power off'],
    permissionLevel: 'critical',
    action: 'system.shutdown',
    entities: [],
    description: 'Shutdown the computer'
  },
  {
    id: 'system.restart',
    patterns: ['restart', 'reboot', 'restart computer'],
    permissionLevel: 'critical',
    action: 'system.restart',
    entities: [],
    description: 'Restart the computer'
  },
  {
    id: 'system.sleep',
    patterns: ['sleep', 'go to sleep', 'put computer to sleep'],
    permissionLevel: 'high',
    action: 'system.sleep',
    entities: [],
    description: 'Put computer to sleep'
  },
  {
    id: 'system.lock',
    patterns: ['lock', 'lock computer', 'lock screen'],
    permissionLevel: 'medium',
    action: 'system.lock',
    entities: [],
    description: 'Lock the computer'
  },
  {
    id: 'system.status',
    patterns: ['system status', 'computer status', 'status', 'how is my computer', 'system info', 'pc status'],
    permissionLevel: 'low',
    action: 'system.status',
    entities: [],
    description: 'Get system status'
  },
  {
    id: 'system.cpu',
    patterns: ['cpu usage', 'cpu status', 'processor usage', 'how is the cpu'],
    permissionLevel: 'low',
    action: 'system.cpu',
    entities: [],
    description: 'Get CPU usage'
  },
  {
    id: 'system.memory',
    patterns: ['ram usage', 'memory usage', 'ram status', 'how much ram'],
    permissionLevel: 'low',
    action: 'system.memory',
    entities: [],
    description: 'Get memory usage'
  },
  {
    id: 'system.battery',
    patterns: ['battery status', 'battery level', 'how is my battery', 'battery percentage', 'battery'],
    permissionLevel: 'low',
    action: 'system.battery',
    entities: [],
    description: 'Get battery status'
  },
  {
    id: 'system.disk',
    patterns: ['disk space', 'storage space', 'disk usage', 'how much space', 'storage'],
    permissionLevel: 'low',
    action: 'system.disk',
    entities: [],
    description: 'Get disk space info'
  },
  {
    id: 'system.processes',
    patterns: ['running processes', 'list processes', 'what is running', 'active processes', 'processes'],
    permissionLevel: 'low',
    action: 'system.processes',
    entities: [],
    description: 'List running processes'
  },
  {
    id: 'window.minimize',
    patterns: ['minimize', 'minimize window', 'minimize all'],
    permissionLevel: 'low',
    action: 'window.minimize',
    entities: [{ name: 'windowName', type: 'string', required: false }],
    description: 'Minimize window'
  },
  {
    id: 'window.maximize',
    patterns: ['maximize', 'maximize window', 'fullscreen', 'full screen', 'make full screen'],
    permissionLevel: 'low',
    action: 'window.maximize',
    entities: [{ name: 'windowName', type: 'string', required: false }],
    description: 'Maximize window'
  },
  {
    id: 'window.close',
    patterns: ['close window', 'close tab'],
    permissionLevel: 'low',
    action: 'window.close',
    entities: [{ name: 'windowName', type: 'string', required: false }],
    description: 'Close active window'
  },
  {
    id: 'help',
    patterns: ['help', 'what can you do', 'commands', 'capabilities', 'what can i say'],
    permissionLevel: 'low',
    action: 'help',
    entities: [],
    description: 'Show available commands'
  },
  {
    id: 'greeting',
    patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'whats up', 'sup'],
    permissionLevel: 'low',
    action: 'greeting',
    entities: [],
    description: 'Greet the assistant'
  },
  {
    id: 'thanks',
    patterns: ['thank you', 'thanks', 'thanks a lot', 'thankyou', 'appreciate it'],
    permissionLevel: 'low',
    action: 'thanks',
    entities: [],
    description: 'Thank the assistant'
  },
  {
    id: 'volume.get',
    patterns: ['what is the volume', 'get volume', 'show volume', 'tell me volume', 'current volume', 'volume level'],
    permissionLevel: 'low',
    action: 'volume.get',
    entities: [],
    description: 'Get current volume level'
  },
  {
    id: 'brightness.get',
    patterns: ['what is the brightness', 'get brightness', 'show brightness', 'tell me brightness', 'current brightness', 'brightness level'],
    permissionLevel: 'low',
    action: 'brightness.get',
    entities: [],
    description: 'Get current brightness level'
  },
  {
    id: 'media.play',
    patterns: [
      'play', 'play songs', 'play music', 'play song', 'play on youtube',
      'play on spotify', 'play on soundcloud', 'play on gaana', 'play on jiosaavn',
      'play on amazon music', 'play on apple music', 'stream', 'listen to', 'watch', 'queue'
    ],
    permissionLevel: 'low',
    action: 'media.play',
    entities: [
      { name: 'mediaQuery', type: 'string', required: true },
      { name: 'mediaPlatform', type: 'string', required: false }
    ],
    description: 'Play music or media on a streaming platform'
  },
  {
    id: 'media.next',
    patterns: ['next', 'next song', 'next track', 'skip', 'skip song', 'skip track', 'play next', 'play next song', 'play next track'],
    permissionLevel: 'low',
    action: 'media.next',
    entities: [],
    description: 'Skip to the next song or track'
  },
  {
    id: 'media.previous',
    patterns: ['previous', 'previous song', 'previous track', 'go back', 'go back track', 'go back song', 'prev song', 'play previous', 'play previous song', 'play prev song'],
    permissionLevel: 'low',
    action: 'media.previous',
    entities: [],
    description: 'Go back to the previous song or track'
  },
  {
    id: 'media.pause',
    patterns: ['pause', 'pause song', 'pause music', 'pause play', 'pause playback'],
    permissionLevel: 'low',
    action: 'media.pause',
    entities: [],
    description: 'Pause media playback'
  },
  {
    id: 'media.resume',
    patterns: ['resume', 'resume song', 'resume music', 'resume play', 'resume playback', 'play again', 'continue', 'unpause', 'carry on'],
    permissionLevel: 'low',
    action: 'media.resume',
    entities: [],
    description: 'Resume media playback'
  },
  {
    id: 'media.stop',
    patterns: ['stop music', 'stop song', 'stop playback', 'stop media'],
    permissionLevel: 'low',
    action: 'media.stop',
    entities: [],
    description: 'Stop media playback'
  },
  {
    id: 'media.search',
    patterns: ['search music', 'search song', 'find music', 'find song'],
    permissionLevel: 'low',
    action: 'media.search',
    entities: [
      { name: 'mediaQuery', type: 'string', required: true },
      { name: 'mediaPlatform', type: 'string', required: false }
    ],
    description: 'Search for music or media on a streaming platform'
  }
];

class IntentRegistry {
  constructor() {
    this.logger = new Logger({ level: 'info' });
    this.intentRegistry = new Map();
    this.patternIndex = new Map();
    this._initialize();
  }

  _initialize() {
    INTENT_DEFINITIONS.forEach(def => {
      this.intentRegistry.set(def.id, def);
      def.patterns.forEach(pattern => {
        const normalized = Normalizer.normalizeText(pattern);
        if (!this.patternIndex.has(normalized)) {
          this.patternIndex.set(normalized, []);
        }
        this.patternIndex.get(normalized).push(def.id);
      });
    });
  }

  getAll() {
    return Array.from(this.intentRegistry.values());
  }

  get(intentId) {
    return this.intentRegistry.get(intentId) || null;
  }

  getPatterns() {
    return this.patternIndex;
  }

  registerCustom(intentDef) {
    if (!intentDef.id || !intentDef.patterns || !intentDef.action) {
      throw new Error('Custom intent must have id, patterns, and action');
    }
    this.intentRegistry.set(intentDef.id, intentDef);
    intentDef.patterns.forEach(pattern => {
      const normalized = Normalizer.normalizeText(pattern);
      if (!this.patternIndex.has(normalized)) {
        this.patternIndex.set(normalized, []);
      }
      this.patternIndex.get(normalized).push(intentDef.id);
    });
    this.logger.info(`Registered custom intent: ${intentDef.id}`);
  }

  unregister(intentId) {
    const def = this.intentRegistry.get(intentId);
    if (def) {
      def.patterns.forEach(pattern => {
        const normalized = Normalizer.normalizeText(pattern);
        const list = this.patternIndex.get(normalized);
        if (list) {
          const idx = list.indexOf(intentId);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.patternIndex.delete(normalized);
        }
      });
      this.intentRegistry.delete(intentId);
    }
  }
}

module.exports = {
  IntentRegistry,
  INTENT_DEFINITIONS
};
