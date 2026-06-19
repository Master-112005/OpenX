const { Logger } = require('../../shared/index');
const { Normalizer } = require('../../shared/index');

const FIELD_TYPE_PATTERNS = {
  name: /^(?:first\s*name|full\s*name|given\s*name|your\s*name|user\s*name|name)$/i,
  lastName: /^(?:last\s*name|surname|family\s*name|second\s*name)$/i,
  email: /^(?:email|e-?mail|gmail|google\s*mail|mail\s*address|email\s*address)$/i,
  phone: /^(?:phone|mobile|telephone|cell|contact\s*number|phone\s*number|mobile\s*number)$/i,
  password: /^(?:password|pwd|pass|secret)$/i,
  address: /^(?:address|street\s*address|home\s*address|location)$/i,
  city: /^(?:city|town)$/i,
  state: /^(?:state|province|region)$/i,
  zip: /^(?:zip|zip\s*code|postal\s*code|pin\s*code|post\s*code)$/i,
  country: /^(?:country|nation)$/i,
  age: /^(?:age|date\s*of\s*birth|dob|birth\s*date|birthday)$/i,
  gender: /^(?:gender|sex)$/i,
  occupation: /^(?:occupation|profession|job|work)$/i,
  company: /^(?:company|organization|organisation|firm)$/i,
  website: /^(?:website|web\s*site|url|site)$/i,
  username: /^(?:user\s*name|login\s*name|username|user\s*id)$/i,
  confirmPassword: /^(?:confirm\s*password|confirm\s*pwd|re-?enter\s*password)$/i,
  date: /^(?:date|appointment\s*date|schedule)$/i,
  time: /^(?:time|appointment\s*time|schedule\s*time)$/i,
  notes: /^(?:notes|comments|message|special\s*instructions|additional\s*info)$/i,
  subject: /^(?:subject|title|topic)$/i,
  description: /^(?:description|details|explain)$/i,
  quantity: /^(?:quantity|amount|number\s*of|how\s*many)$/i,
  cardNumber: /^(?:card\s*number|credit\s*card|debit\s*card|card\s*details)$/i,
  expiryDate: /^(?:expiry|expiration|valid\s*until|validity)$/i,
  cvv: /^(?:cvv|cvc|security\s*code|card\s*cvv)$/i
};

class FormUnderstanding {
  constructor(config = {}) {
    this.logger = new Logger(config?.logging || { level: 'info' });
    this.config = config;
  }

  understandFormFields(fields) {
    if (!Array.isArray(fields)) {
      return { fields: [], missingFields: [], understoodFields: 0 };
    }

    const understoodFields = [];
    const missingFields = [];

    for (const field of fields) {
      const fieldName = String(field.name || field.label || field.id || '').trim();
      const fieldType = this._inferFieldType(fieldName);
      const value = this._getFieldValue(field);

      if (value !== null && value !== undefined && String(value).trim() !== '') {
        understoodFields.push({
          name: fieldName,
          type: fieldType,
          value: value,
          filled: true
        });
      } else {
        missingFields.push({
          name: fieldName,
          type: fieldType,
          filled: false,
          required: field.required || false
        });
      }
    }

    return {
      fields: understoodFields,
      missingFields,
      understoodFields: understoodFields.length,
      totalFields: fields.length,
      completionPercentage: fields.length > 0 ? Math.round((understoodFields.length / fields.length) * 100) : 0
    };
  }

  _inferFieldType(fieldName) {
    const normalized = Normalizer.normalizeText(fieldName);
    if (!normalized) return 'unknown';

    for (const [type, pattern] of Object.entries(FIELD_TYPE_PATTERNS)) {
      if (pattern.test(normalized) || normalized.includes(type.replace(/([A-Z])/g, ' $1').toLowerCase())) {
        return type;
      }
    }

    if (/\b(?:name|first|last|full|given)\b/i.test(normalized)) {
      if (/\blast|surname|family|second\b/i.test(normalized)) return 'lastName';
      return 'name';
    }

    if (/\b(?:email|gmail|google\s*mail|mail|e-?mail)\b/i.test(normalized)) return 'email';
    if (/\b(?:phone|mobile|tel|cell|contact)\b/i.test(normalized)) return 'phone';
    if (/\b(?:password|pass|pwd)\b/i.test(normalized)) return 'password';
    if (/\b(?:address|street|location)\b/i.test(normalized)) return 'address';
    if (/\b(?:city|town)\b/i.test(normalized)) return 'city';
    if (/\b(?:state|province|region)\b/i.test(normalized)) return 'state';
    if (/\b(?:zip|postal|pin|post)\b/i.test(normalized)) return 'zip';
    if (/\b(?:country|nation)\b/i.test(normalized)) return 'country';
    if (/\b(?:age|dob|birth|date|birthday)\b/i.test(normalized)) return 'age';
    if (/\b(?:gender|sex)\b/i.test(normalized)) return 'gender';
    if (/\b(?:occupation|profession|job|work)\b/i.test(normalized)) return 'occupation';
    if (/\b(?:company|organization|firm)\b/i.test(normalized)) return 'company';
    if (/\b(?:website|url|site)\b/i.test(normalized)) return 'website';
    if (/\b(?:user\s*name|login|user\s*id)\b/i.test(normalized)) return 'username';
    if (/\b(?:confirm.*pass|re-?enter)\b/i.test(normalized)) return 'confirmPassword';
    if (/\b(?:date|appointment|schedule)\b/i.test(normalized)) return 'date';
    if (/\b(?:time|schedule\s*time)\b/i.test(normalized)) return 'time';
    if (/\b(?:notes|comments|message|special|additional)\b/i.test(normalized)) return 'notes';
    if (/\b(?:subject|title|topic)\b/i.test(normalized)) return 'subject';
    if (/\b(?:description|details|explain)\b/i.test(normalized)) return 'description';
    if (/\b(?:quantity|amount|number|how\s*many)\b/i.test(normalized)) return 'quantity';
    if (/\b(?:card\s*number|credit|debit)\b/i.test(normalized)) return 'cardNumber';
    if (/\b(?:expiry|expiration|valid\s*until|validity)\b/i.test(normalized)) return 'expiryDate';
    if (/\b(?:cvv|cvc|security\s*code)\b/i.test(normalized)) return 'cvv';

    return 'unknown';
  }

