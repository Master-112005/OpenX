const fs = require('fs');
const path = require('path');
const Normalizer = require('../../shared/index').Normalizer;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneResult(result) {
  if (!isPlainObject(result)) {
    return { success: false, error: 'Action returned an invalid result' };
  }

  return {
    ...result,
    data: isPlainObject(result.data) ? { ...result.data } : result.data
  };
}

function ok(check, detail = {}) {
  return { status: 'passed', check, ...detail };
}

function fail(check, detail = {}) {
  return { status: 'failed', check, ...detail };
}

function warn(check, detail = {}) {
  return { status: 'unknown', check, ...detail };
}

class ActionVerifier {
  constructor(controllers = {}) {
    this.controllers = controllers;
  }

  verify(actionId, entities = {}, result = {}) {
    const verified = cloneResult(result);
    const validation = this._validate(actionId, entities, verified);
    const verification = this._verify(actionId, entities, verified);

    verified.validation = validation;
    verified.verification = verification;
    if (isPlainObject(verified.data)) {
      verified.data.validation = validation;
      verified.data.verification = verification;
    }

    if (verified.success && verification.status === 'failed' && verification.blocking !== false) {
      verified.success = false;
      verified.error = verification.message || `Could not verify ${actionId}`;
    }

    return verified;
  }

  _validate(actionId, entities, result) {
    if (!result.success) {
      return warn('result-success', { reason: result.error || 'action failed before validation' });
    }

    const required = this._requiredFields(actionId);
    const missing = required.filter(field => !this._hasValue(entities[field]));
    if (missing.length > 0) {
      return fail('required-entities', {
        missing,
        message: `Missing required value: ${missing.join(', ')}`
      });
    }

    if (actionId.startsWith('browser.') && this._hasValue(result.data?.url) && !this._looksLikeUrl(result.data.url)) {
      return fail('result-url', { message: `Invalid URL returned: ${result.data.url}` });
    }

    if (actionId === 'system.calculate' && !Number.isFinite(Number(result.data?.result))) {
      return fail('calculation-result', { message: 'Calculation did not produce a finite number' });
    }

    return ok('required-entities');
  }

  _verify(actionId, entities, result) {
    if (!result.success) {
      return warn('postcondition', { reason: result.error || 'action failed before verification' });
    }

    if (result.data?.verified === true) {
      return ok('controller-verification', { method: 'controller', target: this._targetLabel(actionId, entities, result) });
    }
    if (result.data?.verified === false) {
      return fail('controller-verification', {
        method: 'controller',
        target: this._targetLabel(actionId, entities, result),
        message: result.error || 'Controller could not verify the action'
      });
    }

    if (actionId.startsWith('file.')) {
      return this._verifyFileAction(actionId, result);
    }

    if (actionId.startsWith('folder.')) {
      return this._verifyFolderAction(actionId, result);
    }

    if (actionId === 'app.open') {
      return this._verifyAppOpen(entities, result);
    }

    if (actionId === 'app.close') {
      return this._verifyAppClose(entities, result);
    }

    if (actionId.startsWith('browser.')) {
      return this._verifyBrowserAction(actionId, result);
    }

    if (actionId.startsWith('volume.') || actionId.startsWith('brightness.')) {
      return Number.isFinite(Number(result.data?.value))
        ? ok('device-value', { value: Number(result.data.value) })
        : warn('device-value', { reason: 'No readable value returned', blocking: false });
    }

    if (actionId.startsWith('window.')) {
      return result.data?.matchedWindow
        ? ok('window-target', { matchedWindow: result.data.matchedWindow, method: 'window-session' })
        : warn('window-target', { reason: 'Window command was dispatched without a readable target', blocking: false });
    }

    if (actionId.startsWith('system.')) {
      return this._verifySystemAction(actionId, result);
    }

    if (actionId.startsWith('media.')) {
      return result.data?.action || result.data?.mediaQuery || result.data?.videoId
        ? ok('media-command', { method: 'controller-result' })
        : warn('media-command', { reason: 'Media command was dispatched without a readable playback state', blocking: false });
    }

    if (actionId.startsWith('timer.') || actionId.startsWith('alarm.') || actionId.startsWith('reminder.')) {
      const dueAt = Date.parse(result.data?.dueAt || '');
      return Number.isFinite(dueAt) && dueAt > Date.now()
        ? ok('scheduled-time', { dueAt: result.data.dueAt })
        : fail('scheduled-time', { message: 'Scheduled task does not have a future due time' });
    }

    if (actionId === 'message.compose' || actionId === 'email.compose' || actionId === 'call.start') {
      return this._verifyCommunicationAction(actionId, result);
    }

    return warn('postcondition', {
      reason: 'No concrete postcondition is available for this action',
      blocking: false
    });
  }

