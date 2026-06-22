# Communications Module

## Purpose

Communication actions are stateless. The assistant uses recipient data supplied in the current command and does not save or resolve an address book.

Supported paths:

- WhatsApp Desktop messages and voice calls by an explicitly supplied chat name
- `wa.me` message drafts when an explicit phone number is supplied
- `tel:` standard calls when an explicit phone number is supplied
- `mailto:` drafts when an explicit email address is supplied

## Files

- `core/automation/communications.js`
- `plugins/communications/whatsapp-desktop.js`

## Workflow

1. Parser and router resolve `message.send`, `email.compose`, or `call.start`.
2. Entity extraction captures the recipient, content, and optional platform.
3. The controller validates the direct recipient value.
4. It executes the matching desktop or URI integration and returns verified result data.

Named WhatsApp chats depend on the installed WhatsApp Desktop application. Standard calls and email drafts require a phone number or email address directly in the command. No recipient data is persisted by this module, settings, IPC, or active-learning routing evidence.
