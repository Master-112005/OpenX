# Settings Module

## Purpose

This module persists assistant identity, user profile details, voice preferences, chat appearance, permission level, and app modes. It does not store contacts.

## Files

- `apps/desktop/settings.js`
- `apps/desktop/electron/main.js`
- `apps/desktop/preload.js`
- `apps/desktop/renderer/chat/index.html`

## Workflow

1. Electron builds runtime configuration from base configuration and persisted settings.
2. The assistant and voice manager initialize from that configuration.
3. The renderer loads a validated settings snapshot through IPC.
4. Saving settings writes them locally and reloads runtime services when needed.

Settings are stored in `%USERPROFILE%\\OpenX_Data\\settings.json`. Active-learning memory uses `learning.json`; there is no contacts file, contact IPC API, or contact editor.
