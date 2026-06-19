const messagesEl = document.getElementById('messages');
const inputBox = document.getElementById('input-box');
const sendBtn = document.getElementById('send-btn');
const closeBtn = document.getElementById('close-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsNavButtons = document.querySelectorAll('.settings-nav-chip');
const settingsSections = document.querySelectorAll('[data-settings-section]');
const settingsFooterSection = document.getElementById('settings-footer-section');
const quickBtns = document.querySelectorAll('.chip-btn');
const themeGrid = document.getElementById('theme-grid');
const contactListEl = document.getElementById('contact-list');
const contactUsageEl = document.getElementById('contact-usage');
const contactAddBtn = document.getElementById('contact-add-btn');
const contactEditorStage = document.getElementById('contact-editor-stage');
const contactEditorTitleEl = document.getElementById('contact-editor-title');
const contactDeleteBtn = document.getElementById('contact-delete-btn');
const settingsStatusEl = document.getElementById('settings-status');
const modeGridEl = document.getElementById('mode-grid');
const modeUsageEl = document.getElementById('mode-usage');
const modeAddBtn = document.getElementById('mode-add-btn');

const CONTACT_LIMIT = 10;
const MODE_LIMIT = 5;
const MODE_APP_LIMIT = 5;

let isProcessing = false;
let pendingConfirmation = null;
let settingsSnapshot = null;
let selectedThemeId = 'midnight';
let selectedContactName = null;
let activeSettingsSection = null;
let isContactEditorOpen = false;
let hasRenderedWelcome = false;
let modeDrafts = [];

const fieldIds = {
  assistantDisplayName: 'assistant-display-name',
  assistantTitle: 'assistant-title',
  assistantHonorific: 'assistant-honorific',
  assistantActivationShortcut: 'assistant-activation-shortcut',
  assistantTtsVolume: 'assistant-tts-volume',
  assistantTtsRate: 'assistant-tts-rate',
  profileFullName: 'profile-full-name',
  profileEmail: 'profile-email',
  profilePhone: 'profile-phone',
  profileAddressLine1: 'profile-address-line1',
  profileCity: 'profile-city',
  profileState: 'profile-state',
  profilePostalCode: 'profile-postal-code',
  profileCountry: 'profile-country',
  profileCompany: 'profile-company',
  profileRole: 'profile-role',
  chatMaxHistory: 'chat-max-history',
  systemPermissionLevel: 'system-permission-level',
  contactName: 'contact-name',
  contactPhone: 'contact-phone',
  contactAliases: 'contact-aliases',
  contactMessagePlatform: 'contact-message-platform',
  contactCallPlatform: 'contact-call-platform',
  contactWhatsappUri: 'contact-whatsapp-uri'
};

function getAssistantDisplayName() {
  return settingsSnapshot?.settings?.assistant?.displayName || 'JARVIS';
}

function getHonorific() {
  return settingsSnapshot?.settings?.assistant?.honorific || 'sir';
}

function getActivationShortcut() {
  return settingsSnapshot?.settings?.chat?.activationShortcut || 'Alt+Space';
}

function assistantMeta(label = 'just now') {
  return `${getAssistantDisplayName()} - ${label}`;
}

function addMessage(text, type, meta) {
  const msg = document.createElement('div');
  msg.className = `message ${type}`;
  msg.appendChild(document.createTextNode(String(text || '')));
  if (meta) {
    const metaElement = document.createElement('div');
    metaElement.className = 'meta';
    metaElement.textContent = meta;
    msg.appendChild(metaElement);
  }
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing';
  el.id = 'typing-indicator';
  for (let index = 0; index < 3; index += 1) {
    el.appendChild(document.createElement('span'));
  }
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) {
    el.remove();
  }
}

function addConfirmationPrompt(result) {
  pendingConfirmation = {
    commandId: result.commandId,
    intent: result.intent,
    entities: result.entities
  };

  addMessage(
    result.response || `Please confirm this action, ${getHonorific()}.`,
    'system',
    `${getAssistantDisplayName()} - confirmation required`
  );
  speakAssistantResponse(result.response || `Please confirm this action, ${getHonorific()}.`);
}

