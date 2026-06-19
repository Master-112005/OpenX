const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Settings Service', function() {
  let SettingsService;

  before(function() {
    SettingsService = require('../../core/settings/index').SettingsService;
  });

  function createService() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-settings-'));
    const config = {
      app: {
        name: 'JARVIS',
        dataDir: tempDir
      },
      assistant: {
        displayName: 'JARVIS',
        title: 'Desktop Assistant',
        honorific: 'sir',
        contactsPath: path.join(tempDir, 'contacts.json'),
        userProfile: {}
      },
      voice: {
        tts: {
          rate: 2,
          volume: 100
        }
      },
      system: {
        volumeStep: 5
      },
      chat: {
        activationShortcut: 'Alt+Space',
        activeTheme: 'midnight',
        maxHistory: 500
      }
    };

    return {
      service: new SettingsService(config),
      tempDir,
      contactsPath: config.assistant.contactsPath
    };
  }

  it('should expose default settings and themes', function() {
    const { service, tempDir, contactsPath } = createService();
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.settings.assistant.displayName, 'JARVIS');
    assert.equal(snapshot.settings.chat.themeId, 'midnight');
    assert.equal(snapshot.dataRoot, tempDir);
    assert.equal(snapshot.dataPaths.settingsPath, path.join(tempDir, 'settings.json'));
    assert.equal(snapshot.dataPaths.learningPath, path.join(tempDir, 'learning.json'));
    assert.equal(snapshot.contactsPath, contactsPath);
    assert.ok(Array.isArray(snapshot.availableThemes));
    assert.ok(snapshot.availableThemes.length >= 1);
  });

  it('should persist assistant profile and user details', function() {
    const { service } = createService();
    const saved = service.saveSettings({
      assistant: {
        displayName: 'Athena',
        title: 'Form Assistant',
        honorific: 'commander'
      },
      voice: {
        tts: {
          rate: 4,
          volume: 72
        }
      },
      userProfile: {
        fullName: 'Rakesh',
        email: 'rakesh@example.com',
        phone: '+91 98765 43210'
      },
      chat: {
        activationShortcut: 'control + shift + j',
        themeId: 'forest',
        maxHistory: 900
      },
      system: {
        permissionLevel: 'critical'
      },
      activeLearning: {
        enabled: false,
        askForFeedback: false
      },
      modes: [
        {
          name: 'gaming',
          apps: [
            { name: 'chrome', instructions: ['search for games'] },
            { name: 'discord', instructions: [] }
          ],
          commands: ['set volume to 45']
        },
        { name: 'dev', apps: 'code, chrome, terminal', instructions: 'open openx folder\nset volume to 35' }
      ]
    });

    assert.equal(saved.assistant.displayName, 'Athena');
    assert.equal(saved.assistant.honorific, 'commander');
    assert.equal(saved.chat.activationShortcut, 'Control+Shift+J');
    assert.equal(saved.voice.tts.rate, 4);
    assert.equal(saved.voice.tts.volume, 72);
    assert.equal(saved.userProfile.fullName, 'Rakesh');
    assert.equal(saved.userProfile.phone, '+919876543210');
    assert.equal(saved.chat.themeId, 'forest');
    assert.equal(saved.chat.maxHistory, 900);
    assert.equal(saved.system.permissionLevel, 'critical');
    assert.equal(saved.activeLearning.enabled, false);
    assert.equal(saved.activeLearning.askForFeedback, false);
    assert.equal(saved.modes.length, 2);
    assert.deepEqual(saved.modes[0].apps, [
      { name: 'chrome', instructions: ['search for games'] },
      { name: 'discord', instructions: [] }
    ]);
    assert.deepEqual(saved.modes[0].commands, ['set volume to 45']);
    assert.deepEqual(saved.modes[1].apps, [
      { name: 'code', instructions: [] },
      { name: 'chrome', instructions: [] },
      { name: 'terminal', instructions: [] }
    ]);
    assert.deepEqual(saved.modes[1].commands, ['open openx folder', 'set volume to 35']);

    const runtimeConfig = service.buildRuntimeConfig();
    assert.equal(runtimeConfig.assistant.displayName, 'Athena');
    assert.equal(runtimeConfig.chat.activationShortcut, 'Control+Shift+J');
    assert.equal(runtimeConfig.voice.tts.rate, 4);
    assert.equal(runtimeConfig.voice.tts.volume, 72);
    assert.equal(runtimeConfig.assistant.userProfile.email, 'rakesh@example.com');
    assert.equal(runtimeConfig.chat.activeTheme, 'forest');
    assert.equal(runtimeConfig.system.permissionLevel, 'critical');
    assert.equal(runtimeConfig.activeLearning.enabled, false);
    assert.equal(runtimeConfig.activeLearning.askForFeedback, false);
    assert.equal(runtimeConfig.app.dataDir, service.dataPaths.root);
    assert.equal(runtimeConfig.app.dataPaths.learningPath, path.join(service.dataPaths.root, 'learning.json'));
    assert.equal(runtimeConfig.activeLearning.storePath, path.join(service.dataPaths.root, 'learning.json'));
    assert.equal(runtimeConfig.logging.directory, path.join(service.dataPaths.root, 'logs'));
    assert.deepEqual(runtimeConfig.modes[0], saved.modes[0]);
  });

  it('should sanitize custom modes and enforce a maximum of 5', function() {
    const { service } = createService();
    const saved = service.saveSettings({
      modes: [
        { name: 'gaming', apps: ['chrome', 'discord', 'chrome'], commands: ['play liked songs', 'play liked songs'] },
        { name: 'Gaming', apps: ['duplicate'] },
        { name: 'dev', apps: 'code, chrome, terminal, youtube, whatsapp, paint' },
        { name: 'work', apps: ['outlook'] },
        { name: 'study', apps: ['notepad'] },
        { name: 'media', apps: ['youtube'] },
        { name: 'extra', apps: ['paint'] }
      ]
    });

    assert.equal(saved.modes.length, 5);
    assert.deepEqual(saved.modes[0].apps, [
      { name: 'chrome', instructions: [] },
      { name: 'discord', instructions: [] }
    ]);
    assert.deepEqual(saved.modes[0].commands, ['play liked songs']);
    assert.equal(saved.modes[1].apps.length, 5);
    assert.equal(saved.modes.find(mode => mode.name === 'Gaming'), undefined);
    assert.equal(saved.modes[4].name, 'media');
  });

  it('should fall back to the default shortcut when the activation shortcut is invalid', function() {
    const { service } = createService();
    const saved = service.saveSettings({
      chat: {
        activationShortcut: 'space'
      }
    });

    assert.equal(saved.chat.activationShortcut, 'Alt+Space');
  });

  it('should migrate the old slow default TTS rate to the faster default', function() {
    const { service } = createService();
    const saved = service.saveSettings({
      voice: {
        tts: {
          rate: -1,
          volume: 64
        }
      }
    });

    assert.equal(saved.voice.tts.rate, 2);
    assert.equal(saved.voice.tts.volume, 64);
  });

  it('should create, list, and delete contacts through the service', function() {
    const { service, contactsPath } = createService();

    service.saveContact({
      name: 'daddy',
      phone: '+91 98765 43210',
      aliases: 'dad, father',
      preferredMessagingPlatform: 'whatsapp',
      preferredCallPlatform: 'phone'
    });

    let snapshot = service.getSnapshot();
    assert.equal(snapshot.contacts.length, 1);
    assert.equal(snapshot.contacts[0].name, 'daddy');
    assert.equal(snapshot.contacts[0].phone, '+919876543210');
    assert.deepEqual(snapshot.contacts[0].aliases, ['dad', 'father']);
    assert.ok(fs.existsSync(contactsPath));

    service.deleteContact('daddy');
    snapshot = service.getSnapshot();
    assert.equal(snapshot.contacts.length, 0);
  });

  it('should enforce a maximum of 10 saved contacts', function() {
    const { service } = createService();

    for (let index = 1; index <= 10; index += 1) {
      service.saveContact({
        name: `contact-${index}`,
        phone: `+91 90000 0000${index}`
      });
    }

    assert.throws(
      () => service.saveContact({ name: 'contact-11', phone: '+91 90000 00011' }),
      /Contact limit reached/
    );

    const snapshot = service.getSnapshot();
    assert.equal(snapshot.contacts.length, 10);
  });

  it('should reset settings back to defaults', function() {
    const { service } = createService();

    service.saveSettings({
      assistant: { displayName: 'Nova' },
      chat: { themeId: 'graphite' }
    });

    const reset = service.resetSettings();
    assert.equal(reset.assistant.displayName, 'JARVIS');
    assert.equal(reset.chat.themeId, 'midnight');
  });
});
