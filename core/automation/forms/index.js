const FormUnderstanding = require('./understanding');
const { Logger } = require('../../shared/index');
const { execFileSync } = require('child_process');
const http = require('http');
const https = require('https');

const COMMON_FORM_ACTIONS = [
  'fill form',
  'fill details',
  'fill out form',
  'complete form',
  'submit form',
  'fill in form',
  'auto fill',
  'autofill form',
  'fill the form',
  'fill these details',
  'fill it',
  'fill this form',
  'fill this from',
  'fill the from',
  'complete this from'
];

const FIELD_MAPPINGS = {
  name: ['name', 'firstName', 'first_name', 'yourName'],
  lastName: ['lastName', 'surname', 'last_name', 'familyName'],
  email: ['email', 'emailAddress', 'gmail', 'googleMail', 'mail', 'e-mail'],
  phone: ['phone', 'phoneNumber', 'mobile', 'mobileNumber', 'contact'],
  occupation: ['occupation', 'profession', 'job', 'work', 'jobTitle'],
  company: ['company', 'workplace', 'organization', 'organisation', 'employer'],
  address: ['address', 'location', 'streetAddress', 'street'],
  city: ['city', 'location', 'town', 'cityName'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'zipCode', 'postalCode', 'pinCode', 'postcode'],
  country: ['country', 'nation', 'nationality'],
  age: ['age', 'yourAge', 'personAge'],
  gender: ['gender', 'sex', 'genderSelect'],
  website: ['website', 'webSite', 'url', 'siteUrl'],
  username: ['username', 'userName', 'loginName', 'userId']
};

const TYPE_TO_FACT_KEY = {
  name: 'name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  occupation: 'profession',
  company: 'workplace',
  address: 'location',
  city: 'location',
  state: 'state',
  zip: 'zipcode',
  country: 'country',
  age: 'age',
  gender: 'gender',
  website: 'website',
  username: 'username'
};

class FormAutomation {
  constructor(config = {}, dependencies = {}) {
    this.logger = new Logger({ level: config?.logging?.level || 'info' });
    this.config = config;
    this.formUnderstanding = new FormUnderstanding(config);
    this.learningStore = dependencies.learning || null;
    this.browser = dependencies.browser || null;
    this.windows = dependencies.windows || null;
    this.userFacts = {};
    this._loadUserFacts();
  }

  _loadUserFacts() {
    if (this.learningStore?.enabled) {
      this.userFacts = this.learningStore.getAllUserFacts() || {};
    }
  }

  canHandle(input) {
    const normalized = String(input || '').toLowerCase().trim();
    const typoAware = normalized.replace(/\bfrom\b/g, 'form');
    return COMMON_FORM_ACTIONS.some(action => normalized.includes(action) || typoAware.includes(action));
  }

  understandIntent(input, context = {}) {
    const normalized = String(input || '').toLowerCase().trim();
    this._loadUserFacts();

    let action = 'fill';
    let targetForm = null;
    let fieldOverrides = {};

    if (/\b(submit|send|deliver)\b/.test(normalized)) {
      action = 'submit';
    } else if (/\b(validate|check|verify)\b/.test(normalized)) {
      action = 'validate';
    } else if (/\b(clear|reset|empty)\b/.test(normalized)) {
      action = 'clear';
    } else if (/\b(update|change|edit|modify)\b/.test(normalized)) {
      action = 'update';
    }

    const formMatch = normalized.match(/\b(the|this|that|my|a|an)?\s*(?:form|application|registration|signup|sign-up|login|signin)?\s*(?:for|in|on|at)?\s*(.+)?$/i);
    if (formMatch?.[2]) {
      targetForm = formMatch[2].trim();
    }

    const entityMatch = normalized.match(/(\w+)\s*[:=]\s*(\S+)/g);
    if (entityMatch) {
      for (const match of entityMatch) {
        const colonIdx = match.indexOf(':');
        const equalsIdx = match.indexOf('=');
        const sepIdx = colonIdx > -1 ? colonIdx : equalsIdx;
        const field = match.substring(0, sepIdx).trim();
        const value = match.substring(sepIdx + 1).trim();
        fieldOverrides[field] = value;
      }
    }

    return {
      action,
      targetForm,
      fieldOverrides,
      userFacts: { ...this.userFacts },
      understood: true
    };
  }

