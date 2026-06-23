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
  -> response/personality
  -> context and active learning
  -> OpenX_Data
```

### 3.1 Complete project directory tree

The tree below includes every project file and source directory. It intentionally excludes dependency, generated-output, version-control, and editor/agent metadata directories: `node_modules/`, `dist/`, `graphify-out/`, `.git/`, `.codex/`, `.cursor/`, `.agents/`, `.code-review-graph/`, and `.playwright-mcp/`.

```text
OpenX/
├── apps
│   └── desktop
│       ├── electron
│       │   ├── crash-recovery.js
│       │   ├── main.js
│       │   └── security.js
│       ├── renderer
│       │   ├── alert
│       │   │   ├── index.css
│       │   │   ├── index.html
│       │   │   └── index.js
│       │   ├── chat
│       │   │   ├── index.css
│       │   │   ├── index.html
│       │   │   └── index.js
│       │   └── settings
│       │       ├── index.css
│       │       ├── index.html
│       │       └── index.js
│       ├── voice
│       │   └── tts.js
│       ├── permissions.js
│       ├── preload.js
│       └── settings.js
├── build
│   ├── icon.ico
│   ├── icon.png
│   ├── ICON_README.md
│   └── installer.nsh
├── core
│   ├── assistant
│   │   ├── active-learning
│   │   │   ├── ActiveLearningManager.js
│   │   │   ├── AliasStore.js
│   │   │   ├── BaseStore.js
│   │   │   ├── CorrectionStore.js
│   │   │   ├── LearningGuard.js
│   │   │   ├── LearningLanguage.js
│   │   │   ├── PreferenceStore.js
│   │   │   ├── UsageStatsStore.js
│   │   │   └── WorkflowStore.js
│   │   ├── nlp
│   │   │   ├── nlp.js
│   │   │   ├── preprocessor.js
│   │   │   ├── scorer.js
│   │   │   └── web-targets.js
│   │   ├── Active-learning.js
│   │   ├── contest.js
│   │   ├── context.js
│   │   ├── ContextLanguage.js
│   │   ├── Data.js
│   │   ├── entities.js
│   │   ├── index.js
│   │   ├── intents.js
│   │   ├── nle.js
│   │   ├── nlu.js
│   │   ├── parser.js
│   │   ├── personality.js
│   │   ├── responses.js
│   │   └── router.js
│   ├── automation
│   │   ├── common
│   │   │   ├── action-confirm.js
│   │   │   ├── action-velidation.js
│   │   │   ├── action-verification.js
│   │   │   ├── launcher.js
│   │   │   ├── path-utils.js
│   │   │   └── windows-session.js
│   │   ├── apps.js
│   │   ├── brightness.js
│   │   ├── browser.js
│   │   ├── communications.js
│   │   ├── files.js
│   │   ├── folders.js
│   │   ├── index.js
│   │   ├── media.js
│   │   ├── scheduler.js
│   │   ├── screenshot-recording.js
│   │   ├── system.js
│   │   ├── volume.js
│   │   └── windows.js
│   └── context-awareness
│       ├── active-window.js
│       ├── app-registry.js
│       ├── context-engine.js
│       ├── mode-engine.js
│       ├── process-monitor.js
│       └── signals.js
├── docs
│   ├── architecture
│   │   └── overview.md
│   ├── modules
│   │   ├── assistant-communication.md
│   │   ├── communications.md
│   │   ├── core-engine.md
│   │   ├── nlp-pipeline.md
│   │   └── settings.md
│   ├── plugins
│   │   └── development.md
│   ├── setup
│   │   └── installation.md
│   └── workflows
│       └── command-execution.md
├── plugins
│   ├── chrome
│   │   ├── index.js
│   │   └── plugin.json
│   ├── communications
│   │   └── whatsapp-desktop.js
│   ├── discord
│   │   ├── index.js
│   │   └── plugin.json
│   ├── forms
│   │   ├── index.js
│   │   └── understanding.js
│   ├── sample_plugin
│   │   ├── index.js
│   │   └── plugin.json
│   ├── youtube
│   │   ├── index.js
│   │   └── plugin.json
│   └── plugin-controller.js
├── scripts
│   └── start-electron.js
├── tests
│   ├── automation
│   │   ├── apps.test.js
│   │   ├── automation.test.js
│   │   ├── browser.test.js
│   │   ├── communications.test.js
│   │   ├── file-management.test.js
│   │   ├── media.test.js
│   │   ├── volume-brightness.test.js
│   │   └── windows-session.test.js
│   ├── context-awareness
│   │   ├── context-awareness.test.js
│   │   └── mode-engine.test.js
│   ├── core
│   │   ├── active-learning-v2.test.js
│   │   ├── app-language.test.js
│   │   ├── architecture-structure.test.js
│   │   ├── assistant.test.js
│   │   ├── browser-language.test.js
│   │   ├── command-corpus.test.js
│   │   ├── crash-recovery.test.js
│   │   ├── data-root.test.js
│   │   ├── electron-security.test.js
│   │   ├── entities.test.js
│   │   ├── human-context.test.js
│   │   ├── intents.test.js
│   │   ├── learning.test.js
│   │   ├── learning-repair.test.js
│   │   ├── logger.test.js
│   │   ├── media-youtube-corpus.test.js
│   │   ├── nlp.test.js
│   │   ├── nlu.test.js
│   │   ├── parser.test.js
│   │   ├── permissions.test.js
│   │   ├── renderer-security.test.js
│   │   ├── responses.test.js
│   │   ├── router.test.js
│   │   ├── scheduler-alert.test.js
│   │   ├── security-critical.test.js
│   │   └── settings.test.js
│   ├── media-handling
│   │   └── media-handling.test.js
│   ├── plugins
│   └── ui
│       ├── chat-renderer.test.js
│       └── schedule-alert-renderer.test.js
├── .gitignore
├── AGENTS.md
├── commands.md
├── config.js
├── eslint.config.mjs
├── package.json
├── package-lock.json
├── README.md
├── report.md
└── RULES.md
```

### 3.2 Assistant layer

| File | Current responsibility |
|---|---|
| `core/assistant/index.js` | Public assistant API, conversation lifecycle, pending clarification/confirmation, learning, events, plugins, and responses |
| `core/assistant/nlp/nlp.js` | Cached preparation, normalization, spell repair, noisy-command repair, and semantic hints |
| `core/assistant/nlp/preprocessor.js` | Vocabulary, phrase replacements, token corrections, repeated-token handling, filler removal, and lead-in removal |
| `core/assistant/nlp/scorer.js` | Ordered token and intent-pattern scoring |
| `core/assistant/nlp/web-targets.js` | Trusted web-target normalization |
| `core/assistant/nlu.js` | Semantic frame construction plus integrated app/browser command languages |
| `core/assistant/parser.js` | Input parser plus integrated word-level command-frame parser |
| `core/assistant/entities.js` | Entity extraction and target normalization |
| `core/assistant/intents.js` | Intent registry, patterns, action IDs, required entities, and permission levels |
| `core/assistant/router.js` | Multi-command planning, specific intent resolvers, validation, permissions, NLE delegation, and response result assembly |
| `core/assistant/nle.js` | Single assistant-to-automation execution boundary |
| `core/assistant/context.js` | Session command and conversation history |
| `core/assistant/contest.js` | Compatibility name from the requested design; exposes context and context-engine types |
| `core/assistant/Active-learning.js` | Corrections, preferences, user facts, feedback, command sequences, and routing evidence |
| `core/assistant/personality.js` | Configurable assistant presentation style |
| `core/assistant/responses.js` | Deterministic response templates and formal address |
| `core/assistant/Data.js` | Logger, events, normalizer, validator, IDs, atomic persistence, data-root layout, and migration |

### 3.3 Context-awareness layer

| File | Responsibility |
|---|---|
| `core/context-awareness/active-window.js` | Active-window observation |
| `core/context-awareness/app-registry.js` | Known applications and category mapping |
| `core/context-awareness/context-engine.js` | Context signal aggregation |
| `core/context-awareness/mode-engine.js` | Mode profile interpretation |
| `core/context-awareness/process-monitor.js` | Running-process snapshots |
| `core/context-awareness/signals.js` | Context signal definitions |

### 3.4 Automation layer

`core/automation/index.js` owns the action registry and controller composition. Connected actions include:

- application open, close, switch, new tab/window, and modes;
- file create, open, delete, rename, copy, move, search, list, and smart discovery;
- folder create, open, delete, and move;
- browser URL opening, web search, site search, first-result handling, tab open/close/list;
- media play/search/control, fullscreen, volume, shuffle, repeat, favorites, likes, subscriptions, and status;
- timers, alarms, and reminders;
- direct-recipient message and email composition plus calls, without persistent contact storage;
- CPU, RAM, battery, disk, processes, system insights, Bluetooth settings, calculations, time, and date;
- screenshot capture;
- volume and brightness reading/control;
- window minimize, maximize, close, and Windows power/session operations;
- form filling through the forms plugin package.

Domain implementations are flat files:

```text
core/automation/
├── apps.js
├── brightness.js
├── browser.js
├── communications.js
├── files.js
├── folders.js
├── index.js
├── media.js
├── scheduler.js
├── screenshot-recording.js
├── system.js
├── volume.js
├── windows.js
└── common/
    ├── action-confirm.js
    ├── action-velidation.js
    ├── action-verification.js
    ├── launcher.js
    ├── path-utils.js
    └── windows-session.js
