const { Logger } = require('../../shared/index');
const BrowserController = require('../browser/index');
const FileController = require('../files/index');
const { launchTarget } = require('../common/launcher');
const { ContactStore } = require('./contact-store');
const WhatsAppDesktopController = require('./whatsapp-desktop');

class CommunicationsController {
  constructor(config) {
    this.config = config;
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.browser = new BrowserController(config);
    this.files = new FileController(config);
    this.contactStore = new ContactStore(config);
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
    const contact = this.contactStore.findContact(contactName);
    if (!contact) {
      const fallbackResult = await this._composeWhatsAppDesktopMessage(contactName, preparedMessageText, platform);
      if (fallbackResult?.success) {
        return fallbackResult;
      }

      return {
        success: false,
        error: `Contact not found: ${contactName}. Add the contact to ${this.contactStore.contactsPath}`
      };
    }

    const messagePlatform = this._resolveMessagingPlatform(platform, contact);
    if (messagePlatform !== 'whatsapp') {
      return {
        success: false,
        error: `Messaging platform not supported: ${messagePlatform}`
      };
    }

    if (!contact.phone) {
      return this.whatsAppDesktop.sendMessage(contact.name, preparedMessageText);
    }

    const desktopMessageResult = await this._composeWhatsAppDesktopMessage(contact.name, preparedMessageText, platform);
    if (desktopMessageResult?.success) {
      return desktopMessageResult;
    }

    const url = this._buildWhatsAppComposeUrl(contact.phone, preparedMessageText);
    const result = this.browser.open(url);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      data: {
        contactName: contact.name,
        messageText: preparedMessageText,
        platform: 'whatsapp',
        phone: contact.phone,
        url,
        delivery: 'draft'
      }
    };
  }

  async startCall(contactName, platform) {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    const contact = this.contactStore.findContact(contactName);
    if (!contact) {
      const fallbackResult = await this._startWhatsAppDesktopCall(contactName, platform);
      if (fallbackResult?.success) {
        return fallbackResult;
      }

      return {
        success: false,
        error: `Contact not found: ${contactName}. Add the contact to ${this.contactStore.contactsPath}`
      };
    }

    const callPlatform = this._resolveCallPlatform(platform, contact);
    if (callPlatform === 'whatsapp') {
      const desktopCallResult = await this._startWhatsAppDesktopCall(contact.name, 'whatsapp');
      if (desktopCallResult?.success) {
        return desktopCallResult;
      }

      if (!contact.whatsappCallUri) {
        return {
          success: false,
          error: `Direct WhatsApp calling is not supported for ${contact.name}. Add whatsappCallUri for that contact or place a standard phone call instead`
        };
      }

      this._launchUri(contact.whatsappCallUri);
      return {
        success: true,
        data: {
          contactName: contact.name,
          platform: 'whatsapp',
          phone: contact.phone || null
        }
      };
    }

    if (!contact.phone) {
      return {
        success: false,
        error: `Contact does not have a phone number: ${contact.name}`
      };
    }

    this._launchUri(`tel:${contact.phone}`);
    return {
      success: true,
      data: {
        contactName: contact.name,
        platform: 'phone',
        phone: contact.phone
      }
    };
  }

  async composeEmail(contactName, subject = '', body = '') {
    if (!contactName) {
      return { success: false, error: 'No contact name provided' };
    }

    const contact = this.contactStore.findContact(contactName);
    if (!contact) {
      return {
        success: false,
        error: `Contact not found: ${contactName}. Add the contact to ${this.contactStore.contactsPath}`
      };
    }

    if (!contact.email) {
      return {
        success: false,
        error: `Contact does not have an email address: ${contact.name}`
      };
    }

    const cleanSubject = String(subject || '').trim();
    const cleanBody = String(body || '').trim();
    if (!cleanSubject || !cleanBody) {
      return {
        success: true,
        error: `Email draft needs ${!cleanSubject && !cleanBody ? 'a subject and message' : !cleanSubject ? 'a subject' : 'a message'} for ${contact.name}`,
        data: {
          contactName: contact.name,
          email: contact.email,
          subject: cleanSubject,
          body: cleanBody,
          needsDetails: true
        }
      };
    }

    const url = this._buildMailtoUrl(contact.email, cleanSubject, cleanBody);
    this._launchUri(url);
    return {
      success: true,
      data: {
        contactName: contact.name,
        email: contact.email,
        subject: cleanSubject,
        body: cleanBody,
        url,
        delivery: 'draft',
        platform: 'email'
      }
    };
  }

  _resolveMessagingPlatform(platform, contact) {
    const requestedPlatform = String(platform || '').trim().toLowerCase();
    if (requestedPlatform) {
      return requestedPlatform;
    }

    if (contact.preferredMessagingPlatform) {
      return contact.preferredMessagingPlatform;
    }

    if (contact.platforms.includes('whatsapp')) {
      return 'whatsapp';
    }

    return 'whatsapp';
  }

  _resolveCallPlatform(platform, contact) {
    const requestedPlatform = String(platform || '').trim().toLowerCase();
    if (requestedPlatform) {
      return requestedPlatform;
    }

    if (contact.preferredCallPlatform) {
      return contact.preferredCallPlatform;
    }

    if (contact.whatsappCallUri) {
      return 'whatsapp';
    }

    return 'phone';
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
