# OpenX Current Implementation Report

**Project:** OpenX

**Package version:** 1.0.2

**Platform:** Windows desktop

**Runtime:** Electron 28 and Node.js

**Report date:** 2026-06-22

## 1. Executive summary

OpenX is a deterministic, local-first Windows desktop assistant. The current implementation uses a flat production architecture with dedicated assistant-language layers, domain automation controllers, context awareness, active learning, secured Electron integration, and restricted external plugins.

The previous directory-per-controller architecture has been removed. Implementations now live directly in the files documented below; there are no compatibility facades pointing back to the removed core structure.

The assistant processes commands through NLP, NLU, parsing, entity extraction, intent resolution, validation, permissions, Natural Language Execution (NLE), automation, verification, confirmation, response generation, context, and active learning. The language regression corpus contains **2,102 commands**, all of which are classified by the sandbox corpus test.

Classification does not mean every requested operating-system feature is implemented. OpenX explicitly distinguishes successful execution, clarification, and recognized-but-unconnected capabilities.

## 2. Objectives

The implementation is designed to provide:

- predictable Windows automation from conversational language;
- typo, spelling, filler-word, abbreviation, and noisy-input handling;
- multi-command planning and sequential execution;
- clear intent and entity boundaries;
- validation before execution and verification after execution;
- permission-aware confirmation for sensitive actions;
- bounded context and privacy-conscious active learning;
- external integrations through isolated, restricted plugins;
- one consistent response contract across chat and voice-derived text;
- testable routing without real desktop side effects.

## 3. Current architecture

```text
Input
  -> NLP
  -> NLU and context
  -> parser and entities
  -> intent resolution
  -> action validation
  -> permission/confirmation gate
  -> NLE
  -> automation or plugin action
  -> postcondition verification
  -> action confirmation
  -> response and personality
  -> context and active-learning record
  -> OpenX_Data persistence
```

The main implementation files are:

| Layer | File | Responsibility |
|---|---|---|
| Assistant entry | `core/assistant/index.js` | Conversation state, clarification, confirmation, learning, and response lifecycle |
| NLP | `core/assistant/nlp/nlp.js` | Normalization, spelling repair, command preparation, and caching |
| NLP preprocessing | `core/assistant/nlp/preprocessor.js` | Phrase repair, token correction, filler removal, and vocabulary |
| NLU | `core/assistant/nlu.js` | Semantic frames, app/browser language, and context interpretation |
| Parser | `core/assistant/parser.js` | Input parsing and word-level command frames |
| Entities | `core/assistant/entities.js` | Structured values, paths, apps, contacts, times, and targets |
| Intents | `core/assistant/intents.js` | Intent definitions, patterns, permissions, and action mapping |
| Router | `core/assistant/router.js` | Multi-command planning, intent completion, routing, and safe fallback classification |
| Validation | `core/automation/common/action-velidation.js` | Required-entity validation before execution |
| NLE | `core/assistant/nle.js` | The assistant-to-automation execution boundary |
| Verification | `core/automation/common/action-verification.js` | Result validation and postcondition verification |
| Confirmation | `core/automation/common/action-confirm.js` | Normalized completion evidence |
| Context | `core/assistant/context.js`, `core/assistant/contest.js` | Session history and context-engine access |
| Learning | `core/assistant/Active-learning.js` | Corrections, preferences, user facts, feedback, and routing evidence |
| Responses | `core/assistant/responses.js`, `core/assistant/personality.js` | Human-readable responses and configurable address style |
| Data | `core/assistant/Data.js` | Logging, events, normalization utilities, atomic JSON storage, and data-root management |

## Automation capabilities

Connected controllers are implemented directly in `core/automation/`:

- `apps.js`: open, focus, switch, close, and create new application tabs/windows.
- `files.js`: create, open, delete, rename, copy, move, search, list, and smart discovery.
- `folders.js`: create, open, delete, and move folders.
- `browser.js`: URLs, searches, site searches, results, and browser tabs.
- `media.js`: playback, search, pause/resume, track navigation, volume, fullscreen, repeat, shuffle, likes, subscriptions, and status.
- `scheduler.js`: timers, alarms, and reminders.
- `communications.js`: message drafts, email drafts, and contact-aware calls.
- `system.js`: CPU, memory, battery, disk, processes, calculations, date/time, system insights, and Bluetooth settings.
- `windows.js`: minimize, maximize, close, lock, sleep, restart, shutdown, hibernate, and session operations.
- `volume.js` and `brightness.js`: read and change system levels, mute, and unmute.
- `screenshot-recording.js`: connected screenshot capture. Screen-recording language is recognized separately when no recorder is connected.
- `index.js`: action registry, controller composition, modes, execution, and verification.

## Command behavior

OpenX distinguishes three outcomes:

1. **Executable** — the intent has a connected automation action and all required entities; it proceeds through permissions, NLE, and verification.
2. **Needs clarification** — the intent is understood but required values are missing; `needsClarification` is returned and nothing executes.
3. **Recognized but unsupported** — the domain and operation are understood but no controller is connected; the assistant returns `assistant.capability` with an explicit limitation message.

This contract prevents broad language coverage from becoming false execution reporting.

## Multi-command handling

The router splits actionable clauses, preserves verbs across compatible follow-up clauses, executes steps in sequence, stops for required confirmation, and resumes remaining steps after confirmation. It avoids splitting ordinary phrases that contain “and” but represent a single target.

Examples:

