const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const REQUIRED_ENTRY_POINTS = [
  'config.js',
  'apps/desktop/preload.js',
  'apps/desktop/settings.js',
  'apps/desktop/permissions.js',
  'apps/desktop/voice/tts.js',
  'core/assistant/context.js',
  'core/assistant/entities.js',
  'core/assistant/intents.js',
  'core/assistant/Active-learning.js',
  'core/assistant/nlp/nlp.js',
  'core/assistant/nlu.js',
  'core/assistant/nle.js',
  'core/assistant/parser.js',
  'core/assistant/personality.js',
  'core/assistant/responses.js',
  'core/assistant/router.js',
  'core/assistant/contest.js',
  'core/assistant/Data.js',
  'core/automation/apps.js',
  'core/automation/brightness.js',
  'core/automation/browser.js',
  'core/automation/communications.js',
  'core/automation/files.js',
  'core/automation/folders.js',
  'core/automation/media.js',
  'core/automation/scheduler.js',
  'core/automation/screenshot-recording.js',
  'core/automation/system.js',
  'core/automation/volume.js',
  'core/automation/windows.js',
  'core/automation/common/action-verification.js',
  'core/automation/common/action-velidation.js',
  'core/automation/common/action-confirm.js',
  'plugins/plugin-controller.js'
];

const SUPERSEDED_DIRECTORIES = [
  'config',
  'apps/desktop/preload',
  'core/shared',
  'core/settings',
  'core/permissions',
  'core/voice',
  'core/media-handling',
  'core/assistant/context',
  'core/assistant/entities',
  'core/assistant/intents',
  'core/assistant/learning',
  'core/assistant/nlu',
  'core/assistant/parser',
  'core/assistant/personality',
  'core/assistant/responses',
  'core/assistant/router',
  'core/automation/apps',
  'core/automation/brightness',
  'core/automation/browser',
  'core/automation/communications',
  'core/automation/files',
  'core/automation/folders',
  'core/automation/forms',
  'core/automation/media',
  'core/automation/scheduler',
  'core/automation/screenshot',
  'core/automation/system',
  'core/automation/volume',
  'core/automation/windows'
];

describe('Requested architecture structure', () => {
  it('provides every requested stable entry point', () => {
    const missing = REQUIRED_ENTRY_POINTS.filter(relativePath => (
      !fs.existsSync(path.join(ROOT, relativePath))
    ));
    assert.deepEqual(missing, []);
  });

  it('removes the superseded directory-based architecture', () => {
    const remaining = SUPERSEDED_DIRECTORIES.filter(relativePath => (
      fs.existsSync(path.join(ROOT, relativePath))
    ));
    assert.deepEqual(remaining, []);
  });

  it('keeps NLE as a behavior-neutral automation delegate', async () => {
    const NaturalLanguageExecution = require('../../core/assistant/nle');
    const calls = [];
    const nle = new NaturalLanguageExecution({
      execute(actionId, entities, context) {
        calls.push({ actionId, entities, context });
        return { success: true, data: { actionId } };
      }
    });
    const result = await nle.execute('app.open', { appName: 'notepad' }, { source: 'test' });

    assert.equal(result.success, true);
    assert.deepEqual(calls, [{
      actionId: 'app.open',
      entities: { appName: 'notepad' },
      context: { source: 'test' }
    }]);
  });
});