  _verifySystemAction(actionId, result) {
    const data = result.data || {};
    if (actionId === 'system.calculate') {
      return Number.isFinite(Number(data.result))
        ? ok('calculation-result', { result: Number(data.result) })
        : fail('calculation-result', { message: 'Calculation did not produce a finite number' });
    }

    if (['system.time', 'system.date', 'system.cpu', 'system.memory', 'system.battery', 'system.disk', 'system.status', 'system.processes', 'system.insight'].includes(actionId)) {
      return Object.keys(data).length > 0
        ? ok('system-read', { fields: Object.keys(data) })
        : warn('system-read', { reason: 'No system data returned', blocking: false });
    }

    if (actionId === 'system.bluetooth') {
      return data.available === false
        ? fail('bluetooth-state', { message: 'Bluetooth device not found' })
        : ok('bluetooth-state', { enabled: data.enabled, status: data.status });
    }

    return warn('system-postcondition', {
      reason: 'System command was dispatched; Windows does not expose a safe immediate postcondition here',
      blocking: false
    });
  }

  _verifyFileAction(actionId, result) {
    const data = result.data || {};
    const target = data.path || data.newPath || data.destination;
    const source = data.source || data.oldPath;

    if (actionId === 'file.delete') {
      return source || data.path
        ? (!fs.existsSync(source || data.path)
            ? ok('file-deleted', { path: source || data.path })
            : fail('file-deleted', { path: source || data.path, message: 'File still exists after delete' }))
        : warn('file-deleted', { reason: 'No deleted path returned', blocking: false });
    }

    if (actionId === 'file.move') {
      if (!target) return warn('file-moved', { reason: 'No destination returned', blocking: false });
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return fail('file-moved', { path: target, message: 'Destination file was not found after move' });
      }
      if (source && fs.existsSync(source)) {
        return fail('file-moved', { path: source, message: 'Source file still exists after move' });
      }
      return ok('file-moved', { path: target });
    }

    if (actionId === 'file.copy' || actionId === 'file.rename' || actionId === 'file.create') {
      if (!target) return warn('file-exists', { reason: 'No target path returned', blocking: false });
      return fs.existsSync(target) && fs.statSync(target).isFile()
        ? ok('file-exists', { path: target })
        : fail('file-exists', { path: target, message: 'Expected file was not found' });
    }

    if (actionId === 'file.open') {
      return data.path && fs.existsSync(data.path) && fs.statSync(data.path).isFile()
        ? ok('file-target', { path: data.path })
        : fail('file-target', { path: data.path, message: 'Opened file target no longer exists' });
    }

    if (actionId === 'file.search' || actionId === 'file.list') {
      return Number.isFinite(Number(data.count))
        ? ok('result-count', { count: Number(data.count) })
        : warn('result-count', { reason: 'No result count returned', blocking: false });
    }

