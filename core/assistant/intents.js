const Logger = require('./Data').Logger;
const Normalizer = require('./Data').Normalizer;

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
    entities: [
      { name: 'appName', type: 'string', required: true },
      { name: 'forceNewWindow', type: 'boolean', required: false },
      { name: 'requestedOperation', type: 'string', required: false }
    ],
    description: 'Open or focus an application, or explicitly launch another window'
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
    id: 'mode.start',
    patterns: ['start mode', 'open mode', 'launch mode', 'activate mode', 'start the mode'],
    permissionLevel: 'low',
    action: 'mode.start',
    entities: [{ name: 'modeName', type: 'string', required: true }],
    description: 'Start a saved app mode'
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
    id: 'file.smartFind',
    patterns: ['find newest file', 'find recent document', 'find largest file', 'show recent documents'],
    permissionLevel: 'low',
    action: 'file.smartFind',
    entities: [
      { name: 'query', type: 'string', required: false },
      { name: 'location', type: 'string', required: false },
      { name: 'fileType', type: 'string', required: false },
      { name: 'sortBy', type: 'string', required: false },
      { name: 'timeFilter', type: 'string', required: false },
      { name: 'openResult', type: 'boolean', required: false },
      { name: 'groupDuplicates', type: 'boolean', required: false }
    ],
    description: 'Find files by personal context, recency, size, type, or topic'
  },
  {
    id: 'file.list',
    patterns: ['list files', 'show files', 'what files are in', 'what files are on', 'list folder'],
    permissionLevel: 'low',
    action: 'file.list',
    entities: [{ name: 'path', type: 'string', required: false }],
    description: 'List files and folders in a local directory'
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
    id: 'folder.search',
    patterns: ['search folder', 'find folder', 'look for folder', 'locate directory'],
    permissionLevel: 'low',
    action: 'folder.search',
    entities: [{ name: 'query', type: 'string', required: true }],
    description: 'Search for local folders'
  },
  {
    id: 'phone.sendFile',
    patterns: [
      'send file to my phone',
      'share file with my phone',
      'transfer file to my phone',
      'send folder to my phone',
      'share image to my phone'
    ],
    permissionLevel: 'low',
    action: 'phone.sendFile',
    entities: [
      { name: 'path', type: 'string', required: true },
      { name: 'transferKind', type: 'string', required: false }
    ],
    description: 'Send a local file, image, or folder to the connected phone that issued the request'
  },
  {
    id: 'browser.open',
    patterns: ['open website', 'go to website', 'open url', 'open new tab', 'open new chrome tab', 'navigate to', 'browse to', 'open', 'go to'],
    permissionLevel: 'low',
    action: 'browser.open',
    entities: [{ name: 'url', type: 'string', required: true }],
    description: 'Open a website or native new tab in browser'
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
    id: 'browser.siteSearch',
    patterns: ['search in website', 'search on website', 'search inside website', 'find in website'],
    permissionLevel: 'low',
    action: 'browser.siteSearch',
    entities: [
      { name: 'site', type: 'string', required: true },
      { name: 'query', type: 'string', required: true }
    ],
    description: 'Search inside a supported website or browser settings page'
  },
  {
    id: 'browser.openFirstResult',
    patterns: ['open first result', 'open first link', 'click first result', 'click first link', 'click the first search result'],
    permissionLevel: 'low',
    action: 'browser.openFirstResult',
    entities: [{ name: 'query', type: 'string', required: false }],
    description: 'Open the first result from the last browser search'
  },
  {
    id: 'browser.closeTab',
    patterns: ['close tab', 'close current tab', 'close active tab', 'close empty tab', 'close blank tab'],
    permissionLevel: 'low',
    action: 'browser.closeTab',
    entities: [{ name: 'browserName', type: 'string', required: false }],
    description: 'Close the current browser tab'
  },
  {
    id: 'browser.listTabs',
    patterns: ['what tabs are open', 'list tabs', 'show open tabs', 'which tabs are open'],
    permissionLevel: 'low',
    action: 'browser.listTabs',
    entities: [
      { name: 'browserName', type: 'string', required: false },
      { name: 'responseMode', type: 'string', required: false }
    ],
    description: 'List visible browser tabs and browser windows'
  },
  {
    id: 'app.newTab',
    patterns: ['open new tab in app', 'open another tab in app'],
    permissionLevel: 'low',
    action: 'app.newTab',
    entities: [{ name: 'appName', type: 'string', required: true }],
    description: 'Open a new tab inside a tab-capable application'
  },
  {
    id: 'browser.openTab',
    patterns: ['open named tab', 'focus tab', 'switch to tab', 'show tab'],
    permissionLevel: 'low',
    action: 'browser.openTab',
    entities: [
      { name: 'tabQuery', type: 'string', required: true },
      { name: 'browserName', type: 'string', required: false },
      { name: 'forceNewTab', type: 'boolean', required: false }
    ],
    description: 'Focus an existing named tab or open it in a new tab when absent'
  },
  {
    id: 'form.fill',
    patterns: [
      'fill form',
      'fill the form',
      'fill this form',
      'fill this from',
      'fill details',
      'fill my details',
      'fill out form',
      'complete form',
      'complete this form',
      'autofill form',
      'auto fill form',
      'fill google form',
      'fill google forms'
    ],
    permissionLevel: 'low',
    action: 'form.fill',
    entities: [
      { name: 'action', type: 'string', required: false },
      { name: 'targetForm', type: 'string', required: false },
      { name: 'fields', type: 'array', required: false },
      { name: 'formText', type: 'string', required: false }
    ],
    description: 'Fill form fields from saved personal context'
  },
  {
    id: 'system.time',
    patterns: ['what time is it', 'current time', 'tell me the time', 'time now'],
    permissionLevel: 'low',
    action: 'system.time',
    entities: [],
    description: 'Tell the current local time'
  },
  {
    id: 'system.date',
    patterns: ['what is the date', 'what is the day', 'current date', 'date today', 'day today'],
    permissionLevel: 'low',
    action: 'system.date',
    entities: [],
    description: 'Tell the current local date or day'
  },
  {
    id: 'system.calculate',
    patterns: ['calculate', 'what is', 'solve'],
    permissionLevel: 'low',
    action: 'system.calculate',
    entities: [{ name: 'expression', type: 'string', required: true }],
    description: 'Calculate a simple arithmetic expression'
  },
  {
    id: 'system.screenshot',
    patterns: ['take screenshot', 'take a screenshot', 'capture screen', 'screen capture', 'screenshot'],
    permissionLevel: 'low',
    action: 'system.screenshot',
    entities: [],
    description: 'Take a screenshot'
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
    id: 'email.compose',
    patterns: ['send email to', 'send mail to', 'email', 'mail'],
    permissionLevel: 'low',
    action: 'email.compose',
    entities: [
      { name: 'contactName', type: 'string', required: true },
      { name: 'subject', type: 'string', required: false },
      { name: 'body', type: 'string', required: false }
    ],
    description: 'Prepare an email draft for a contact'
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
    patterns: [
      'set timer for', 'start timer for', 'timer for',
      'set a timer at', 'set timer at', 'set me timer at',
      'set a timer for', 'start a timer at', 'create a timer at',
      'timer at', 'a timer at',
      'set alarm at', 'set alarm for', 'set me alarm at',
      'set a alarm at', 'alarm at', 'a alarm at',
      'wake me up at', 'wake me at'
    ],
    permissionLevel: 'low',
    action: 'timer.set',
    entities: [
      { name: 'duration', type: 'number', required: false },
      { name: 'timeExpression', type: 'string', required: false }
    ],
    description: 'Set a timer or alarm at a specific time or duration'
  },
  {
    id: 'alarm.set',
    patterns: ['set alarm for', 'alarm for', 'wake me at'],
    permissionLevel: 'low',
    action: 'alarm.set',
    entities: [
      { name: 'timeExpression', type: 'string', required: true },
      { name: 'alarmLabel', type: 'string', required: false }
    ],
    description: 'Set an alarm'
  },
  {
    id: 'reminder.set',
    patterns: [
      'remind me at', 'remind at', 'remind me in', 'remind in', 'set reminder for',
      'remind me tomorrow at', 'remind tomorrow at', 'remind me tomorrow',
      'remind me in the morning at', 'remind in the morning at',
      'remind me in the evening at', 'remind in the evening at',
      'remind me at night at', 'remind at night at',
      'remind me later at', 'remind later at',
      'set a reminder for', 'create reminder for', 'add reminder for'
    ],
    permissionLevel: 'low',
    action: 'reminder.set',
    entities: [
      { name: 'timeExpression', type: 'string', required: false },
      { name: 'duration', type: 'number', required: false },
      { name: 'reminderText', type: 'string', required: true },
      { name: 'reminderCategory', type: 'string', required: false },
      { name: 'recurrence', type: 'string', required: false }
    ],
    description: 'Set a reminder'
  },
  {
    id: 'timer.pause', patterns: ['pause timer', 'pause active timer'], permissionLevel: 'low',
    action: 'timer.pause', entities: [], description: 'Pause the active timer'
  },
  {
    id: 'timer.resume', patterns: ['resume timer', 'resume active timer'], permissionLevel: 'low',
    action: 'timer.resume', entities: [], description: 'Resume the paused timer'
  },
  {
    id: 'timer.cancel', patterns: ['stop timer', 'cancel timer'], permissionLevel: 'low',
    action: 'timer.cancel', entities: [], description: 'Stop the active timer'
  },
  {
    id: 'timer.reset', patterns: ['reset timer', 'restart timer'], permissionLevel: 'low',
    action: 'timer.reset', entities: [], description: 'Reset the active timer'
  },
  {
    id: 'timer.remaining', patterns: ['time left', 'how much time is left'], permissionLevel: 'low',
    action: 'timer.remaining', entities: [], description: 'Show remaining timer time'
  },
  {
    id: 'timer.list', patterns: ['show active timers', 'list timers'], permissionLevel: 'low',
    action: 'timer.list', entities: [], description: 'Show active timers'
  },
  {
    id: 'timer.clear', patterns: ['delete all timers', 'cancel all timers'], permissionLevel: 'low',
    action: 'timer.clear', entities: [], description: 'Cancel all active timers'
  },
  {
    id: 'stopwatch.start', patterns: ['start stopwatch', 'start a stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.start', entities: [], description: 'Start a stopwatch'
  },
  {
    id: 'stopwatch.pause', patterns: ['pause stopwatch', 'pause the stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.pause', entities: [], description: 'Pause the active stopwatch'
  },
  {
    id: 'stopwatch.resume', patterns: ['resume stopwatch', 'resume the stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.resume', entities: [], description: 'Resume the paused stopwatch'
  },
  {
    id: 'stopwatch.reset', patterns: ['reset stopwatch', 'restart stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.reset', entities: [], description: 'Reset the active stopwatch'
  },
  {
    id: 'stopwatch.cancel', patterns: ['stop stopwatch', 'cancel stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.cancel', entities: [], description: 'Stop the active stopwatch'
  },
  {
    id: 'stopwatch.elapsed', patterns: ['stopwatch time', 'show stopwatch'], permissionLevel: 'low',
    action: 'stopwatch.elapsed', entities: [], description: 'Show elapsed stopwatch time'
  },
  {
    id: 'reminder.list', patterns: ['show reminders', 'list reminders'], permissionLevel: 'low',
    action: 'reminder.list', entities: [{ name: 'scope', type: 'string', required: false }], description: 'Show reminders'
  },
  {
    id: 'reminder.cancel', patterns: ['delete this reminder', 'cancel reminder'], permissionLevel: 'low',
    action: 'reminder.cancel', entities: [], description: 'Cancel the latest reminder'
  },
  {
    id: 'reminder.clear', patterns: ['delete all reminders', 'clear reminders'], permissionLevel: 'low',
    action: 'reminder.clear', entities: [], description: 'Cancel all reminders'
  },
  {
    id: 'reminder.snooze', patterns: ['snooze reminder', 'snooze this reminder'], permissionLevel: 'low',
    action: 'reminder.snooze', entities: [{ name: 'duration', type: 'number', required: false }], description: 'Snooze the active reminder'
  },
  {
    id: 'alarm.snooze', patterns: ['snooze alarm', 'snooze the alarm'], permissionLevel: 'low',
    action: 'alarm.snooze', entities: [{ name: 'duration', type: 'number', required: false }], description: 'Snooze the active alarm'
  },
  {
    id: 'alarm.cancel', patterns: ['stop alarm', 'delete this alarm'], permissionLevel: 'low',
    action: 'alarm.cancel', entities: [], description: 'Stop the active alarm'
  },
  {
    id: 'alarm.list', patterns: ['show alarms', 'list alarms'], permissionLevel: 'low',
    action: 'alarm.list', entities: [], description: 'Show active alarms'
  },
  {
    id: 'alarm.clear', patterns: ['delete all alarms', 'clear alarms'], permissionLevel: 'low',
    action: 'alarm.clear', entities: [], description: 'Cancel all alarms'
  },
  {
    id: 'calendar.open',
    patterns: ['open calendar', 'show calendar', 'open my calendar', 'show my calendar'],
    permissionLevel: 'low',
    action: 'calendar.open',
    entities: [],
    description: 'Open the assistant calendar'
  },
  {
    id: 'timetable.open',
    patterns: ['open timetable', 'show timetable', 'open daily timetable', 'show daily timetable', 'open time table'],
    permissionLevel: 'low',
    action: 'timetable.open',
    entities: [],
    description: 'Open the assistant timetable'
  },
  {
    id: 'calendar.add',
    patterns: ['add to calendar', 'update this in calendar', 'put this in calendar', 'schedule this in calendar'],
    permissionLevel: 'low',
    action: 'calendar.add',
    entities: [
      { name: 'plannerText', type: 'string', required: false },
      { name: 'dateExpression', type: 'string', required: false },
      { name: 'timeExpression', type: 'string', required: false },
      { name: 'reference', type: 'string', required: false }
    ],
    description: 'Add an item to the assistant calendar'
  },
  {
    id: 'timetable.add',
    patterns: ['add to timetable', 'update this in timetable', 'put this in timetable', 'add this to time table'],
    permissionLevel: 'low',
    action: 'timetable.add',
    entities: [
      { name: 'plannerText', type: 'string', required: false },
      { name: 'dateExpression', type: 'string', required: false },
      { name: 'timeExpression', type: 'string', required: false },
      { name: 'reference', type: 'string', required: false }
    ],
    description: 'Add an item to the assistant timetable'
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
    id: 'system.insight',
    patterns: ['top memory app', 'top cpu process', 'what is slowing down my computer', 'show storage usage', 'recently installed apps'],
    permissionLevel: 'low',
    action: 'system.insight',
    entities: [{ name: 'insightType', type: 'string', required: true }],
    description: 'Answer system insight questions with local machine evidence'
  },
  {
    id: 'system.bluetooth',
    patterns: ['bluetooth status', 'what about bluetooth', 'is bluetooth on'],
    permissionLevel: 'low',
    action: 'system.bluetooth',
    entities: [{ name: 'enabled', type: 'boolean', required: false }],
    description: 'Get or change Bluetooth state'
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
    id: 'assistant.learningRepair',
    patterns: ['this learning is wrong', 'what you learned is wrong', 'wrong learning'],
    permissionLevel: 'low',
    action: 'assistant.learningRepair',
    entities: [
      { name: 'repairKind', type: 'string', required: false },
      { name: 'correction', type: 'string', required: false }
    ],
    description: 'Request correction of the latest active-learning record'
  },
  {
    id: 'assistant.identity',
    patterns: ['what is your name', 'who are you', 'what are you called', 'who is your name'],
    permissionLevel: 'low',
    action: 'assistant.identity',
    entities: [],
    description: 'Tell the assistant identity'
  },
  {
    id: 'assistant.userName',
    patterns: ['what is my name', 'who am i', 'do you know my name'],
    permissionLevel: 'low',
    action: 'assistant.userName',
    entities: [],
    description: 'Answer whether the assistant knows the user name'
  },
  {
    id: 'assistant.capability',
    patterns: ['recognized assistant capability'],
    permissionLevel: 'low',
    action: 'assistant.capability',
    entities: [
      { name: 'capability', type: 'string', required: false },
      { name: 'operation', type: 'string', required: false },
      { name: 'target', type: 'string', required: false },
      { name: 'rawCommand', type: 'string', required: false }
    ],
    description: 'Recognize a supported desktop-assistant capability that is handled safely or by a specialized controller'
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
  },
  {
    id: 'media.mute',
    patterns: ['mute media', 'mute video', 'mute youtube video', 'mute song'],
    permissionLevel: 'low',
    action: 'media.mute',
    entities: [],
    description: 'Mute media playback'
  },
  {
    id: 'media.unmute',
    patterns: ['unmute media', 'unmute video', 'unmute youtube video', 'unmute song'],
    permissionLevel: 'low',
    action: 'media.unmute',
    entities: [],
    description: 'Unmute media playback'
  },
  {
    id: 'media.volumeUp',
    patterns: ['increase media volume', 'increase youtube volume', 'turn media up', 'video too quiet'],
    permissionLevel: 'low',
    action: 'media.volumeUp',
    entities: [],
    description: 'Increase media player volume'
  },
  {
    id: 'media.volumeDown',
    patterns: ['decrease media volume', 'decrease youtube volume', 'turn media down', 'video too loud'],
    permissionLevel: 'low',
    action: 'media.volumeDown',
    entities: [],
    description: 'Decrease media player volume'
  },
  {
    id: 'media.fullscreen',
    patterns: ['fullscreen media', 'fullscreen youtube', 'make video fullscreen'],
    permissionLevel: 'low',
    action: 'media.fullscreen',
    entities: [],
    description: 'Switch media playback to fullscreen'
  },
  {
    id: 'media.exitFullscreen',
    patterns: ['exit fullscreen media', 'exit youtube fullscreen', 'leave fullscreen'],
    permissionLevel: 'low',
    action: 'media.exitFullscreen',
    entities: [],
    description: 'Exit fullscreen media playback'
  },
  {
    id: 'media.replay',
    patterns: ['replay media', 'replay video', 'replay that part'],
    permissionLevel: 'low',
    action: 'media.replay',
    entities: [],
    description: 'Replay the current media segment'
  },
  {
    id: 'media.repeat',
    patterns: ['repeat song', 'repeat current song', 'loop song'],
    permissionLevel: 'low',
    action: 'media.repeat',
    entities: [],
    description: 'Toggle repeat or loop for the current media'
  },
  {
    id: 'media.shuffle',
    patterns: ['shuffle songs', 'shuffle playlist', 'shuffle everything'],
    permissionLevel: 'low',
    action: 'media.shuffle',
    entities: [],
    description: 'Shuffle media playback'
  },
  {
    id: 'media.favorite',
    patterns: ['favorite song', 'add song to favorites', 'like this song'],
    permissionLevel: 'low',
    action: 'media.favorite',
    entities: [],
    description: 'Mark the current media as liked or favorite'
  },
  {
    id: 'media.like',
    patterns: ['like video', 'like this youtube video'],
    permissionLevel: 'low',
    action: 'media.like',
    entities: [],
    description: 'Like the current YouTube video'
  },
  {
    id: 'media.subscribe',
    patterns: ['subscribe channel', 'subscribe to this channel'],
    permissionLevel: 'low',
    action: 'media.subscribe',
    entities: [],
    description: 'Open the current YouTube channel subscription control'
  },
  {
    id: 'media.status',
    patterns: ['current song', 'currently playing', 'what song is playing'],
    permissionLevel: 'low',
    action: 'media.status',
    entities: [],
    description: 'Report the last known media playback session'
  }
];

class IntentRegistry {
  constructor() {
    this.logger = new Logger({ level: 'info' });
    this.intentRegistry = new Map();
    this.patternIndex = new Map();
    this.revision = 0;
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
    this.revision += 1;
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

  getRevision() {
    return this.revision;
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
    this.revision += 1;
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
      this.revision += 1;
    }
  }
}

module.exports = {
  IntentRegistry,
  INTENT_DEFINITIONS
};