  fillFormFromContext(fields, options = {}) {
    this._loadUserFacts();
    const userFacts = { ...this.userFacts, ...(options.userFacts || {}) };
    const filledData = {};
    const filledFields = [];
    const skippedFields = [];
    const inferredFields = [];

    for (const field of fields) {
      const fieldName = String(field.name || field.label || field.id || '').trim();
      const fieldType = this.formUnderstanding._inferFieldType(fieldName);

      if (options.fieldOverrides?.[fieldName]) {
        filledData[fieldName] = options.fieldOverrides[fieldName];
        filledData[fieldType] = options.fieldOverrides[fieldName];
        filledFields.push({ field: fieldName, type: fieldType, source: 'user-provided' });
        continue;
      }

      const lookup = this._lookupPersonalValue(fieldName, fieldType, userFacts);
      let foundValue = lookup.value;
      const source = lookup.source;

      if (foundValue) {
        if (fieldType === 'email' && !foundValue.includes('@')) {
          foundValue = foundValue + '@gmail.com';
        }

        filledData[fieldName] = foundValue;
        filledData[fieldType] = foundValue;
        filledFields.push({ field: fieldName, type: fieldType, source });
        inferredFields.push({ field: fieldName, value: foundValue, source });
      } else {
        if (field.required || field.required === 'true' || field.required === true) {
          skippedFields.push({ field: fieldName, type: fieldType, required: true });
        }
      }
    }

    return {
      filledData,
      filledFields,
      skippedFields,
      inferredFields,
      userFactsUsed: inferredFields.length,
      totalFields: fields.length,
      completionPercentage: fields.length > 0 ? Math.round((filledFields.length / fields.length) * 100) : 0
    };
  }

  async fill(entities = {}) {
    this._loadUserFacts();
    const userFacts = { ...this.userFacts, ...(entities.userFacts || {}) };
    const fieldOverrides = entities.fieldOverrides || {};
    const url = this._extractUrl(entities.url || entities.command || entities.targetForm || '');
    if (url && this._isGoogleFormUrl(url)) {
      return this.fillGoogleFormUrl(url, { fieldOverrides, userFacts });
    }

    const formText = String(entities.formText || entities.text || '').trim();

    if (formText) {
      const textResult = this.fillTextTemplate(formText, { fieldOverrides, userFacts });
      const fields = textResult.fields;
      const validationResult = this.validateAndConfirm(textResult.filledData, fields);
      return {
        success: true,
        data: {
          action: 'form.fill',
          mode: 'text-template',
          filledText: textResult.filledText,
          filledData: textResult.filledData,
          filledFields: textResult.filledFields,
          skippedFields: textResult.skippedFields,
          totalFields: textResult.totalFields,
          completionPercentage: textResult.completionPercentage,
          validation: validationResult.validation,
          formAnalysis: validationResult.formAnalysis,
          canSubmit: validationResult.canSubmit,
          report: validationResult.report,
          message: this.buildConfirmationMessage(textResult, validationResult)
        }
      };
    }

    if (this._shouldUseTextWindow(entities)) {
      const textWindowResult = this.fillActiveTextWindow(entities, { fieldOverrides, userFacts });
      if (textWindowResult) {
        return textWindowResult;
      }
    }

    const fields = this.extractFieldsFromPage(entities.pageData || entities);
    if (fields.length === 0) {
      return {
        success: false,
        error: 'No form fields or form text were available to fill',
        data: {
          action: 'form.fill',
          needsFormFields: true,
          userFactsAvailable: Object.keys(userFacts).length
        }
      };
    }

    const fillResult = this.fillFormFromContext(fields, { fieldOverrides, userFacts });
    const validationResult = this.validateAndConfirm(fillResult.filledData, fields);
    return {
      success: true,
      data: {
        action: 'form.fill',
        mode: 'field-list',
        filledData: fillResult.filledData,
        filledFields: fillResult.filledFields,
        skippedFields: fillResult.skippedFields,
        inferredFields: fillResult.inferredFields,
        userFactsUsed: fillResult.userFactsUsed,
        totalFields: fillResult.totalFields,
        completionPercentage: fillResult.completionPercentage,
        validation: validationResult.validation,
        formAnalysis: validationResult.formAnalysis,
        canSubmit: validationResult.canSubmit,
        report: validationResult.report,
        message: this.buildConfirmationMessage(fillResult, validationResult)
      }
    };
  }