function speakAssistantResponse(text) {
  const spokenText = String(text || '').trim();
  if (spokenText && window.jarvis?.speak) {
    window.jarvis.speak(spokenText);
  }
}

async function sendCommand(text) {
  if (!text.trim() || isProcessing) {
    return;
  }

  if (pendingConfirmation) {
    addMessage(text, 'user', 'You - just now');
    pendingConfirmation = null;
    isProcessing = true;
    showTyping();

    try {
      const result = await window.jarvis.processCommand(text, 'chat');
      hideTyping();
      if (result.requiresConfirmation) {
        addConfirmationPrompt(result);
      } else {
        const response = result.response || `Operation completed, ${getHonorific()}.`;
        addMessage(response, 'assistant', assistantMeta());
        speakAssistantResponse(response);
      }
    } catch (err) {
      hideTyping();
      addMessage(`Unable to complete that action, ${getHonorific()}.`, 'system', assistantMeta('error'));
    } finally {
      isProcessing = false;
      inputBox.focus();
    }
    return;
  }

  isProcessing = true;
  addMessage(text, 'user', 'You - just now');
  inputBox.value = '';
  showTyping();

  try {
    const result = await window.jarvis.processCommand(text, 'chat');
    hideTyping();

    if (result.requiresConfirmation) {
      addConfirmationPrompt(result);
      return;
    }

    const response = result.response || `Operation completed, ${getHonorific()}.`;
    addMessage(response, 'assistant', assistantMeta());
    speakAssistantResponse(response);
  } catch (err) {
    hideTyping();
    addMessage(`An error occurred, ${getHonorific()}.`, 'system', assistantMeta('error'));
  } finally {
    isProcessing = false;
    inputBox.focus();
  }
}

function handleSend() {
  const text = inputBox.value.trim();
  if (text) {
    sendCommand(text);
  }
}

function applyTheme(themeId) {
  if (!settingsSnapshot) {
    return;
  }

  const theme = (settingsSnapshot.availableThemes || []).find(entry => entry.id === themeId)
    || settingsSnapshot.availableThemes?.[0];
  if (!theme) {
    return;
  }

  selectedThemeId = theme.id;
  const root = document.documentElement;
  root.style.setProperty('--panel-bg', theme.colors.panel);
  root.style.setProperty('--surface-bg', theme.colors.surface);
  root.style.setProperty('--surface-strong', theme.colors.surfaceStrong);
  root.style.setProperty('--border-color', theme.colors.border);
  root.style.setProperty('--text-color', theme.colors.text);
  root.style.setProperty('--muted-color', theme.colors.muted);
  root.style.setProperty('--accent-color', theme.colors.accent);

  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.themeId === theme.id);
  });

  if (settingsSnapshot) {
    updateSettingsSummary();
  }
}

function renderThemeCards() {
  themeGrid.replaceChildren();
  const captions = {
    midnight: 'Cold glass, deep contrast, focused on commands.',
    dawn: 'Warm copper tones for a softer workspace.',
    forest: 'Calm green surfaces with lower visual glare.',
    graphite: 'Neutral slate palette for long sessions.'
  };
  (settingsSnapshot?.availableThemes || []).forEach(theme => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card';
    card.dataset.themeId = theme.id;
    const preview = document.createElement('div');
    preview.className = 'theme-preview';
    preview.style.background = `radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 30%), linear-gradient(160deg, rgba(255,255,255,0.06), transparent 35%), ${theme.colors.panel}`;
    preview.style.border = `1px solid ${theme.colors.border}`;

    const name = document.createElement('div');
    name.className = 'theme-name';
    name.textContent = theme.label;

    const caption = document.createElement('div');
    caption.className = 'theme-caption';
    caption.textContent = captions[theme.id] || theme.id;

    const selection = document.createElement('div');
    selection.className = 'theme-select';
    const themeId = document.createElement('span');
    themeId.className = 'section-note';
    themeId.textContent = theme.id;
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'theme-choice';
    radio.value = theme.id;
    selection.append(themeId, radio);
    card.append(preview, name, caption, selection);
    card.addEventListener('click', () => {
      applyTheme(theme.id);
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
      }
    });
    themeGrid.appendChild(card);
  });
}

function setFieldValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || '';
  }
}

function updateTtsSliderLabels() {
  const volumeEl = document.getElementById(fieldIds.assistantTtsVolume);
  const rateEl = document.getElementById(fieldIds.assistantTtsRate);
  const volumeValueEl = document.getElementById('assistant-tts-volume-value');
  const rateValueEl = document.getElementById('assistant-tts-rate-value');

  if (volumeEl && volumeValueEl) {
    volumeValueEl.textContent = `${volumeEl.value || 100}%`;
  }

  if (rateEl && rateValueEl) {
    const rate = Number(rateEl.value || 0);
    rateValueEl.textContent = rate > 0 ? `+${rate}` : String(rate);
  }
}

function populateSettingsForm() {
  const settings = settingsSnapshot?.settings;
  if (!settings) {
    return;
  }

  setFieldValue(fieldIds.assistantDisplayName, settings.assistant.displayName);
  setFieldValue(fieldIds.assistantTitle, settings.assistant.title);
  setFieldValue(fieldIds.assistantHonorific, settings.assistant.honorific);
  setFieldValue(fieldIds.assistantActivationShortcut, settings.chat.activationShortcut);
  setFieldValue(fieldIds.assistantTtsVolume, String(settings.voice?.tts?.volume ?? 100));
  setFieldValue(fieldIds.assistantTtsRate, String(settings.voice?.tts?.rate ?? 2));
  updateTtsSliderLabels();
  setFieldValue(fieldIds.profileFullName, settings.userProfile.fullName);
  setFieldValue(fieldIds.profileEmail, settings.userProfile.email);
  setFieldValue(fieldIds.profilePhone, settings.userProfile.phone);
  setFieldValue(fieldIds.profileAddressLine1, settings.userProfile.addressLine1);
  setFieldValue(fieldIds.profileCity, settings.userProfile.city);
  setFieldValue(fieldIds.profileState, settings.userProfile.state);
  setFieldValue(fieldIds.profilePostalCode, settings.userProfile.postalCode);
  setFieldValue(fieldIds.profileCountry, settings.userProfile.country);
  setFieldValue(fieldIds.profileCompany, settings.userProfile.company);
  setFieldValue(fieldIds.profileRole, settings.userProfile.role);
  setFieldValue(fieldIds.chatMaxHistory, String(settings.chat.maxHistory));
  setFieldValue(fieldIds.systemPermissionLevel, settings.system.permissionLevel);
  populateModeFields(settings.modes || []);

  renderThemeCards();
  applyTheme(settings.chat.themeId);

  const selectedThemeInput = document.querySelector(`input[name="theme-choice"][value="${settings.chat.themeId}"]`);
  if (selectedThemeInput) {
    selectedThemeInput.checked = true;
  }
}

function setActiveSettingsSection(sectionName) {
  activeSettingsSection = sectionName || null;

  settingsNavButtons.forEach(button => {
    const isActive = button.dataset.sectionTarget === activeSettingsSection;
    button.classList.toggle('active', isActive);
  });

  settingsSections.forEach(section => {
    section.classList.toggle('open', section.dataset.settingsSection === activeSettingsSection);
  });

  settingsFooterSection.classList.toggle('open', Boolean(activeSettingsSection));
}

function setContactEditorOpen(isOpen, mode = 'create') {
  isContactEditorOpen = Boolean(isOpen);
  contactEditorStage.classList.toggle('open', isContactEditorOpen);
  contactEditorTitleEl.textContent = mode === 'edit' ? 'Edit Contact' : 'Add Contact';
  contactDeleteBtn.style.display = mode === 'edit' ? 'inline-flex' : 'none';
}

