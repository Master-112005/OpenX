# Communications Module

## Purpose

This module handles contact-based communication actions through the shared assistant pipeline. It supports:

- sending WhatsApp desktop messages by contact name
- preparing WhatsApp message drafts for saved contacts as a fallback path
- starting WhatsApp desktop voice calls by contact name
- starting standard phone calls for saved contacts
- returning explicit failures when a safe delivery path is not available

## Files

- `core/automation/communications.js`
- `plugins/communications/contact-store.js`

## Contact Source

The assistant reads contacts from `assistant.contactsPath`.

Default path:

- `%USERPROFILE%\\OpenX_Data\\contacts.json`

Supported structure:

```json
{
  "daddy": {
    "phone": "+919876543210",
    "aliases": ["dad"],
    "preferredMessagingPlatform": "whatsapp",
    "preferredCallPlatform": "phone"
  }
}
```

Saved contacts are optional for WhatsApp desktop actions. If a contact is not present in `contacts.json`, the assistant can still try to drive the installed WhatsApp Desktop app by chat name.

## Workflow

1. The parser and router resolve `message.send` or `call.start`.
2. Entity extraction captures `contactName`, `messageText`, and optional `platform`.
3. The communication controller resolves the contact through the contact store.
4. The controller selects the safest execution path:
   - WhatsApp Desktop automation for contact-name message sending
   - `https://wa.me/<digits>?text=<message>` for WhatsApp message drafts when phone-number fallback is available
   - WhatsApp Desktop automation for contact-name voice calls
   - `tel:<number>` for standard phone calls
5. If the request cannot be completed safely or deterministically, the module returns a clear failure.

## Notes

- WhatsApp Desktop automation is attempted only through the shared automation layer, never directly from the UI.
- Saved phone numbers remain the deterministic fallback for message drafts and standard phone calls.
- If WhatsApp Desktop automation cannot activate the chat window, the module reports a clear failure instead of claiming delivery.
