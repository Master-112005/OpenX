const assert = require('assert');

describe('Communications Controller', function() {
  let CommunicationsController;

  before(function() {
    CommunicationsController = require('../../core/automation/communications');
  });

  function createController() {
    return new CommunicationsController({});
  }

  it('should send a WhatsApp desktop message using the supplied chat name', async function() {
    const controller = createController();
    let captured = null;
    controller.whatsAppDesktop.sendMessage = async (contactName, messageText) => {
      captured = { contactName, messageText };
      return { success: true, data: { contactName, messageText, platform: 'whatsapp', delivery: 'sent' } };
    };

    const result = await controller.composeMessage('daddy', 'call me', 'whatsapp');

    assert.equal(result.success, true);
    assert.deepEqual(captured, { contactName: 'daddy', messageText: 'call me' });
  });

  it('should fall back to a wa.me draft when a phone number is supplied directly', async function() {
    const controller = createController();
    controller.whatsAppDesktop.sendMessage = async () => ({ success: false, error: 'desktop unavailable' });
    controller.browser.open = url => ({ success: true, data: { url } });

    const result = await controller.composeMessage('+91 98765 43210', 'hi', 'whatsapp');

    assert.equal(result.success, true);
    assert.equal(result.data.phone, '+919876543210');
    assert.equal(result.data.url, 'https://wa.me/919876543210?text=hi');
  });

  it('should return the desktop failure for an unavailable named chat', async function() {
    const controller = createController();
    controller.whatsAppDesktop.sendMessage = async () => ({ success: false, error: 'desktop unavailable' });

    const result = await controller.composeMessage('unknown', 'hello', 'whatsapp');

    assert.equal(result.success, false);
    assert.equal(result.error, 'desktop unavailable');
  });

  it('should clean file-send phrases into a shareable file path message', async function() {
    const controller = createController();
    controller.files.search = () => ({ success: true, data: { results: ['C:\\Users\\rakes\\Desktop\\report.pdf'] } });
    let captured = null;
    controller.whatsAppDesktop.sendMessage = async (contactName, messageText) => {
      captured = { contactName, messageText };
      return { success: true, data: { contactName, messageText } };
    };

    await controller.composeMessage('mummy', 'file report.pdf', 'whatsapp');

    assert.deepEqual(captured, {
      contactName: 'mummy',
      messageText: 'File path: C:\\Users\\rakes\\Desktop\\report.pdf'
    });
  });

  it('should start a WhatsApp desktop call using the supplied chat name', async function() {
    const controller = createController();
    let captured = null;
    controller.whatsAppDesktop.startVoiceCall = async contactName => {
      captured = contactName;
      return { success: true, data: { contactName, platform: 'whatsapp' } };
    };

    const result = await controller.startCall('daddy');

    assert.equal(result.success, true);
    assert.equal(captured, 'daddy');
  });

  it('should start a standard call when a phone number is supplied directly', async function() {
    const controller = createController();
    let launchedUri = null;
    controller._launchUri = uri => { launchedUri = uri; };

    const result = await controller.startCall('+91 12345 67890', 'phone');

    assert.equal(result.success, true);
    assert.equal(result.data.phone, '+911234567890');
    assert.equal(launchedUri, 'tel:+911234567890');
  });

  it('should require a direct phone number for standard calls', async function() {
    const controller = createController();
    const result = await controller.startCall('daddy', 'phone');
    assert.equal(result.success, false);
    assert.match(result.error, /phone number directly/i);
  });

  it('should request missing email draft details for a supplied address', async function() {
    const controller = createController();
    const result = await controller.composeEmail('rakesh@example.com', '', '');
    assert.equal(result.success, true);
    assert.equal(result.data.needsDetails, true);
    assert.equal(result.data.email, 'rakesh@example.com');
  });

  it('should prepare a mailto draft from a supplied email address', async function() {
    const controller = createController();
    let launchedUri = null;
    controller._launchUri = uri => { launchedUri = uri; };

    const result = await controller.composeEmail('rakesh@example.com', 'Project update', 'The build passed.');

    assert.equal(result.success, true);
    assert.equal(result.data.delivery, 'draft');
    assert.equal(launchedUri, 'mailto:rakesh%40example.com?subject=Project+update&body=The+build+passed.');
  });

  it('should reject an email recipient name without storing or resolving it', async function() {
    const controller = createController();
    const result = await controller.composeEmail('rakesh', 'Hello', 'Test');
    assert.equal(result.success, false);
    assert.match(result.error, /email address directly/i);
  });
});