  async fillGoogleFormUrl(url, options = {}) {
    const resolvedUrl = await this._resolveUrl(url);
    const response = await this._fetchTextResponse(resolvedUrl);
    const html = response.body;
    const formUrl = response.finalUrl || resolvedUrl;
    const form = this.parseGoogleFormPage(html, formUrl);
    if (!form.fields.length) {
      return {
        success: false,
        error: 'Could not identify fillable fields in the Google Form',
        data: {
          action: 'form.fill',
          url: formUrl,
          needsFormFields: true
        }
      };
    }

    const fillResult = this.fillFormFromContext(form.fields, options);
    const validationResult = this.validateAndConfirm(fillResult.filledData, form.fields);
    const prefilledUrl = this.buildGooglePrefillUrl(form.url, fillResult.filledData, form.fields);
    const opened = this.browser?.open
      ? this.browser.open(prefilledUrl)
      : { success: true, data: { url: prefilledUrl, opened: false } };

    return {
      success: Boolean(opened?.success),
      error: opened?.success ? undefined : opened?.error || 'Could not open the prefilled Google Form',
      data: {
        action: 'form.fill',
        mode: 'google-form-prefill',
        url: prefilledUrl,
        sourceUrl: formUrl,
        opened: Boolean(opened?.success),
        filledData: fillResult.filledData,
        filledFields: fillResult.filledFields,
        skippedFields: fillResult.skippedFields,
        inferredFields: fillResult.inferredFields,
        userFactsUsed: fillResult.userFactsUsed,
        totalFields: fillResult.totalFields,
        completionPercentage: fillResult.completionPercentage,
        validation: validationResult.validation,
        formAnalysis: validationResult.formAnalysis,
        canSubmit: validationResult.canSubmit,
        report: validationResult.report,
        message: this.buildConfirmationMessage(fillResult, validationResult)
      }
    };
  }

  parseGoogleFormPage(html, url) {
    const data = this._extractGoogleFormData(html);
    const fields = data ? this._collectGoogleFormFields(data) : [];
    return {
      url: this._normalizeGoogleFormViewUrl(url),
      fields
    };
  }

  buildGooglePrefillUrl(url, filledData, fields) {
    const prefill = new URL(this._normalizeGoogleFormViewUrl(url));
    prefill.searchParams.set('usp', 'pp_url');

    for (const field of fields) {
      if (!field.entryId) {
        continue;
      }
      const value = filledData[field.name] || filledData[field.label] || filledData[field.type];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        prefill.searchParams.set(`entry.${field.entryId}`, String(value));
      }
    }