```

The filename `action-velidation.js` intentionally follows the requested project structure. Its class and behavior use the correct term `ActionValidation`.

## 4. Command processing details

### 4.1 NLP

NLP normalizes case and spacing, applies explicit phrase repairs, corrects known token sequences, preserves domain vocabulary, and uses bounded fuzzy matching for likely spelling errors. It also identifies action/query structure and caches prepared inputs and intent patterns.

The vocabulary explicitly preserves valid words that could otherwise be mistaken for commands. For example, “research” remains “research” rather than being repaired to “search.”

### 4.2 NLU and parsing

NLU produces semantic frames containing action, domain, target, values, question state, locality, and token roles. The parser separately produces command frames for deterministic action/target handling. App and browser language handlers are integrated into `nlu.js`; command-frame parsing is integrated into `parser.js`.

### 4.3 Routing

The router prioritizes explicit and domain-specific resolvers before exact intent matching and general capability classification. This order protects precise commands from broad fallbacks.

Multi-command planning occurs before generic capability fallback. This prevents a broad verb such as “open” or “close” from swallowing later clauses.

### 4.4 Validation and clarification

`ActionValidation` checks required intent entities before NLE. Missing values return:

- the resolved intent;
- extracted entities;
- missing entity names;
- `needsClarification: true`;
- no automation execution.

Standalone incomplete phrases such as “open” and “search for” remain rejected rather than inventing targets.

### 4.5 Permissions and confirmation

Intent permission levels pass through `apps/desktop/permissions.js`. Sensitive actions can require user confirmation. Confirmations use the stored pending intent and entities rather than trusting a forged renderer payload.

Multi-command execution can pause at a protected step and resume its remaining commands after confirmation.

### 4.6 NLE, verification, and confirmation evidence

`core/assistant/nle.js` is the sole execution delegate used by the router. It passes the resolved action and entities to the automation engine with command context.

The automation engine applies `action-verification.js`, which validates results and verifies observable postconditions where supported. `action-confirm.js` normalizes completion evidence returned with the assistant result.

### 4.7 Safe fallback

Commands with a recognizable desktop operation but no connected action are routed to `assistant.capability`. The generated response states that the request was understood but the capability is not connected.

This improves language coverage without simulating success or performing an unrelated web search.

## 5. Command corpus

`commands.md` is the authoritative natural-language regression corpus. It currently contains **2,102 numbered commands** spanning:

- simple and conversational commands;
- incomplete requests;
- spelling and grammar variations;
- files, folders, applications, browser, media, system, scheduling, and communications;
- contextual and workspace requests;
- multi-command workflows;
- operations that are recognized but not yet connected.

`tests/core/command-corpus.test.js` loads `commands.md`, removes numbering, and processes each command using a sandbox automation engine. The test asserts that every command resolves to an intent. It does not permit real application launches, file changes, messages, calls, power actions, or settings changes.

The corpus result should be interpreted as **100% classification coverage**, not 100% operating-system feature implementation.

## 6. Plugins

### 6.1 Plugin controller

`plugins/plugin-controller.js` validates manifests, trusted IDs, plugin paths, permissions, namespaces, and declared automation dependencies.

Plugin actions and intents must use `plugin.<id>.*`. A plugin may call a core automation action only when it appears in the manifest’s `usesAutomation` list. This prevents a low-scope plugin from invoking arbitrary desktop operations.

### 6.2 Current packages

| Package | Purpose |
|---|---|
| `plugins/youtube/` | YouTube navigation backed by declared browser/media actions |
| `plugins/chrome/` | Chrome-specific navigation, including browser history |
| `plugins/discord/` | Discord application integration |
| `plugins/forms/` | Google Form and generic form understanding/filling |
| `plugins/communications/` | Stateless WhatsApp Desktop implementation |
| `plugins/sample_plugin/` | Trusted example of namespaced action and intent registration |

Plugin loading is enabled in `config.js`, and the default trusted list is `sample_plugin`, `youtube`, `chrome`, and `discord`. The forms and communications packages are composed directly by their owning automation controllers.

## 7. Active learning and personality

Active learning stores:

- user-approved corrections;
- preferences;
- non-sensitive personal facts;
- command sequences;
- feedback and feedback prompts;
- routing evidence;
- learned entity adaptations.

Sensitive credential-like fields are rejected. Writes are sanitized, pruned, and atomic. Learning never bypasses required-entity validation, permissions, or postcondition verification.

Personality applies configurable titles and honorifics to deterministic responses. It changes presentation, not intent or permission decisions.

## 8. Data and persistence

The managed data root is:

```text
%USERPROFILE%\OpenX_Data\
```

`core/assistant/Data.js` provides:

- data-root and legacy-root resolution;
- managed paths for settings, learning, schedules, logs, runtime state, media, screenshots, and backups;
- atomic file and JSON writes;
- optional backup files;
- migration from `%USERPROFILE%\.jarvis` without overwriting newer OpenX data;
- redacting structured logging;
- shared event names and event bus;
- normalization, validation, and ID utilities.

## 9. Electron application and security

The desktop application is implemented in `apps/desktop/`.

Security properties include:

- context isolation;
- disabled Node integration in renderers;
- sandboxed web preferences;
- trusted local renderer URL checks;
- structured IPC payload validation;
- confirmation payload validation;
- bounded renderer restart policy;
- bounded UI history and rendering;
- plugin trust and namespace enforcement;
- safe user-path validation for file operations.

The preload bridge exposes a narrow API. Renderer code cannot directly access controllers or execute operating-system actions.

## 10. Settings and configuration

`config.js` contains runtime defaults for:

- OpenX data paths;
- JARVIS display name and honorific;
- TTS voice, rate, volume, and naturalization;
- active learning and feedback;
- permission levels;
- logging;
- plugin directory, enablement, and trusted plugin IDs.

`apps/desktop/settings.js` persists user-facing settings, themes, profiles, and modes under the managed data root. Contact storage and its renderer/IPC surface have been removed.

## 11. Testing and verification

Available commands:

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
- Messaging and call behavior depends on explicitly supplied chat names, phone numbers, or email addresses and available URI/desktop integration.
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
