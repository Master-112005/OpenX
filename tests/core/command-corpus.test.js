const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ActionRouter = require('../../core/assistant/router');

const ATTACHED_COMMAND_CORPORA = [
  'C:\\Users\\rakes\\.codex\\attachments\\b7ab965c-7b91-4fc0-be09-30c18913bd9c\\pasted-text.txt',
  'C:\\Users\\rakes\\.codex\\attachments\\ef4d9933-a5af-4439-b438-5dd20733b048\\pasted-text.txt',
  'C:\\Users\\rakes\\.codex\\attachments\\7c8f4da2-be0c-4dd7-af47-f61614237b56\\pasted-text.txt',
  'C:\\Users\\rakes\\.codex\\attachments\\d87a35e8-3aa2-4e77-84af-1eb7fd6a16c7\\pasted-text.txt'
];

const FALLBACK_COMMANDS = [
  'Check my internet speed',
  'Connect to my WiFi',
  'Restore the last deleted file',
  'Compress this folder into a ZIP file',
  'Run a quick virus scan',
  'Print this document',
  'Enable light mode',
  'Take a photo',
  'Convert PDF to Word',
  'Merge these PDFs',
  'Create a meeting reminder',
  'Show exchange rates',
  'Check my notifications',
  'Show my pull requests',
  'Clone this repository',
  'Shuffle my playlist',
  'Show unread messages',
  'Join my voice channel',
  'Share my screen',
  'Restore all windows',
  'Switch to Chrome',
  'Switch to VS Code',
  'Restart the computer',
  'Shutdown the computer',
  'Sleep the computer',
  'Create a folder called Testing',
  'Create five text files inside it',
  'Cancel the search',
  'It\'s too loud',
  'It\'s too dark',
  'The screen is too bright',
  'Enable work mode',
  'Save the summary',
  'Give me key points',
  'Explain the first result',
  'Explain it simply',
  'The screen is hurting my eyes.',
  'Everything looks too small to read.',
  'I can\'t hear anything from the speakers.',
  'Can you make the screen a little brighter?',
  'Will my laptop survive another couple of hours?',
  'I need to check something on the internet.',
  'I\'m looking for beginner-friendly DevOps resources.',
  'I downloaded something recently, can you find it?',
  'Can you help me recover what I just deleted?',
  'I need to send an email to my manager.',
  'Don\'t let me forget my meeting this evening.',
  'Get my coding environment ready.',
  'I\'m in the mood to write something.',
  'I want to calculate some numbers.',
  'I need to compare a few files.',
  'My desktop is a mess.',
  'Check if anything unusual is happening.',
  'Can you see if I\'m connected to WiFi?',
  'Reconnect me to the internet.',
  'I need directions to a nearby restaurant.',
  'I feel like listening to podcasts.',
  'Can you make that easier to understand?',
  'Summarize that in one minute.',
  'Explain it like I\'m a beginner.',
  'Give me a coding challenge.',
  'I want to talk to my friends.',
  'I\'m trying to find a specific conversation.',
  'Upload this document for me.',
  'Make a copy of this folder.',
  'Save this somewhere safe.',
  'I want to review my finances.',
  'Print an extra copy for me.',
  'Cancel the printing job.',
  'I need to scan some paperwork.',
  'Turn this document into a PDF.',
  'Extract pages from this file.',
  'Can you read this document out loud?',
  'Translate this into English.',
  'Translate this into Hindi.',
  'Summarize this report.',
  'I need some peace and quiet.',
  'Reduce distractions as much as possible.',
  'Save my work before exiting.',
  'Shut things down safely.',
  'I need a break.',
  'Open a game for me.',
  'Can you help me get started?',
  'Show me my pending tasks.',
  'Open Chrome, search for Docker tutorial, open VS Code, start my project, open Spotify, and play coding music'
];

function loadCommands() {
  const commandsFile = path.join(__dirname, '..', '..', 'commands.md');
  if (fs.existsSync(commandsFile)) {
    return fs.readFileSync(commandsFile, 'utf8')
      .split(/\r?\n/)
      .map(line => line.match(/^\s*\d+\.\s*(.+?)\s*$/)?.[1])
      .filter(Boolean);
  }

  for (const corpusPath of ATTACHED_COMMAND_CORPORA) {
    if (fs.existsSync(corpusPath)) {
      return fs.readFileSync(corpusPath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    }
  }

  const localFixture = path.join(__dirname, 'assistant-command-corpus.txt');
  if (fs.existsSync(localFixture)) {
    return fs.readFileSync(localFixture, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  return FALLBACK_COMMANDS;
}

function createSandboxRouter() {
  const config = {
    logging: { level: 'error' },
    permissions: {
      userLevel: 'critical',
      levels: {
        low: { requiresConfirmation: false, requiresAuth: false },
        medium: { requiresConfirmation: false, requiresAuth: false },
        high: { requiresConfirmation: false, requiresAuth: false },
        critical: { requiresConfirmation: false, requiresAuth: false }
      }
    }
  };
  const sandboxEngine = {
    execute(actionId, entities) {
      return {
        success: true,
        data: {
          actionId,
          ...(entities || {})
        }
      };
    }
  };
  return new ActionRouter(config, sandboxEngine);
}

describe('Assistant command corpus routing', function() {
  this.timeout(120000);

  it('should understand every command in commands.md without executing real actions', async function() {
    const commands = loadCommands();
    const router = createSandboxRouter();
    const failures = [];

    for (const command of commands) {
      const result = await router.process(command, 'chat');
      if (!result.intent) {
        failures.push({
          command,
          intent: result.intent || null,
          error: result.error || null,
          entities: result.entities || null
        });
      }
    }

    assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  });
});
