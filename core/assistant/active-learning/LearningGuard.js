'use strict';

const SENSITIVE_PATTERNS = [
  /^password$/i,
  /^passcode$/i,
  /^pin$/i,
  /^secret$/i,
  /^token$/i,
  /^api[_-]?key$/i,
  /^api[_-]?token$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^auth[_-]?token$/i,
  /^bearer$/i,
  /^credential$/i,
  /^cookie$/i,
  /^session[_-]?id$/i,
  /^otp$/i,
  /^one[_-]?time[_-]?password$/i,
  /^2fa$/i,
  /^mfa$/i,
  /^credit[_-]?card$/i,
  /^card[_-]?number$/i,
  /^cvv$/i,
  /^expiry[_-]?date$/i,
  /^ssn$/i,
  /^social[_-]?security$/i,
  /^tax[_-]?id$/i,
  /^government[_-]?id$/i,
  /^passport$/i,
  /^driver[_-]?license$/i,
  /^bank[_-]?account$/i,
  /^account[_-]?number$/i,
  /^routing[_-]?number$/i,
  /^iban$/i,
  /^swift$/i,
  /^bic$/i,
  /^private[_-]?key$/i,
  /^encryption[_-]?key$/i,
  /^encryption[_-]?salt$/i,
  /^seed$/i,
  /^mnemonic$/i,
  /^wallet$/i,
  /^private[_-]?message$/i,
  /^direct[_-]?message$/i,
  /^dm$/i,
  /^email$/i,
  /^e[_-]?mail$/i,
  /^phone$/i,
  /^mobile$/i,
  /^telephone$/i,
  /^fax$/i,
  /^address$/i,
  /^location$/i,
  /^gps$/i,
  /^coordinate$/i,
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /credential/i,
  /auth/i,
  /bearer/i,
  /cookie/i,
  /otp/i,
  /2fa/i,
  /mfa/i,
  /credit[_-]?card/i,
  /ssn/i,
  /social[_-]?security/i,
  /passport/i,
  /bank[_-]?account/i,
  /routing[_-]?number/i,
  /private[_-]?key/i,
  /encryption[_-]?key/i,
  /wallet[_-]?address/i,
  /private[_-]?message/i,
  /email/i,
  /phone[_-]?number/i,
  /mobile[_-]?number/i,
  /telephone[_-]?number/i,
  /home[_-]?address/i,
  /street[_-]?address/i
];

const SENSITIVE_VALUE_PATTERNS = [
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  /^\+?[\d\s\-\(\)]{7,20}$/,
  /^\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}$/,
  /^\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}$/,
  /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/,
  /^\d{9,18}$/,
  /^(sk|pk|api)_[a-zA-Z0-9]{20,}$/i,
  /^gh[pous]_[a-zA-Z0-9]{36,}$/i,
  /^xox[baprs]-[a-zA-Z0-9]{10,}$/i,
  /^SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
  /^BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/i,
  /^BEGIN\s+EC\s+PRIVATE\s+KEY/i,
  /^BEGIN\s+OPENSSH\s+PRIVATE\s+KEY/i,
  /^mfa\.[a-zA-Z0-9_-]+$/i
];

const SENSITIVE_CONTENT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:password|passcode|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|otp|one[ _-]?time[ _-]?password|credit[ _-]?card|cvv|bank[ _-]?account|private[ _-]?key)\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk-(?:proj-)?|gh[pousr]_|AKIA|AIza)[A-Z0-9_-]{16,}\b/i,
  /\beyJ[A-Z0-9_-]+\.eyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\b/i,
  /\b(?:call|text|message|whatsapp)\b.{0,40}\+?\d[\d ()-]{5,}\d\b/i
];

const PRIVATE_COMMUNICATION_PATTERN = /\b(?:send|message|text|email|call)\b/i;

const BLOCKED_LEARNING_TYPES = new Set([
  'password',
  'api_key',
  'token',
  'secret',
  'credential',
  'cookie',
  'auth_data',
  'credit_card',
  'bank_account',
  'government_id',
  'otp_code',
  'private_message',
  'email',
  'phone',
  'mobile',
  'address',
  'location'
]);