```text
Open Chrome, search for Java tutorials, and open the first result.
Close Chrome and set the volume to 50.
Create a project folder, create a file inside it, and open the file.
```

## Plugins

Plugin loading is managed by `plugins/plugin-controller.js`.

Loadable plugins must:

- have a trusted manifest;
- use `plugin.<id>.*` action and intent namespaces;
- declare permission levels;
- declare each core automation action they may call through `usesAutomation`;
- remain within the configured plugin directory.

Current plugin packages:

- `plugins/youtube/`: YouTube-specific navigation backed by browser/media automation.
- `plugins/chrome/`: Chrome-specific pages such as browser history.
- `plugins/discord/`: Discord application integration.
- `plugins/forms/`: Google Form and generic form understanding/filling.
- `plugins/communications/`: contacts and WhatsApp Desktop support.
- `plugins/sample_plugin/`: minimal plugin API example.

## Context and learning

OpenX tracks recent commands, searches, applications, conversation topics, and clarification/confirmation state. Active learning can retain corrections, preferences, non-sensitive user facts, feedback, routing evidence, and reusable command sequences.

Learning never bypasses permission checks, validation, or verification. Sensitive credentials are rejected from learned user facts.

## 8. Data and persistence

The managed data root is:

```text
%USERPROFILE%\OpenX_Data\
```

`core/assistant/Data.js` owns the data layout, atomic JSON writes, backups, logging helpers, and migration from the legacy `%USERPROFILE%\.jarvis` location. Settings, contacts, learning state, schedules, logs, media state, screenshots, and runtime files share the same managed root.

## Desktop application

The Electron application lives in `apps/desktop/`:

- `electron/main.js`: lifecycle, IPC, tray, shortcuts, windows, and assistant initialization.
- `electron/security.js`: trusted renderer checks, payload validation, and secure web preferences.
- `electron/crash-recovery.js`: bounded renderer restart and crash state.
- `preload.js`: narrow renderer API bridge.
- `settings.js`: settings, profiles, themes, modes, and contacts.
- `permissions.js`: permission levels, throttling, and confirmation requirements.
- `voice/tts.js`: Windows SAPI text-to-speech output.
- `renderer/chat/`: primary chat and settings interface.
- `renderer/alert/`: dedicated timer/reminder alert window.

Renderer code cannot execute automation directly. Commands and confirmations cross validated IPC boundaries.

## Installation

Requirements:

- Windows 10 or Windows 11
- Node.js 18 or newer
- npm

```powershell
npm install
npm start
```

Development mode:

```powershell
npm run dev
```

## Testing

```powershell
npm test
npm run test:core
npm run test:automation
npm run lint
npx mocha tests/core/command-corpus.test.js --reporter dot
```

Current verification evidence:

- ESLint completes successfully.
- The 2,102-command sandbox corpus passes with every command classified.
- Router, assistant, architecture, security, UI, media, settings, and plugin tests pass in focused runs.
- The latest full run reached 512 passing tests and exposed one environment-dependent app-launch test because a real Chrome window was visible. That test was isolated from live window state and its focused rerun passes.
- `git diff --check` completes without whitespace errors.

The full test suite intentionally logs expected errors for negative tests such as unknown actions, unsafe paths, and invalid plugins.

## 12. Knowledge graph

The graphify graph was rebuilt after the implementation changes. The latest recorded update contains:

- **1,218 nodes**;
- **2,650 edges**;
- **84 communities**.

The highest-connectivity abstractions remain `ActionRouter`, `Assistant`, `MediaController`, `ContextManager`, `EntityExtractor`, `AppController`, `ActiveLearningStore`, and `SystemController`.

The graph still identifies `ActionRouter` as a god node. This is a maintainability risk, but splitting it must preserve resolver precedence, multi-command behavior, clarification, and fallback semantics.

## 13. Packaging

`npm run build` invokes Electron Builder for Windows x64 and creates an NSIS installer. The package includes application, core, and plugin code inside an ASAR archive. Tests, docs, graph output, and development metadata are excluded.

## 14. Known limitations

- Some command-corpus operations are classified but intentionally reported as unconnected capabilities.
- Screen capture is connected; full screen recording is not currently connected to a recorder controller.
- Messaging and call behavior depends on installed applications, saved contacts, and available URI/desktop integration.
- Browser tab discovery and control depend on visible windows, UI Automation, or an available debugging endpoint.
- Application-launch observations can vary when a target application is already open.
- Research and other workspace modes require corresponding user mode configuration to perform useful startup actions.
- The router remains large and should only be decomposed with resolver-precedence regression coverage.

## 15. Recommended next work

1. Connect high-value recognized capabilities from `commands.md` to real controllers, prioritizing screen recording, update management, archives/backups, notifications, and richer communication controls.
2. Add explicit corpus expectations for executable, clarification, and unsupported outcomes instead of checking intent classification alone.
3. Decompose `ActionRouter` into domain resolver modules while retaining one orchestrator and the current ordering contract.
4. Add plugin-specific integration tests for Chrome, YouTube, and Discord actions.
5. Add deterministic mocks for all tests that can observe live Windows applications.

## 16. Conclusion

OpenX now has the requested flat architecture and a connected assistant execution pipeline. It provides broad natural-language classification, deterministic automation for connected actions, safe clarification for missing details, explicit unsupported responses, restricted plugins, active learning, secured Electron IPC, managed persistence, and a large sandbox command corpus.

The next engineering priority is not broader generic recognition; it is converting the most valuable recognized capabilities into verified, real automation controllers while preserving the current safety contract.
