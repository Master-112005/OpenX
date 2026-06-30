# OpenX

OpenX is a Windows desktop assistant built with Electron and Node.js. It provides deterministic, local-first natural-language routing for desktop automation, browser control, files and folders, media, scheduling, communications, system information, and external application plugins.

The product name is **OpenX**. The default configurable assistant display name remains **JARVIS**.

## Current status

- Flat production architecture; the previous directory-per-controller implementation has been removed.
- NLP, NLU, parsing, language relations, validation, routing, NLE, verification, confirmation, responses, context, learning, and data management are connected in one command pipeline.
- `commands.md` is the authoritative language regression corpus and currently contains **2,102 commands**.
- Every command in the corpus is classified in a sandbox test without performing real desktop actions.
- Incomplete commands request clarification and do not execute.
- Recognized operations without a connected controller are reported as unsupported; OpenX does not claim they ran.
- Reminders, timers, alarms, daily recurrence, snooze, stopwatch controls, calendar, and daily timetable commands are routed through connected controllers and UI surfaces.
- Calendar and timetable entries share the assistant planner window; reminders and alarms are reflected in the timetable/calendar view.
- The desktop app includes a persistent timer/stopwatch widget, alert window, crash recovery, readable glass themes, and phone pairing/file-transfer support.
- Chrome, YouTube, Discord, forms, and communication adapters are isolated under `plugins/`.

## Command pipeline

```text
Chat or voice-derived text
  -> NLP normalization and spelling/noise repair
  -> NLU and context interpretation
  -> parser and entity extraction
  -> intent resolution
  -> required-entity validation
  -> permission and confirmation check
  -> NLE delegation
  -> automation controller
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
| Language | `core/assistant/language.js` | Context-language and word-relation helpers used by NLU and learning |
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
- `planner.js`: calendar and daily timetable entries, including assistant-created reminders and schedule references.
- `communications.js`: direct-recipient WhatsApp messages, email drafts, and calls without an assistant address book.
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
- `plugins/communications/`: stateless WhatsApp Desktop support.
- `plugins/sample_plugin/`: minimal plugin API example.

## Context and learning

OpenX tracks recent commands, searches, applications, conversation topics, and clarification/confirmation state. Active learning can retain corrections, preferences, non-sensitive user facts, feedback, routing evidence, and reusable command sequences.

Learning never bypasses permission checks, validation, or verification. Sensitive credentials are rejected from learned user facts.

## Data storage

Runtime data is stored under:

```text
%USERPROFILE%\OpenX_Data\
```

`core/assistant/Data.js` owns the data layout, atomic JSON writes, backups, logging helpers, and migration from the legacy `%USERPROFILE%\.jarvis` location. Settings, learning state, schedules, logs, media state, screenshots, and runtime files share the same managed root. OpenX does not maintain a contact store.

## Desktop application

The Electron application lives in `apps/desktop/`:

- `electron/main.js`: lifecycle, IPC, tray, shortcuts, windows, and assistant initialization.
- `electron/security.js`: trusted renderer checks, payload validation, and secure web preferences.
- `electron/crash-recovery.js`: bounded renderer restart and crash state.
- `preload.js`: narrow renderer API bridge.
- `settings.js`: settings, profiles, themes, and modes.
- `permissions.js`: permission levels, throttling, and confirmation requirements.
- `phone-verification.js`: Windows identity check before phone pairing.
- `voice/tts.js`: Windows SAPI text-to-speech output.
- `renderer/chat/`: primary chat, activity, settings, theme, and phone-management interface.
- `renderer/alert/`: dedicated timer/reminder alert window.
- `renderer/planner/`: glass-themed calendar and timetable window.
- `renderer/timer-widget/`: always-visible timer and stopwatch mini widget.

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
```

The command corpus can be tested directly:

```powershell
npx mocha tests/core/command-corpus.test.js --reporter dot
```

The corpus uses a sandbox automation engine. It tests interpretation and routing without opening applications, modifying files, changing settings, or triggering power operations.

## Packaging

```powershell
npm run build
```

The Windows x64 NSIS configuration packages `apps/`, `core/`, `plugins/`, and `package.json` into an ASAR application. Tests, documentation, graph output, and development metadata are excluded.

## Project structure

```text
OpenX/
├── apps/desktop/
│   ├── electron/
│   ├── renderer/
│   ├── voice/tts.js
│   ├── preload.js
│   ├── permissions.js
│   └── settings.js
├── core/
│   ├── assistant/
│   │   ├── nlp/
│   │   ├── Active-learning.js
│   │   ├── Data.js
│   │   ├── context.js
│   │   ├── contest.js
│   │   ├── entities.js
│   │   ├── index.js
│   │   ├── intents.js
│   │   ├── nle.js
│   │   ├── nlu.js
│   │   ├── parser.js
│   │   ├── personality.js
│   │   ├── responses.js
│   │   └── router.js
│   ├── automation/
│   │   ├── common/
│   │   └── flat domain controllers
│   └── context-awareness/
├── plugins/
├── tests/
├── commands.md
├── config.js
├── package.json
└── report.md
```

Current source additions include `apps/desktop/renderer/planner/`, `apps/desktop/renderer/timer-widget/`, `apps/desktop/phone-verification.js`, `core/phone/`, `core/automation/planner.js`, and `core/assistant/language.js`.

## Documentation

- `report.md`: detailed current implementation report.
- `docs/architecture/overview.md`: command and system architecture.
- `docs/workflows/command-execution.md`: execution workflow.
- `docs/plugins/development.md`: plugin authoring and restrictions.
- `graphify-out/GRAPH_REPORT.md`: generated knowledge-graph analysis.

## Latest assistant behavior

Current verified reminder examples include:

```text
remind me to call mummy after 30 min
remind me after 5 min to call mummy
remind me to call daddy after 1hr
remind me tommrow to wish charan on his birthday
```

The assistant parses these as reminders without asking for missing time. Date-only reminders such as `tomorrow` default to 9:00 AM local time when no exact time is supplied.

## License

MIT