    return warn('file-postcondition', { blocking: false });
  }

  _verifyFolderAction(actionId, result) {
    const data = result.data || {};
    const target = data.path || data.destination;
    const source = data.source;

    if (actionId === 'folder.delete') {
      return target
        ? (!fs.existsSync(target)
            ? ok('folder-deleted', { path: target })
            : fail('folder-deleted', { path: target, message: 'Folder still exists after delete' }))
        : warn('folder-deleted', { reason: 'No deleted path returned', blocking: false });
    }

    if (actionId === 'folder.move') {
      if (!target) return warn('folder-moved', { reason: 'No destination returned', blocking: false });
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        return fail('folder-moved', { path: target, message: 'Destination folder was not found after move' });
      }
      if (source && fs.existsSync(source)) {
        return fail('folder-moved', { path: source, message: 'Source folder still exists after move' });
      }
      return ok('folder-moved', { path: target });
    }

    if (actionId === 'folder.create' || actionId === 'folder.open') {
      return target && fs.existsSync(target) && fs.statSync(target).isDirectory()
        ? ok('folder-exists', { path: target })
        : fail('folder-exists', { path: target, message: 'Expected folder was not found' });
    }

    return warn('folder-postcondition', { blocking: false });
  }

  _verifyAppOpen(entities, result) {
    const appName = Normalizer.normalizeText(result.data?.app || result.data?.appName || entities.appName || '');
    if (result.data?.launchMethod === 'folder' && result.data?.path) {
      return fs.existsSync(result.data.path)
        ? ok('folder-fallback-target', { path: result.data.path })
        : fail('folder-fallback-target', { path: result.data.path, message: 'Folder fallback target does not exist' });
    }

    const found = this._findAppWindowOrProcess(appName);
    if (found) {
      return ok('app-open', { app: appName, matchedWindow: found.title || found.MainWindowTitle || '', processName: found.processName || found.ProcessName || '' });
    }

    return warn('app-open', {
      app: appName,
      reason: 'The launch was dispatched, but no matching visible process was available yet',
      blocking: false
    });
  }

  _verifyAppClose(entities, result) {
    const appName = Normalizer.normalizeText(result.data?.app || entities.appName || '');
    const found = this._findAppWindowOrProcess(appName);
    return found
      ? fail('app-closed', {
          app: appName,
          matchedWindow: found.title || found.MainWindowTitle || '',
          message: `${appName} still appears to be open`
        })
      : ok('app-closed', { app: appName });
  }

  _verifyBrowserAction(actionId, result) {
    const data = result.data || {};
    if (actionId === 'browser.listTabs') {
      return Number.isFinite(Number(data.count))
        ? ok('browser-tabs-read', { count: Number(data.count), limitation: data.limitation })
        : warn('browser-tabs-read', { reason: 'No browser tab count returned', blocking: false });
    }

    if (data.url && this._looksLikeUrl(data.url)) {
      return ok('browser-target-url', { url: data.url, method: 'launch-dispatch' });
    }

    if (actionId === 'browser.search' && data.background) {
      return Array.isArray(data.results)
        ? ok('background-search-results', { count: data.results.length })
        : warn('background-search-results', { reason: 'No search results array returned', blocking: false });
    }

    return warn('browser-postcondition', { blocking: false });
  }

  _verifyCommunicationAction(actionId, result) {
    const data = result.data || {};
    if (actionId === 'email.compose') {
      if (data.needsDetails) {
        return ok('email-contact-resolved', { contactName: data.contactName, email: data.email });
      }
      return data.url && /^mailto:/i.test(data.url)
        ? ok('email-draft-uri', { contactName: data.contactName, email: data.email })
        : fail('email-draft-uri', { message: 'Email draft did not produce a mailto URL' });
    }

    if (actionId === 'message.compose') {
      return data.contactName || data.messageText || data.url
        ? ok('message-draft', { contactName: data.contactName, platform: data.platform })
        : warn('message-draft', { reason: 'No message draft data returned', blocking: false });
    }

    if (actionId === 'call.start') {
      return data.contactName || data.url
        ? ok('call-target', { contactName: data.contactName, platform: data.platform })
        : warn('call-target', { reason: 'No call target data returned', blocking: false });
    }

    return warn('communication-postcondition', { blocking: false });
  }

  _findAppWindowOrProcess(appName) {
    if (!appName) {
      return null;
    }

    const windows = this.controllers.windows?.listWindows?.() || [];
    const normalized = Normalizer.normalizeText(appName);
    const windowMatch = windows.find(window => {
      const title = Normalizer.normalizeText(window.title || '');
      const processName = Normalizer.normalizeText(window.processName || '');
      return title.includes(normalized) || processName.includes(normalized) || normalized.includes(processName);
    });
    if (windowMatch) {
      return windowMatch;
    }

    const apps = this.controllers.apps;
    if (apps && typeof apps._findRunningProcesses === 'function' && typeof apps._resolveProcessCandidates === 'function') {
      const candidates = apps._resolveProcessCandidates(normalized);
      const processes = apps._findRunningProcesses(normalized, candidates);
      return Array.isArray(processes) ? processes[0] : null;
    }

    return null;
  }

  _requiredFields(actionId) {
    const map = {
      'app.open': ['appName'],
      'app.close': ['appName'],
      'app.switch': ['appName'],
      'file.create': ['filename'],
      'file.open': ['filename'],
      'file.delete': ['filename'],
      'file.rename': ['oldName', 'newName'],
      'file.copy': ['source', 'destination'],
      'file.move': ['source', 'destination'],
      'file.search': ['query'],
      'folder.create': ['folderName'],
      'folder.delete': ['folderName'],
      'folder.open': ['folderName'],
      'folder.move': ['source', 'destination'],
      'browser.open': ['url'],
      'browser.search': ['query'],
      'browser.siteSearch': ['site', 'query'],
      'system.insight': ['insightType'],
      'media.play': ['mediaQuery'],
      'message.compose': ['contactName', 'messageText'],
      'email.compose': ['contactName'],
      'call.start': ['contactName'],
      'timer.set': ['duration'],
      'alarm.set': ['timeExpression'],
      'reminder.set': ['reminderText'],
      'system.calculate': ['expression'],
      'window.minimize': ['windowName'],
      'window.maximize': ['windowName'],
      'window.close': ['windowName']
    };
    return map[actionId] || [];
  }

  _targetLabel(actionId, entities, result) {
    return result.data?.path ||
      result.data?.url ||
      result.data?.app ||
      result.data?.browserName ||
      entities.appName ||
      entities.query ||
      actionId;
  }

  _hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  _looksLikeUrl(value) {
    const source = String(value || '').trim();
    if (/^(?:https?|mailto|chrome|edge|about|file):/i.test(source)) {
      return true;
    }
    try {
      new URL(source);
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = ActionVerifier;
