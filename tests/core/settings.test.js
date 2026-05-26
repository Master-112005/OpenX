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
        activationShortcut: 'Alt+Space',
        tts: {
          rate: 0,
          volume: 100
        }
      },
      orb: {
        defaultSize: 64,
        defaultOpacity: 0.85
      },
      system: {
        volumeStep: 5
      },
      chat: {
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
    const { service } = createService();
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.settings.assistant.displayName, 'JARVIS');
    assert.equal(snapshot.settings.chat.themeId, 'midnight');
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
        activationShortcut: 'control + shift + j'
      },
      userProfile: {
        fullName: 'Rakesh',
        email: 'rakesh@example.com',
        phone: '+91 98765 43210'
      },
      chat: {
        themeId: 'forest',
        maxHistory: 900
      },
      system: {
        permissionLevel: 'critical'
      }
    });

    assert.equal(saved.assistant.displayName, 'Athena');
    assert.equal(saved.assistant.honorific, 'commander');
    assert.equal(saved.voice.activationShortcut, 'Control+Shift+J');
    assert.equal(saved.userProfile.fullName, 'Rakesh');
    assert.equal(saved.userProfile.phone, '+919876543210');
    assert.equal(saved.chat.themeId, 'forest');
    assert.equal(saved.chat.maxHistory, 900);
    assert.equal(saved.system.permissionLevel, 'critical');

    const runtimeConfig = service.buildRuntimeConfig();
    assert.equal(runtimeConfig.assistant.displayName, 'Athena');
    assert.equal(runtimeConfig.voice.activationShortcut, 'Control+Shift+J');
    assert.equal(runtimeConfig.assistant.userProfile.email, 'rakesh@example.com');
    assert.equal(runtimeConfig.chat.activeTheme, 'forest');
    assert.equal(runtimeConfig.system.permissionLevel, 'critical');
  });

  it('should fall back to the default shortcut when the activation shortcut is invalid', function() {
    const { service } = createService();
    const saved = service.saveSettings({
      voice: {
        activationShortcut: 'space'
      }
    });

    assert.equal(saved.voice.activationShortcut, 'Alt+Space');
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
