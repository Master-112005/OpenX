# Assistant Communication Policy

## Purpose

This module defines how the assistant speaks to the user. The policy is enforced centrally so every success, error, confirmation, and informational message stays consistent.

## Rules

- Default formal address: `sir`
- Allowed configurable honorifics: `sir`, `master`, `boss`, `commander`
- No casual slang
- No fabricated success messages
- Failures must state the real reason when one is available

## Implementation

- Response templates live in `core/assistant/responses.js`
- Formal address enforcement lives in `core/assistant/responses.js`
- Any new response template should return the core sentence only
- The style layer appends the configured honorific automatically
