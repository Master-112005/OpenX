# Settings Module

## Purpose

This module provides persistent assistant settings for:

- assistant identity and honorifics
- user profile details for future form-filling workflows
- chat theme selection
- contact management

## Files

- `core/settings/index.js`
- `core/automation/communications/contact-store.js`
- `apps/desktop/electron/main.js`
- `apps/desktop/preload/index.js`
- `apps/desktop/renderer/chat/index.html`

## Workflow

1. Electron starts and builds a runtime config from the base config plus persisted settings.
2. The assistant and voice manager are initialized from that runtime config.
3. The chat window loads the settings snapshot through IPC.
4. The user can update assistant identity, user profile, theme, and contacts from the in-chat settings panel.
5. Saving settings persists them locally and reloads runtime services when needed.

## Notes

- Settings are stored locally in `%USERPROFILE%\\.jarvis\\settings.json`.
- Contacts continue to live in `%USERPROFILE%\\.jarvis\\contacts.json`.
- User profile details are stored for deterministic reuse by future automation modules that need personal form data.