function openNewContactEditor() {
  const contacts = settingsSnapshot?.contacts || [];
  if (contacts.length >= CONTACT_LIMIT) {
    setSettingsStatus(`Contact limit reached. Remove one of the ${CONTACT_LIMIT} saved contacts before adding another.`, 'error');
    return;
  }

  setActiveSettingsSection('contacts');
  selectedContactName = null;
  setFieldValue(fieldIds.contactName, '');
  setFieldValue(fieldIds.contactPhone, '');
  setFieldValue(fieldIds.contactAliases, '');
  setFieldValue(fieldIds.contactMessagePlatform, '');
  setFieldValue(fieldIds.contactCallPlatform, '');
  setFieldValue(fieldIds.contactWhatsappUri, '');
  setContactEditorOpen(true, 'create');
  renderContacts();
  document.getElementById(fieldIds.contactName).focus();
}

function renderContacts() {
  const contacts = settingsSnapshot?.contacts || [];
  contactListEl.replaceChildren();
  contactUsageEl.textContent = `${contacts.length} / ${CONTACT_LIMIT} saved`;
  contactAddBtn.disabled = contacts.length >= CONTACT_LIMIT;

  if (contacts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'section-note';
    empty.textContent = `No contacts saved yet. Press + to add one for ${getAssistantDisplayName()}.`;
    contactListEl.appendChild(empty);
    updateSettingsSummary();
    return;
  }

  contacts.forEach(contact => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'contact-item';
    if (selectedContactName && selectedContactName.toLowerCase() === contact.name.toLowerCase()) {
      button.classList.add('active');
    }
    const name = document.createElement('span');
    name.className = 'contact-name';
    name.textContent = contact.name;
    const phone = document.createElement('span');
    phone.className = 'contact-meta';
    phone.textContent = contact.phone || 'No phone saved';
    const aliases = document.createElement('span');
    aliases.className = 'contact-meta';
    aliases.textContent = (contact.aliases || []).join(', ') || 'No aliases';
    button.append(name, phone, aliases);
    button.addEventListener('click', () => fillContactForm(contact));
    contactListEl.appendChild(button);
  });

  if (settingsSnapshot) {
    updateSettingsSummary();
  }
}

function clearContactForm(options = {}) {
  const shouldOpenEditor = Boolean(options.openEditor);
  selectedContactName = null;
  setFieldValue(fieldIds.contactName, '');
  setFieldValue(fieldIds.contactPhone, '');
  setFieldValue(fieldIds.contactAliases, '');
  setFieldValue(fieldIds.contactMessagePlatform, '');
  setFieldValue(fieldIds.contactCallPlatform, '');
  setFieldValue(fieldIds.contactWhatsappUri, '');
  setContactEditorOpen(shouldOpenEditor, 'create');
  renderContacts();
}

function populateContactForm(contact, options = {}) {
  const shouldOpenEditor = options.openEditor !== false;
  selectedContactName = contact.name;
  setFieldValue(fieldIds.contactName, contact.name);
  setFieldValue(fieldIds.contactPhone, contact.phone);
  setFieldValue(fieldIds.contactAliases, (contact.aliases || []).join(', '));
  setFieldValue(fieldIds.contactMessagePlatform, contact.preferredMessagingPlatform || '');
  setFieldValue(fieldIds.contactCallPlatform, contact.preferredCallPlatform || '');
  setFieldValue(fieldIds.contactWhatsappUri, contact.whatsappCallUri || '');
  setContactEditorOpen(shouldOpenEditor, 'edit');
}

function fillContactForm(contact) {
  populateContactForm(contact, { openEditor: true });
  renderContacts();
}