class LearningGuard {
  static isAllowedLearning(learningType, key, value) {
    if (!learningType || typeof learningType !== 'string') {
      return { allowed: false, reason: 'Invalid learning type' };
    }

    if (BLOCKED_LEARNING_TYPES.has(learningType.toLowerCase())) {
      return { allowed: false, reason: `${learningType} learning is not permitted` };
    }

    if (key && LearningGuard.isSensitiveKey(key)) {
      return { allowed: false, reason: 'Key contains sensitive pattern' };
    }

    if (LearningGuard.isUnsafeObjectKey(key)) {
      return { allowed: false, reason: 'Key is reserved' };
    }

    if (value && LearningGuard.isSensitiveValue(value)) {
      return { allowed: false, reason: 'Value appears to be sensitive data' };
    }

    if (learningType.toLowerCase() === 'workflow' && PRIVATE_COMMUNICATION_PATTERN.test(String(value || ''))) {
      return { allowed: false, reason: 'Private communication commands cannot be learned' };
    }

    return { allowed: true };
  }

  static isSensitiveKey(key) {
    if (!key || typeof key !== 'string') return false;
    
    const normalizedKey = key.toLowerCase().trim();
    
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(normalizedKey)) {
        return true;
      }
    }
    
    return false;
  }

  static isUnsafeObjectKey(key) {
    const normalized = String(key || '').trim().toLowerCase();
    return normalized === '__proto__' || normalized === 'prototype' || normalized === 'constructor';
  }

  static isSensitiveValue(value) {
    if (!value || typeof value !== 'string') return false;
    
    const trimmed = value.trim();
    
    if (trimmed.length < 3) return false;

    for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
    
    const entropy = LearningGuard.calculateShannonEntropy(trimmed);
    if (entropy > 4.5 && trimmed.length >= 20 && /^[a-zA-Z0-9+/=]+$/.test(trimmed)) {
      return true;
    }
    
    return false;
  }

  static calculateShannonEntropy(text) {
    if (!text || text.length === 0) return 0;
    
    const freq = new Map();
    for (const char of text) {
      freq.set(char, (freq.get(char) || 0) + 1);
    }
    
    let entropy = 0;
    const len = text.length;
    for (const count of freq.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    
    return entropy;
  }

  static sanitizeForLearning(input) {
    if (!input || typeof input !== 'string') return '';
    
    return input
      .trim()
      .replace(/[;&|`$(){}\[\]\\\n\r]/g, '')
      .substring(0, 200);
  }

  static validateAliasTarget(target) {
    if (!target || typeof target !== 'string') {
      return { valid: false, reason: 'Target must be a non-empty string' };
    }
    
    const sanitized = target.trim();
    
    if (sanitized.length === 0 || sanitized.length > 500) {
      return { valid: false, reason: 'Target length must be between 1 and 500 characters' };
    }
    
    if (/[\x00-\x1f\x7f]/.test(sanitized)) {
      return { valid: false, reason: 'Target contains control characters' };
    }
    
    return { valid: true, sanitized };
  }

  static validateWorkflowName(name) {
    if (!name || typeof name !== 'string') {
      return { valid: false, reason: 'Workflow name must be a non-empty string' };
    }
    
    const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    if (sanitized.length < 2 || sanitized.length > 50) {
      return { valid: false, reason: 'Workflow name must be between 2 and 50 characters' };
    }
    
    return { valid: true, sanitized };
  }

  static getBlockedTypes() {
    return new Set(BLOCKED_LEARNING_TYPES);
  }

  static getSensitivePatterns() {
    return [...SENSITIVE_PATTERNS].map(r => r.source);
  }

  static explainRestriction(learningType) {
    const explanations = {
      password: 'Passwords must never be stored to protect your security',
      api_key: 'API keys must never be stored to prevent unauthorized access',
      token: 'Authentication tokens must never be stored to protect your sessions',
      credential: 'Credentials must never be stored for security reasons',
      cookie: 'Cookies must never be stored to protect your privacy',
      credit_card: 'Payment information must never be stored for PCI compliance',
      bank_account: 'Banking information must never be stored for security reasons',
      government_id: 'Government IDs must never be stored for privacy protection',
      otp_code: 'One-time passwords must never be stored for security',
      private_message: 'Private messages must never be stored for privacy',
      email: 'Email addresses should not be used for learning',
      phone: 'Phone numbers should not be used for learning',
      address: 'Physical addresses should not be used for learning',
      location: 'Location data should not be used for learning'
    };
    
    const lowerType = String(learningType || '').toLowerCase();
    return explanations[lowerType] || 'This type of data is not allowed for learning';
  }
}

module.exports = LearningGuard;
