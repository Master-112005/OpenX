const fs = require('fs');
const path = require('path');
const { Logger, Normalizer } = require('../../shared/index');
const { buildDataPaths } = require('../../shared/data-root');

const MAX_CONTACTS = 10;

function normalizePhoneNumber(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

function isPhoneLike(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  return digits.length >= 7;
}

class ContactStore {
  constructor(config) {
    this.config = config;
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.contactsPath = this._resolveContactsPath();
  }

  _resolveContactsPath() {
    const configuredPath = this.config?.assistant?.contactsPath;
    if (configuredPath) {
      return path.resolve(configuredPath);
    }

    return buildDataPaths(this.config).contactsPath;
  }

  _ensureStoreExists() {
    const directory = path.dirname(this.contactsPath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    if (!fs.existsSync(this.contactsPath)) {
      fs.writeFileSync(this.contactsPath, '{}', 'utf8');
    }
  }

  _loadRawContacts() {
    this._ensureStoreExists();
    const source = fs.readFileSync(this.contactsPath, 'utf8').trim();
    if (!source) {
      return {};
    }

    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    return {};
  }

  _saveRawContacts(rawContacts) {
    this._ensureStoreExists();
    const payload = isPlainObject(rawContacts) ? rawContacts : {};
    fs.writeFileSync(this.contactsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  _normalizeRecord(name, contact) {
    if (!contact || typeof contact !== 'object') {
      return null;
    }

    const resolvedName = String(contact.name || name || '').trim();
    if (!resolvedName) {
      return null;
    }

    const phone = normalizePhoneNumber(contact.phone);
    const aliases = Array.isArray(contact.aliases)
      ? contact.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
      : [];
    const platforms = Array.isArray(contact.platforms)
      ? contact.platforms.map(platform => String(platform || '').trim().toLowerCase()).filter(Boolean)
      : [];

    return {
      name: resolvedName,
      normalizedName: Normalizer.normalizeText(resolvedName),
      aliases,
      normalizedAliases: aliases.map(alias => Normalizer.normalizeText(alias)).filter(Boolean),
      phone,
      platforms,
      email: String(contact.email || contact.mail || '').trim(),
      preferredMessagingPlatform: String(
        contact.preferredMessagingPlatform ||
        contact.preferredPlatform ||
        ''
      ).trim().toLowerCase(),
      preferredCallPlatform: String(contact.preferredCallPlatform || '').trim().toLowerCase(),
      whatsappCallUri: String(contact.whatsappCallUri || '').trim()
    };
  }

  getAll() {
    const rawContacts = this._loadRawContacts();
    if (Array.isArray(rawContacts)) {
      return rawContacts
        .map((contact, index) => this._normalizeRecord(contact.name || `contact-${index + 1}`, contact))
        .filter(Boolean);
    }

    return Object.entries(rawContacts)
      .map(([name, contact]) => this._normalizeRecord(name, contact))
      .filter(Boolean);
  }

  listContacts() {
    return this.getAll().map(contact => ({
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      aliases: [...contact.aliases],
      platforms: [...contact.platforms],
      preferredMessagingPlatform: contact.preferredMessagingPlatform,
      preferredCallPlatform: contact.preferredCallPlatform,
      whatsappCallUri: contact.whatsappCallUri
    }));
  }

  findContact(query) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) {
      return null;
    }

    if (isPhoneLike(rawQuery)) {
      return {
        name: rawQuery,
        normalizedName: Normalizer.normalizeText(rawQuery),
        aliases: [],
        normalizedAliases: [],
        phone: normalizePhoneNumber(rawQuery),
        platforms: ['whatsapp', 'phone'],
        preferredMessagingPlatform: 'whatsapp',
        preferredCallPlatform: 'phone',
        whatsappCallUri: ''
      };
    }

    const contacts = this.getAll();
    if (contacts.length === 0) {
      return null;
    }

    const normalizedQuery = Normalizer.normalizeText(rawQuery);
    const exact = contacts.find(contact => (
      contact.normalizedName === normalizedQuery ||
      contact.normalizedAliases.includes(normalizedQuery)
    ));
    if (exact) {
      return exact;
    }

    const contains = contacts.find(contact => (
      contact.normalizedName.includes(normalizedQuery) ||
      contact.normalizedAliases.some(alias => alias.includes(normalizedQuery))
    ));
    if (contains) {
      return contains;
    }

    const candidateMap = new Map();
    contacts.forEach(contact => {
      candidateMap.set(contact.normalizedName, contact);
      contact.normalizedAliases.forEach(alias => candidateMap.set(alias, contact));
    });

    const closest = Normalizer.findClosestOption(normalizedQuery, Array.from(candidateMap.keys()), {
      minSimilarity: 0.62,
      maxDistance: normalizedQuery.length >= 7 ? 3 : 2
    });

    return closest ? candidateMap.get(closest.normalizedMatch) || null : null;
  }

  saveContact(contact) {
    const sanitized = this._sanitizeEditableContact(contact);
    if (!sanitized.name) {
      throw new Error('Contact name is required');
    }

    const rawContacts = this._loadRawContacts();
    const payload = Array.isArray(rawContacts)
      ? Object.fromEntries(rawContacts.map(entry => [entry.name, entry]))
      : { ...rawContacts };

    const previousKey = Object.keys(payload).find(key => (
      Normalizer.normalizeText(key) === Normalizer.normalizeText(sanitized.name)
    ));

    if (!previousKey && Object.keys(payload).length >= MAX_CONTACTS) {
      throw new Error(`Contact limit reached. You can save up to ${MAX_CONTACTS} contacts.`);
    }

    if (previousKey && previousKey !== sanitized.name) {
      delete payload[previousKey];
    }

    payload[sanitized.name] = sanitized;
    this._saveRawContacts(payload);
    return this._normalizeRecord(sanitized.name, sanitized);
  }

  deleteContact(name) {
    const contactName = String(name || '').trim();
    if (!contactName) {
      throw new Error('Contact name is required');
    }

    const rawContacts = this._loadRawContacts();
    const payload = Array.isArray(rawContacts)
      ? Object.fromEntries(rawContacts.map(entry => [entry.name, entry]))
      : { ...rawContacts };

    const key = Object.keys(payload).find(entryName => (
      Normalizer.normalizeText(entryName) === Normalizer.normalizeText(contactName)
    ));

    if (!key) {
      return false;
    }

    delete payload[key];
    this._saveRawContacts(payload);
    return true;
  }

  _sanitizeEditableContact(contact) {
    const source = contact && typeof contact === 'object' ? contact : {};
    const name = String(source.name || '').trim();
    const aliases = Array.isArray(source.aliases)
      ? source.aliases.map(alias => String(alias || '').trim()).filter(Boolean)
      : String(source.aliases || '')
          .split(',')
          .map(alias => alias.trim())
          .filter(Boolean);
    const platforms = Array.isArray(source.platforms)
      ? source.platforms.map(platform => String(platform || '').trim().toLowerCase()).filter(Boolean)
      : [];

    return {
      name,
      phone: normalizePhoneNumber(source.phone || ''),
      email: String(source.email || source.mail || '').trim(),
      aliases,
      platforms,
      preferredMessagingPlatform: String(source.preferredMessagingPlatform || '').trim().toLowerCase(),
      preferredCallPlatform: String(source.preferredCallPlatform || '').trim().toLowerCase(),
      whatsappCallUri: String(source.whatsappCallUri || '').trim()
    };
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  ContactStore,
  MAX_CONTACTS,
  isPhoneLike,
  normalizePhoneNumber
};