    return prefill.href;
  }

  fillActiveTextWindow(entities = {}, options = {}) {
    if (!this.windows?.sendKeys) {
      return null;
    }

    const target = /notepad|notpad/i.test(`${entities.command || ''} ${entities.targetForm || ''}`)
      ? 'notepad'
      : '';
    const text = this._copyWindowText(target);
    if (!text || !/^[^\n:]{1,80}:\s*$/m.test(text)) {
      return null;
    }

    const textResult = this.fillTextTemplate(text, options);
    const fields = textResult.fields;
    const validationResult = this.validateAndConfirm(textResult.filledData, fields);
    if (textResult.filledText !== text) {
      this._pasteWindowText(target, textResult.filledText);
    }

    return {
      success: true,
      data: {
        action: 'form.fill',
        mode: 'text-window',
        target: target || 'active-window',
        filledText: textResult.filledText,
        filledData: textResult.filledData,
        filledFields: textResult.filledFields,
        skippedFields: textResult.skippedFields,
        totalFields: textResult.totalFields,
        completionPercentage: textResult.completionPercentage,
        validation: validationResult.validation,
        formAnalysis: validationResult.formAnalysis,
        canSubmit: validationResult.canSubmit,
        report: validationResult.report,
        message: this.buildConfirmationMessage(textResult, validationResult)
      }
    };
  }

  fillTextTemplate(templateText, options = {}) {
    this._loadUserFacts();
    const userFacts = { ...this.userFacts, ...(options.userFacts || {}) };
    const fieldOverrides = options.fieldOverrides || {};
    const fields = [];
    const filledData = {};
    const filledFields = [];
    const skippedFields = [];
    const inferredFields = [];

    const lines = String(templateText || '').split(/\r?\n/);
    const filledLines = lines.map(line => {
      const match = line.match(/^(\s*([^:\n]+?)\s*:\s*)(.*)$/);
      if (!match) {
        return line;
      }

      const prefix = match[1];
      const fieldName = match[2].trim();
      const existingValue = match[3].trim();
      const fieldType = this.formUnderstanding._inferFieldType(fieldName);
      const field = { name: fieldName, label: fieldName, required: true };
      fields.push(field);

      const override = fieldOverrides[fieldName] || fieldOverrides[fieldType];
      const lookup = override
        ? { value: override, source: 'user-provided' }
        : this._lookupPersonalValue(fieldName, fieldType, userFacts);
      let value = lookup.value;

      if (value && fieldType === 'email' && !String(value).includes('@')) {
        value = `${value}@gmail.com`;
      }

      if (value && (!existingValue || options.overwrite === true)) {
        filledData[fieldName] = value;
        filledData[fieldType] = value;
        filledFields.push({ field: fieldName, type: fieldType, source: lookup.source });
        inferredFields.push({ field: fieldName, value, source: lookup.source });
        const separator = /\s$/.test(prefix) ? '' : ' ';
        return `${prefix}${separator}${value}`;
      }

      if (!existingValue) {
        skippedFields.push({ field: fieldName, type: fieldType, required: true });
      } else {
        filledData[fieldName] = existingValue;
        filledData[fieldType] = existingValue;
      }
      return line;
    });

    return {
      filledText: filledLines.join('\n'),
      fields,
      filledData,
      filledFields,
      skippedFields,
      inferredFields,
      userFactsUsed: inferredFields.length,
      totalFields: fields.length,
      completionPercentage: fields.length > 0 ? Math.round((filledFields.length / fields.length) * 100) : 0
    };
  }

  _lookupPersonalValue(fieldName, fieldType, userFacts) {
    const factKeys = [
      ...(FIELD_MAPPINGS[fieldType] || []),
      TYPE_TO_FACT_KEY[fieldType],
      fieldType,
      String(fieldName || '')
        .trim()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
    ].filter(Boolean);

    for (const factKey of factKeys) {
      if (userFacts[factKey]) {
        return { value: userFacts[factKey], source: `personal-context:${factKey}` };
      }
    }

    return { value: null, source: null };
  }

  _extractUrl(value) {
    const match = String(value || '').match(/https?:\/\/[^\s"'<>]+/i);
    return match ? match[0].replace(/[.,;!?]+$/g, '') : '';
  }

  _isGoogleFormUrl(url) {
    return /https?:\/\/(?:forms\.gle|docs\.google\.com\/forms)\//i.test(String(url || ''));
  }

  _shouldUseTextWindow(entities = {}) {
    const text = `${entities.command || ''} ${entities.targetForm || ''}`.toLowerCase();
    return /\b(?:notepad|notpad|text\s+file|active\s+window|this\s+form|this\s+from)\b/.test(text);
  }

  async _resolveUrl(url) {
    const normalized = this._extractUrl(url) || String(url || '').trim();
    if (!normalized) {
      return '';
    }

    try {
      const response = await this._requestText(normalized, { method: 'HEAD', maxBytes: 0 });
      return response.finalUrl || normalized;
    } catch (error) {
      return normalized;
    }
  }

  async _fetchText(url) {
    const response = await this._fetchTextResponse(url);
    return response.body || '';
  }

  async _fetchTextResponse(url) {
    return this._requestText(url, { method: 'GET', maxBytes: 800000 });
  }

  _requestText(url, options = {}, redirectCount = 0) {
    const method = options.method || 'GET';
    const maxBytes = Number(options.maxBytes ?? 800000);
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(url);
      } catch (error) {
        reject(new Error(`Invalid form URL: ${url}`));
        return;
      }

      const client = parsed.protocol === 'http:' ? http : https;
      const request = client.request(parsed, {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 JarvisAssistant/1.0'
        },
        timeout: 9000
      }, response => {
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && redirectCount < 6) {
          response.resume();
          const nextUrl = new URL(location, parsed).href;
          this._requestText(nextUrl, options, redirectCount + 1).then(resolve, reject);
          return;
        }

        if (method === 'HEAD') {
          response.resume();
          resolve({ finalUrl: parsed.href, body: '' });
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
          if (maxBytes > 0 && body.length > maxBytes) {
            request.destroy();
          }
        });
        response.on('end', () => resolve({ finalUrl: parsed.href, body }));
      });

      request.on('timeout', () => {
        request.destroy(new Error('Timed out while reading form'));
      });
      request.on('error', reject);
      request.end();
    });
  }

  _extractGoogleFormData(html) {
    const marker = 'FB_PUBLIC_LOAD_DATA_';
    const source = String(html || '');
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }

    const equalsIndex = source.indexOf('=', markerIndex);
    const arrayStart = source.indexOf('[', equalsIndex);
    if (equalsIndex < 0 || arrayStart < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let index = arrayStart; index < source.length; index += 1) {
      const char = source[index];
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (inString && char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === '[') depth += 1;
      if (char === ']') depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(arrayStart, index + 1));
        } catch (error) {
          return null;
        }
      }
    }

    return null;
  }

  _collectGoogleFormFields(data) {
    const fields = [];
    const seen = new Set();
    const visit = value => {
      if (!Array.isArray(value)) {
        return;
      }

      const label = typeof value[1] === 'string' ? value[1].trim() : '';
      const entries = Array.isArray(value[4]) ? value[4] : [];
      const entry = entries.find(item => Array.isArray(item) && Number.isFinite(Number(item[0])));
      const entryId = entry ? String(entry[0]) : '';
      if (label && entryId && !seen.has(entryId)) {
        seen.add(entryId);
        const type = this.formUnderstanding._inferFieldType(label);
        fields.push({
          name: label,
          label,
          id: entryId,
          entryId,
          type,
          required: entry?.[2] === 1 || entry?.[3] === 1 || false,
          source: 'google-form'
        });
      }

      for (const child of value) {
        visit(child);
      }
    };

    visit(data);
    return fields;
  }

  _normalizeGoogleFormViewUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname === 'forms.gle') {
      return parsed.href;
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname
      .replace(/\/formResponse$/i, '/viewform')
      .replace(/\/prefill$/i, '/viewform');
    if (!/\/viewform$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/+$/g, '') + '/viewform';
    }
    return parsed.href;
  }

  _copyWindowText(windowName) {
    const target = this.windows.findWindow?.(windowName, {
      preferredProcessNames: windowName ? [windowName] : [],
      preferredTitleTokens: windowName ? [windowName] : []
    });
    if (!target) {
      return '';
    }

    this.windows.sendKeys(windowName, '^a', {
      preferredProcessNames: windowName ? [windowName] : [],
      preferredTitleTokens: windowName ? [windowName] : []
    });
    this.windows.sendKeys(windowName, '^c', {
      preferredProcessNames: windowName ? [windowName] : [],
      preferredTitleTokens: windowName ? [windowName] : []
    });

    try {
      return execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Start-Sleep -Milliseconds 120; Get-Clipboard -Raw'
      ], {
        encoding: 'utf8',
        timeout: 5000
      });
    } catch (error) {
      return '';
    }
  }

  _pasteWindowText(windowName, text) {
    try {
      const encoded = Buffer.from(String(text || ''), 'utf16le').toString('base64');
      execFileSync('powershell.exe', [
        '-NoProfile',
        '-EncodedCommand',
        Buffer.from(`[Console]::InputEncoding=[Text.Encoding]::Unicode; Set-Clipboard -Value ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')))`, 'utf16le').toString('base64')
      ], {
        timeout: 5000
      });
    } catch (error) {
      return false;
    }

    const result = this.windows.sendKeys(windowName, '^v', {
      preferredProcessNames: windowName ? [windowName] : [],
      preferredTitleTokens: windowName ? [windowName] : []
    });
    return Boolean(result?.success);
  }

  validateAndConfirm(filledData, fields, options = {}) {
    const fieldRequirements = fields.map(f => ({
      name: f.name || f.label || f.id,
      type: this.formUnderstanding._inferFieldType(f.name || f.label || f.id),
      required: f.required || f.required === 'true' || f.required === true
    }));

    const validation = this.formUnderstanding.validateFilledData(filledData, fieldRequirements);

    const formAnalysis = {
      totalFields: fields.length,
      understoodFields: validation.filledCount,
      completionPercentage: fields.length > 0 ? Math.round((validation.filledCount / fields.length) * 100) : 0,
      missingFields: validation.results.filter(r => !r.valid && r.required).map(r => ({
        name: r.field,
        type: r.type,
        required: r.required
      }))
    };

    return {
      validation,
      formAnalysis,
      canSubmit: validation.valid && validation.requiredFilled === validation.totalRequired,
      report: this.formUnderstanding.generateCompletionReport(formAnalysis, validation)
    };
  }

  learnFromFill(previousData, correctedData, field) {
    if (!this.learningStore?.enabled) return null;

    const fieldType = this.formUnderstanding._inferFieldType(field);
    if (['password', 'confirmPassword', 'cvv', 'cardNumber'].includes(fieldType)) {
      return null;
    }

    const oldValue = previousData[field];
    const newValue = correctedData[field];
    if (oldValue === newValue || !newValue) return null;

    const factKey = fieldType === 'name' ? 'name' :
      fieldType === 'lastName' ? 'last_name' :
        fieldType;

    const result = this.learningStore.rememberUserFact(factKey, newValue, {
      source: 'form-correction'
    });

    if (result) {
      this._loadUserFacts();
    }

    return result;
  }

  extractFieldsFromPage(pageData) {
    if (!pageData || typeof pageData !== 'object') {
      return [];
    }

    const fields = [];

    if (Array.isArray(pageData.fields)) {
      fields.push(...pageData.fields);
    }

    if (Array.isArray(pageData.inputs)) {
      fields.push(...pageData.inputs);
    }

    if (Array.isArray(pageData.elements)) {
      for (const el of pageData.elements) {
        if (el.type === 'input' || el.type === 'select' || el.type === 'textarea') {
          fields.push({
            name: el.name || el.id || el.label || el.placeholder || '',
            label: el.label || el.placeholder || '',
            type: el.type,
            required: el.required || el.isRequired || false,
            value: el.value || ''
          });
        }
      }
    }

    if (Array.isArray(pageData.formFields)) {
      fields.push(...pageData.formFields);
    }

    if (Array.isArray(pageData)) {
      for (const item of pageData) {
        if (typeof item === 'object' && (item.name || item.label || item.id)) {
          fields.push(item);
        }
      }
    }

    return fields.filter((f, i, arr) => {
      const key = f.name || f.label || f.id || '';
      return key && arr.findIndex(x => (x.name || x.label || x.id) === key) === i;
    });
  }

  buildConfirmationMessage(fillResult, validationResult) {
    const messages = [];

    messages.push('Form auto-fill report, sir:');
    messages.push('');
    messages.push(`Fields filled: ${fillResult.filledFields.length} of ${fillResult.totalFields}`);

    if (fillResult.inferredFields.length > 0) {
      messages.push('');
      messages.push('Auto-filled from your profile:');
      for (const field of fillResult.inferredFields) {
        messages.push(`- ${field.field}: ${field.value}`);
      }
    }

    if (fillResult.skippedFields.length > 0) {
      messages.push('');
      messages.push('Fields needing your input:');
      for (const field of fillResult.skippedFields) {
        if (field.required) {
          messages.push(`- ${field.field} (required)`);
        }
      }
    }

    messages.push('');
    if (validationResult.validation.valid) {
      messages.push('Validation: All filled fields are valid.');
    } else {
      messages.push('Validation issues:');
      for (const error of validationResult.validation.errors) {
        messages.push(`- ${error}`);
      }
    }

    messages.push('');
    messages.push(validationResult.canSubmit ? 'Form is ready for submission.' : 'Please complete the missing required fields.');

    return messages.join('\n');
  }
}

module.exports = FormAutomation;