function splitInstructionDraft(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeModeDrafts(modes) {
  return (Array.isArray(modes) ? modes : []).slice(0, MODE_LIMIT).map((mode, modeIndex) => {
    const apps = (Array.isArray(mode?.apps) ? mode.apps : [])
      .slice(0, MODE_APP_LIMIT)
      .map(app => {
        if (app && typeof app === 'object' && !Array.isArray(app)) {
          return {
            name: String(app.name || app.appName || '').trim(),
            instructions: Array.isArray(app.instructions)
              ? app.instructions.join('\n')
              : String(app.instructions || app.commands || '').trim()
          };
        }

        return {
          name: String(app || '').trim(),
          instructions: ''
        };
      })
      .filter(app => app.name || app.instructions);

    const legacyCommands = Array.isArray(mode?.commands) ? mode.commands.join('\n') : String(mode?.commands || '').trim();
    if (legacyCommands && apps.length > 0) {
      apps[0].instructions = [apps[0].instructions, legacyCommands].filter(Boolean).join('\n');
    }

    return {
      id: String(mode?.id || `mode-${modeIndex + 1}`),
      name: String(mode?.name || '').trim(),
      apps,
      commands: legacyCommands && apps.length === 0 ? legacyCommands : ''
    };
  });
}

function populateModeFields(modes) {
  modeDrafts = normalizeModeDrafts(modes);
  renderModeEditor();
}

function createEmptyMode() {
  return {
    id: `mode-${Date.now()}`,
    name: '',
    apps: [{ name: '', instructions: '' }],
    commands: ''
  };
}

function renderModeEditor() {
  modeGridEl.replaceChildren();
  modeUsageEl.textContent = `${modeDrafts.length} / ${MODE_LIMIT} saved`;
  modeAddBtn.disabled = modeDrafts.length >= MODE_LIMIT;

  if (modeDrafts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'section-note';
    empty.textContent = 'No modes saved yet. Press + to add one.';
    modeGridEl.appendChild(empty);
    return;
  }

  modeDrafts.forEach((mode, modeIndex) => {
    const row = document.createElement('div');
    row.className = 'mode-row';

    const header = document.createElement('div');
    header.className = 'mode-row-header';
    const title = document.createElement('div');
    title.className = 'mode-row-title';
    title.textContent = `Mode ${modeIndex + 1}`;
    const deleteModeBtn = document.createElement('button');
    deleteModeBtn.className = 'danger-btn';
    deleteModeBtn.type = 'button';
    deleteModeBtn.textContent = 'Delete';
    deleteModeBtn.addEventListener('click', () => {
      modeDrafts.splice(modeIndex, 1);
      renderModeEditor();
    });
    header.appendChild(title);
    header.appendChild(deleteModeBtn);
    row.appendChild(header);

    const nameLabel = document.createElement('label');
    nameLabel.className = 'field-wrap';
    const nameText = document.createElement('span');
    nameText.className = 'field-label';
    nameText.textContent = 'Mode Name';
    const nameInput = document.createElement('input');
    nameInput.className = 'field';
    nameInput.type = 'text';
    nameInput.placeholder = 'development';
    nameInput.value = mode.name || '';
    nameInput.addEventListener('input', () => {
      modeDrafts[modeIndex].name = nameInput.value;
    });
    nameLabel.appendChild(nameText);
    nameLabel.appendChild(nameInput);
    row.appendChild(nameLabel);

    const appHeader = document.createElement('div');
    appHeader.className = 'mode-app-header';
    const appTitle = document.createElement('div');
    appTitle.className = 'mode-row-title';
    appTitle.textContent = `Apps ${mode.apps.length} / ${MODE_APP_LIMIT}`;
    const addAppBtn = document.createElement('button');
    addAppBtn.className = 'secondary-btn';
    addAppBtn.type = 'button';
    addAppBtn.textContent = '+ App';
    addAppBtn.disabled = mode.apps.length >= MODE_APP_LIMIT;
    addAppBtn.addEventListener('click', () => {
      modeDrafts[modeIndex].apps.push({ name: '', instructions: '' });
      renderModeEditor();
    });
    appHeader.appendChild(appTitle);
    appHeader.appendChild(addAppBtn);
    row.appendChild(appHeader);

    const appList = document.createElement('div');
    appList.className = 'mode-app-list';
    mode.apps.forEach((app, appIndex) => {
      const appRow = document.createElement('div');
      appRow.className = 'mode-app-row';

      const appNameLabel = document.createElement('label');
      appNameLabel.className = 'field-wrap';
      const appNameText = document.createElement('span');
      appNameText.className = 'field-label';
      appNameText.textContent = `App ${appIndex + 1}`;
      const appInput = document.createElement('input');
      appInput.className = 'field';
      appInput.type = 'text';
      appInput.placeholder = 'youtube';
      appInput.value = app.name || '';
      appInput.addEventListener('input', () => {
        modeDrafts[modeIndex].apps[appIndex].name = appInput.value;
      });
      appNameLabel.appendChild(appNameText);
      appNameLabel.appendChild(appInput);

      const instructionLabel = document.createElement('label');
      instructionLabel.className = 'field-wrap';
      const instructionText = document.createElement('span');
      instructionText.className = 'field-label';
      instructionText.textContent = 'Instructions';
      const instructionInput = document.createElement('textarea');
      instructionInput.className = 'field field-textarea';
      instructionInput.placeholder = 'set volume to 100\nplay liked songs';
      instructionInput.value = app.instructions || '';
      instructionInput.addEventListener('input', () => {
        modeDrafts[modeIndex].apps[appIndex].instructions = instructionInput.value;
      });
      instructionLabel.appendChild(instructionText);
      instructionLabel.appendChild(instructionInput);

      const actions = document.createElement('div');
      actions.className = 'mode-inline-actions';
      const deleteAppBtn = document.createElement('button');
      deleteAppBtn.className = 'danger-btn';
      deleteAppBtn.type = 'button';
      deleteAppBtn.textContent = 'Delete App';
      deleteAppBtn.addEventListener('click', () => {
        modeDrafts[modeIndex].apps.splice(appIndex, 1);
        renderModeEditor();
      });
      actions.appendChild(deleteAppBtn);

      appRow.appendChild(appNameLabel);
      appRow.appendChild(instructionLabel);
      appRow.appendChild(actions);
      appList.appendChild(appRow);
    });
    row.appendChild(appList);

    modeGridEl.appendChild(row);
  });
}

function collectModesPayload() {
  return modeDrafts
    .slice(0, MODE_LIMIT)
    .map((mode, modeIndex) => ({
      id: mode.id || `mode-${modeIndex + 1}`,
      name: String(mode.name || '').trim(),
      apps: (mode.apps || []).slice(0, MODE_APP_LIMIT)
        .map(app => ({
          name: String(app.name || '').trim(),
          instructions: splitInstructionDraft(app.instructions)
        }))
        .filter(app => app.name),
      commands: splitInstructionDraft(mode.commands)
    }))
    .filter(mode => mode.name || mode.apps.length > 0 || mode.commands.length > 0);
}

function collectSettingsPayload() {
  return {
    assistant: {
      displayName: document.getElementById(fieldIds.assistantDisplayName).value.trim(),
      title: document.getElementById(fieldIds.assistantTitle).value.trim(),
      honorific: document.getElementById(fieldIds.assistantHonorific).value
    },
    voice: {
      tts: {
        volume: Number(document.getElementById(fieldIds.assistantTtsVolume).value || 100),
        rate: Number(document.getElementById(fieldIds.assistantTtsRate).value || 2)
      }
    },
    chat: {
      themeId: selectedThemeId,
      maxHistory: Number(document.getElementById(fieldIds.chatMaxHistory).value || 500),
      activationShortcut: document.getElementById(fieldIds.assistantActivationShortcut).value.trim()
    },
    userProfile: {
      fullName: document.getElementById(fieldIds.profileFullName).value.trim(),
      email: document.getElementById(fieldIds.profileEmail).value.trim(),
      phone: document.getElementById(fieldIds.profilePhone).value.trim(),
      addressLine1: document.getElementById(fieldIds.profileAddressLine1).value.trim(),
      city: document.getElementById(fieldIds.profileCity).value.trim(),
      state: document.getElementById(fieldIds.profileState).value.trim(),
      postalCode: document.getElementById(fieldIds.profilePostalCode).value.trim(),
      country: document.getElementById(fieldIds.profileCountry).value.trim(),
      company: document.getElementById(fieldIds.profileCompany).value.trim(),
      role: document.getElementById(fieldIds.profileRole).value.trim()
    },
    system: {
      permissionLevel: document.getElementById(fieldIds.systemPermissionLevel).value
    },
    modes: collectModesPayload()
  };
}

function collectContactPayload() {
  return {
    name: document.getElementById(fieldIds.contactName).value.trim(),
    phone: document.getElementById(fieldIds.contactPhone).value.trim(),
    aliases: document.getElementById(fieldIds.contactAliases).value.trim(),
    preferredMessagingPlatform: document.getElementById(fieldIds.contactMessagePlatform).value,
    preferredCallPlatform: document.getElementById(fieldIds.contactCallPlatform).value,
    whatsappCallUri: document.getElementById(fieldIds.contactWhatsappUri).value.trim()
  };
}

function updateBranding() {
  const assistantName = getAssistantDisplayName();
  const assistantTitle = settingsSnapshot?.settings?.assistant?.title || 'Desktop Assistant';
  document.getElementById('header-title').textContent = `${assistantName} Chat`;
  document.getElementById('header-subtitle').textContent = assistantTitle;
  document.title = `${assistantName} Chat`;
}

function updateSettingsSummary() {
  const assistantName = getAssistantDisplayName();
  const assistantTitle = settingsSnapshot?.settings?.assistant?.title || 'Desktop Assistant';
  const theme = (settingsSnapshot?.availableThemes || []).find(entry => entry.id === selectedThemeId)
    || (settingsSnapshot?.availableThemes || [])[0];
  const contactCount = settingsSnapshot?.contacts?.length || 0;

  document.getElementById('settings-hero-name').textContent = assistantName;
  document.getElementById('settings-hero-title').textContent = `${assistantTitle} configured for local automation, chat hotkey (${getActivationShortcut()}), profile storage, and contact-aware actions.`;
  document.getElementById('settings-hero-honorific').textContent = settingsSnapshot?.settings?.assistant?.honorific || 'sir';
  document.getElementById('settings-hero-theme').textContent = theme?.label || 'Theme';
  document.getElementById('settings-hero-contacts').textContent = `${contactCount} / ${CONTACT_LIMIT}`;
  document.getElementById('settings-hero-permission').textContent = settingsSnapshot?.settings?.system?.permissionLevel || 'medium';
}

function ensureWelcomeMessage() {
  if (hasRenderedWelcome) {
    return;
  }

  addMessage(
    `At your service, ${getHonorific()}. Press ${getActivationShortcut()} to open chat, or type a command here.`,
    'assistant',
    assistantMeta('ready')
  );
  hasRenderedWelcome = true;
}

function setSettingsStatus(message, tone = 'info') {
  const palette = {
    info: 'var(--muted-color)',
    success: 'var(--success-color)',
    error: 'var(--danger-color)'
  };
  settingsStatusEl.textContent = message || '';
  settingsStatusEl.style.color = palette[tone] || palette.info;
}

function applySnapshot(snapshot) {
  settingsSnapshot = snapshot;
  const selectedContact = settingsSnapshot?.contacts?.find(contact => (
    selectedContactName && contact.name.toLowerCase() === selectedContactName.toLowerCase()
  ));
  if (selectedContact) {
    populateContactForm(selectedContact, { openEditor: isContactEditorOpen });
  } else if (!isContactEditorOpen) {
    clearContactForm();
  }
  updateBranding();
  populateSettingsForm();
  renderContacts();
  updateSettingsSummary();
  ensureWelcomeMessage();
}

function openSettingsPanel() {
  setActiveSettingsSection(null);
  setContactEditorOpen(false, selectedContactName ? 'edit' : 'create');
  settingsOverlay.classList.add('open');
  setSettingsStatus('Settings are stored locally on this machine.', 'info');
}

function closeSettingsPanel() {
  settingsOverlay.classList.remove('open');
  inputBox.focus();
}

async function saveSettings() {
  try {
    setSettingsStatus('Saving settings...', 'info');
    const snapshot = await window.jarvis.saveSettings(collectSettingsPayload());
    applySnapshot(snapshot);
    setSettingsStatus('Settings saved successfully.', 'success');
    addMessage(`Settings updated. ${getAssistantDisplayName()} is ready, ${getHonorific()}.`, 'system', assistantMeta('settings'));
  } catch (err) {
    setSettingsStatus('Unable to save settings.', 'error');
  }
}

async function resetSettings() {
  try {
    setSettingsStatus('Resetting settings...', 'info');
    const snapshot = await window.jarvis.resetSettings();
    selectedContactName = null;
    setActiveSettingsSection(null);
    applySnapshot(snapshot);
    clearContactForm();
    setSettingsStatus('Settings reset to defaults.', 'success');
  } catch (err) {
    setSettingsStatus('Unable to reset settings.', 'error');
  }
}

async function saveContact() {
  const payload = collectContactPayload();
  if (!payload.name) {
    setSettingsStatus('Contact name is required.', 'error');
    return;
  }

  try {
    setSettingsStatus(`Saving contact ${payload.name}...`, 'info');
    const contacts = await window.jarvis.saveContact(payload);
    settingsSnapshot.contacts = contacts;
    selectedContactName = payload.name;
    renderContacts();
    fillContactForm(contacts.find(contact => contact.name.toLowerCase() === payload.name.toLowerCase()) || payload);
    setSettingsStatus(`Contact ${payload.name} saved.`, 'success');
  } catch (err) {
    setSettingsStatus(err?.message || 'Unable to save contact.', 'error');
  }
}

async function deleteContact() {
  const name = document.getElementById(fieldIds.contactName).value.trim() || selectedContactName;
  if (!name) {
    setSettingsStatus('Select a contact before deleting it.', 'error');
    return;
  }

  try {
    setSettingsStatus(`Deleting contact ${name}...`, 'info');
    const contacts = await window.jarvis.deleteContact(name);
    settingsSnapshot.contacts = contacts;
    clearContactForm();
    setSettingsStatus(`Contact ${name} deleted.`, 'success');
  } catch (err) {
    setSettingsStatus(err?.message || 'Unable to delete contact.', 'error');
  }
}

inputBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSend();
  }
});

