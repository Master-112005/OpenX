const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Communications Controller', function() {
  let CommunicationsController;

  before(function() {
    CommunicationsController = require('../../core/automation/communications/index');
  });

  function createController(contacts) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-communications-'));
    const contactsPath = path.join(tempDir, 'contacts.json');
    fs.writeFileSync(contactsPath, JSON.stringify(contacts, null, 2), 'utf8');
    const controller = new CommunicationsController({
      assistant: { contactsPath }
    });
    return { controller, contactsPath, tempDir };
  }

  it('should prepare a whatsapp message draft for a saved contact', async function() {
    const { controller } = createController({
      daddy: { phone: '+919876543210', aliases: ['dad'] }
    });
    controller.whatsAppDesktop.sendMessage = async (contactName, messageText) => ({
      success: false,
      error: 'desktop unavailable',
      data: { contactName, messageText }
    });
    controller.browser.open = (url) => ({ success: true, data: { url } });

    const result = await controller.composeMessage('daddy', 'hi', 'whatsapp');

    assert.equal(result.success, true);
    assert.equal(result.data.contactName, 'daddy');
    assert.equal(result.data.platform, 'whatsapp');
    assert.equal(result.data.url, 'https://wa.me/919876543210?text=hi');
    assert.equal(result.data.delivery, 'draft');
  });

  it('should start a phone call for a saved contact', async function() {
    const { controller } = createController({
      bunty: { phone: '+911234567890' }
    });
    let launchedUri = null;
    controller._launchUri = (uri) => {
      launchedUri = uri;
    };

    const result = await controller.startCall('bunty', 'phone');

    assert.equal(result.success, true);
    assert.equal(result.data.contactName, 'bunty');
    assert.equal(launchedUri, 'tel:+911234567890');
  });

  it('should fail clearly when the contact is missing', async function() {
    const { controller, contactsPath } = createController({});
    controller.whatsAppDesktop.sendMessage = async () => ({
      success: false,
      error: 'desktop unavailable'
    });
    const result = await controller.composeMessage('unknown', 'hello', 'whatsapp');

    assert.equal(result.success, false);
    assert.ok(result.error.includes('Contact not found'));
    assert.ok(result.error.includes(contactsPath));
  });

  it('should send a whatsapp desktop message when the contact book is empty', async function() {
    const { controller } = createController({});
    let captured = null;
    controller.whatsAppDesktop.sendMessage = async (contactName, messageText) => {
      captured = { contactName, messageText };
      return {
        success: true,
        data: {
          contactName,
          messageText,
          platform: 'whatsapp',
          delivery: 'sent',
          transport: 'whatsapp-desktop'
        }
      };
    };

    const result = await controller.composeMessage('daddy', 'call me', 'whatsapp');

    assert.equal(result.success, true);
    assert.deepEqual(captured, { contactName: 'daddy', messageText: 'call me' });
    assert.equal(result.data.delivery, 'sent');
  });

  it('should clean file-send phrases into a shareable file path message', async function() {
    const { controller } = createController({});
    controller.files.search = () => ({
      success: true,
      data: { results: ['C:\\Users\\rakes\\Desktop\\report.pdf'] }
    });
    let captured = null;
    controller.whatsAppDesktop.sendMessage = async (contactName, messageText) => {
      captured = { contactName, messageText };
      return {
        success: true,
        data: {
          contactName,
          messageText,
          platform: 'whatsapp',
          delivery: 'sent',
          transport: 'whatsapp-desktop'
        }
      };
    };

    const result = await controller.composeMessage('mummy', 'file report.pdf', 'whatsapp');

    assert.equal(result.success, true);
    assert.deepEqual(captured, {
      contactName: 'mummy',
      messageText: 'File path: C:\\Users\\rakes\\Desktop\\report.pdf'
    });
  });

  it('should start a whatsapp desktop call when the contact book is empty', async function() {
    const { controller } = createController({});
    let captured = null;
    controller.whatsAppDesktop.startVoiceCall = async (contactName) => {
      captured = contactName;
      return {
        success: true,
        data: {
          contactName,
          platform: 'whatsapp',
          transport: 'whatsapp-desktop'
        }
      };
    };

    const result = await controller.startCall('daddy');

    assert.equal(result.success, true);
    assert.equal(captured, 'daddy');
    assert.equal(result.data.platform, 'whatsapp');
  });

  it('should fall back to stored whatsapp call uri when desktop automation fails', async function() {
    const { controller } = createController({
      daddy: {
        phone: '+919876543210',
        whatsappCallUri: 'whatsapp://call?phone=919876543210'
      }
    });
    controller.whatsAppDesktop.startVoiceCall = async () => ({
      success: false,
      error: 'desktop unavailable'
    });

    let launchedUri = null;
    controller._launchUri = (uri) => {
      launchedUri = uri;
    };

    const result = await controller.startCall('daddy', 'whatsapp');

    assert.equal(result.success, true);
    assert.equal(launchedUri, 'whatsapp://call?phone=919876543210');
  });
});