  _getFieldValue(field) {
    if (field.value !== undefined && field.value !== null) {
      return field.value;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      return field.defaultValue;
    }
    if (field.placeholder !== undefined && field.placeholder !== null) {
      return field.placeholder;
    }
    return null;
  }

  validateFilledData(filledData, fieldRequirements = []) {
    const validationResults = [];
    const errors = [];
    const warnings = [];

    for (const field of fieldRequirements) {
      const fieldName = String(field.name || field.label || '').trim();
      const fieldType = this._inferFieldType(fieldName);
      const value = filledData[fieldType] || filledData[fieldName];
      const isRequired = field.required || false;

      const result = {
        field: fieldName,
        type: fieldType,
        value: value,
        valid: true,
        required: isRequired
      };

      if (!value || String(value).trim() === '') {
        if (isRequired) {
          result.valid = false;
          errors.push(`${fieldName} is required but not filled`);
        } else {
          result.valid = true;
          result.skipped = true;
        }
      } else {
        const formatValidation = this._validateFormat(fieldType, String(value).trim());
        if (!formatValidation.valid) {
          result.valid = false;
          result.error = formatValidation.error;
          errors.push(`${fieldName}: ${formatValidation.error}`);
        }

        if (fieldType === 'confirmPassword') {
          const password = filledData.password || filledData.pass;
          if (password && password !== value) {
            result.valid = false;
            result.error = 'Passwords do not match';
            errors.push(`${fieldName}: Passwords do not match`);
          }
        }
      }

      validationResults.push(result);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      results: validationResults,
      filledCount: validationResults.filter(r => r.valid && !r.skipped).length,
      requiredFilled: validationResults.filter(r => r.required && r.valid && !r.skipped).length,
      totalRequired: validationResults.filter(r => r.required).length
    };
  }

  _validateFormat(fieldType, value) {
    switch (fieldType) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return { valid: false, error: 'Invalid email format' };
        }
        break;
      case 'phone': {
        const digits = value.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) {
          return { valid: false, error: 'Invalid phone number format' };
        }
        break;
      }
      case 'zip': {
        if (!/^[\d\w\s-]{3,10}$/.test(value)) {
          return { valid: false, error: 'Invalid ZIP/postal code format' };
        }
        break;
      }
      case 'age': {
        const ageNum = parseInt(value, 10);
        if (isNaN(ageNum) || ageNum < 1 || ageNum > 150) {
          return { valid: false, error: 'Invalid age' };
        }
        break;
      }
      case 'cardNumber': {
        const cardDigits = value.replace(/\D/g, '');
        if (cardDigits.length < 13 || cardDigits.length > 19) {
          return { valid: false, error: 'Invalid card number' };
        }
        break;
      }
      case 'cvv': {
        const cvvDigits = value.replace(/\D/g, '');
        if (cvvDigits.length < 3 || cvvDigits.length > 4) {
          return { valid: false, error: 'Invalid CVV' };
        }
        break;
      }
      case 'confirmPassword':
      case 'password': {
        if (value.length < 4) {
          return { valid: false, error: 'Password too short' };
        }
        break;
      }
    }
    return { valid: true };
  }

  generateCompletionReport(formAnalysis, validation) {
    const parts = [];

    if (validation.valid) {
      parts.push('All form fields have been validated successfully, sir.');
    } else {
      parts.push(`Form validation found ${validation.errors.length} issue(s), sir:`);
      for (const error of validation.errors) {
        parts.push(`- ${error.charAt(0).toUpperCase() + error.slice(1)}`);
      }
    }

    parts.push('');
    parts.push(`Completion status: ${formAnalysis.completionPercentage}% (${formAnalysis.understoodFields} of ${formAnalysis.totalFields} fields filled).`);

    if (formAnalysis.missingFields.length > 0) {
      const missingRequired = formAnalysis.missingFields.filter(f => f.required);
      const missingOptional = formAnalysis.missingFields.filter(f => !f.required);

      if (missingRequired.length > 0) {
        parts.push('');
        parts.push('Missing required fields:');
        for (const field of missingRequired) {
          parts.push(`- ${field.name} (${field.type})`);
        }
      }

      if (missingOptional.length > 0) {
        parts.push('');
        parts.push('Optional fields still empty:');
        for (const field of missingOptional) {
          parts.push(`- ${field.name}`);
        }
      }
    }

    parts.push('');
    if (validation.valid && formAnalysis.completionPercentage === 100) {
      parts.push('The form is complete and ready for submission, sir.');
    } else if (validation.valid) {
      parts.push('The required fields are complete. You may submit when ready, sir.');
    } else {
      parts.push('Please provide the missing required information, sir.');
    }

    return parts.join('\n');
  }
}

module.exports = FormUnderstanding;