document.getElementById(fieldIds.assistantTtsVolume).addEventListener('input', updateTtsSliderLabels);
document.getElementById(fieldIds.assistantTtsRate).addEventListener('input', updateTtsSliderLabels);

sendBtn.addEventListener('click', handleSend);
quickBtns.forEach(button => {
  button.addEventListener('click', () => {
    const command = button.dataset.cmd;
    if (command) {
      sendCommand(command);
    }
  });
});

closeBtn.addEventListener('click', () => window.close());
minimizeBtn.addEventListener('click', () => window.blur());
settingsBtn.addEventListener('click', openSettingsPanel);
settingsCloseBtn.addEventListener('click', closeSettingsPanel);
settingsNavButtons.forEach(button => {
  button.addEventListener('click', () => {
    const sectionName = button.dataset.sectionTarget;
    const nextSection = activeSettingsSection === sectionName ? null : sectionName;
    setActiveSettingsSection(nextSection);
    if (sectionName !== 'contacts' || nextSection === null) {
      setContactEditorOpen(false, selectedContactName ? 'edit' : 'create');
    }
  });
});
document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
document.getElementById('settings-reset-btn').addEventListener('click', resetSettings);
modeAddBtn.addEventListener('click', () => {
  if (modeDrafts.length >= MODE_LIMIT) {
    setSettingsStatus(`Mode limit reached. Remove one of the ${MODE_LIMIT} saved modes before adding another.`, 'error');
    return;
  }
  modeDrafts.push(createEmptyMode());
  renderModeEditor();
  setActiveSettingsSection('modes');
});
contactAddBtn.addEventListener('click', openNewContactEditor);
document.getElementById('contact-save-btn').addEventListener('click', saveContact);
document.getElementById('contact-delete-btn').addEventListener('click', deleteContact);
document.getElementById('contact-cancel-btn').addEventListener('click', () => clearContactForm());

settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) {
    closeSettingsPanel();
  }
});

if (window.jarvis) {
  window.jarvis.onSettingsChanged((snapshot) => {
    applySnapshot(snapshot);
  });
}

async function initialize() {
  const snapshot = await window.jarvis.getSettings();
  applySnapshot(snapshot);
  inputBox.focus();
}

initialize();
