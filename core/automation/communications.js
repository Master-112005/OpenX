const { Logger } = require('../assistant/Data');
const BrowserController = require('./browser');
const FileController = require('./files');
const { launchTarget } = require('./common/launcher');
const WhatsAppDesktopController = require('../../plugins/communications/whatsapp-desktop');

function normalizePhoneNumber(value) {
  const source = String(value || '').trim();
  const digits = source.replace(/[^\d]/g, '');
  if (digits.length < 7) return '';
  return source.startsWith('+') ? `+${digits}` : digits;
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

class CommunicationsController {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.browser = new BrowserController(config);
    this.files = new FileController(config);
    this.whatsAppDesktop = new WhatsAppDesktopController(config);
  }

  async composeMessage(contactName, messageText, platform) {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    if (!messageText) {
      return { success: false, error: 'No message text provided' };
    }

    const preparedMessageText = this._prepareOutgoingMessageText(messageText);
    const messagePlatform = this._resolveMessagingPlatform(platform);
    if (messagePlatform !== 'whatsapp') {
      return {
        success: false,
        error: `Messaging platform not supported: ${messagePlatform}`
      };
    }

    const phone = normalizePhoneNumber(contactName);
    const desktopMessageResult = await this._composeWhatsAppDesktopMessage(contactName, preparedMessageText, platform);
    if (desktopMessageResult?.success) {
      return desktopMessageResult;
    }

    if (!phone) {
      return desktopMessageResult || {
        success: false,
        error: `WhatsApp could not open the chat for ${contactName}`
      };
    }

    const url = this._buildWhatsAppComposeUrl(phone, preparedMessageText);
    const result = this.browser.open(url);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      data: {
        contactName: String(contactName).trim(),
        messageText: preparedMessageText,
        platform: 'whatsapp',
        phone,
        url,
        delivery: 'draft'
      }
    };
  }

  async startCall(contactName, platform) {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    const requestedPlatform = String(platform || '').trim().toLowerCase();
    const phone = normalizePhoneNumber(contactName);
    const callPlatform = requestedPlatform || (phone ? 'phone' : 'whatsapp');
    if (callPlatform === 'whatsapp') {
      return this._startWhatsAppDesktopCall(contactName, 'whatsapp');
    }

    if (callPlatform !== 'phone') {
      return {
        success: false,
        error: `Calling platform not supported: ${callPlatform}`
      };
    }

    if (!phone) {
      return { success: false, error: 'Provide a phone number directly for a standard phone call' };
    }

    this._launchUri(`tel:${phone}`);
    return {
      success: true,
      data: {
        contactName: String(contactName).trim(),
        platform: 'phone',
        phone
      }
    };
  }

  async composeEmail(contactName, subject = '', body = '') {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    const email = String(contactName).trim();
    if (!isEmailAddress(email)) {
      return { success: false, error: 'Provide an email address directly' };
    }

    const cleanSubject = String(subject || '').trim();
    const cleanBody = String(body || '').trim();
    if (!cleanSubject || !cleanBody) {
      return {
        success: true,
        error: `Email draft needs ${!cleanSubject && !cleanBody ? 'a subject and message' : !cleanSubject ? 'a subject' : 'a message'} for ${email}`,
        data: {
          contactName: email,
          email,
          subject: cleanSubject,
          body: cleanBody,
          needsDetails: true
        }
      };
    }

    const url = this._buildMailtoUrl(email, cleanSubject, cleanBody);
    this._launchUri(url);
    return {
      success: true,
      data: {
        contactName: email,
        email,
        subject: cleanSubject,
        body: cleanBody,
        url,
        delivery: 'draft',
        platform: 'email'
      }
    };
  }

  _resolveMessagingPlatform(platform) {
    const requestedPlatform = String(platform || '').trim().toLowerCase();
    if (requestedPlatform) {
      return requestedPlatform;
    }

    return 'whatsapp';
  }

  _buildWhatsAppComposeUrl(phoneNumber, messageText) {
    const digits = String(phoneNumber || '').replace(/[^\d]/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
  }

  _buildMailtoUrl(email, subject, body) {
    const params = new URLSearchParams();
    params.set('subject', subject);
    params.set('body', body);
    return `mailto:${encodeURIComponent(email)}?${params.toString()}`;
  }

  _prepareOutgoingMessageText(messageText) {
    const source = String(messageText || '').trim();
    const fileMatch = source.match(/^file\s+(.+)$/i);
    if (!fileMatch?.[1]) {
      return source;
    }

    const fileName = fileMatch[1].trim();
    const searchResult = this.files.search(fileName);
    const firstPath = Array.isArray(searchResult?.data?.results)
      ? searchResult.data.results[0]
      : null;
    return firstPath
      ? `File path: ${firstPath}`
      : `File requested: ${fileName}`;
  }

  _launchUri(uri) {
    launchTarget(uri);
  }

  async _composeWhatsAppDesktopMessage(contactName, messageText, platform) {
    const requestedPlatform = String(platform || '').trim().toLowerCase();
    if (requestedPlatform && requestedPlatform !== 'whatsapp') {
      return null;
    }

    return this.whatsAppDesktop.sendMessage(contactName, messageText);
  }

  async _startWhatsAppDesktopCall(contactName, platform) {
    const requestedPlatform = String(platform || '').trim().toLowerCase();
    if (requestedPlatform && requestedPlatform !== 'whatsapp') {
      return null;
    }

    return this.whatsAppDesktop.startVoiceCall(contactName);
  }

  destroy() {
    this.whatsAppDesktop?.destroy?.();
  }
}

module.exports = CommunicationsController;
