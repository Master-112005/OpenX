# OpenX Current Implementation Report

**Project:** OpenX

**Package version:** 2.5.0

**Platform:** Windows desktop

**Runtime:** Electron 28 and Node.js

**Report date:** 2026-07-01

## 1. Executive summary

OpenX is a deterministic, local-first Windows desktop assistant. The current implementation uses a flat production architecture with dedicated assistant-language layers, domain automation controllers, context awareness, active learning, secured Electron integration, and restricted external plugins.

The previous directory-per-controller architecture has been removed. Implementations now live directly in the files documented below; there are no compatibility facades pointing back to the removed core structure.

The assistant processes commands through NLP, NLU, parsing, language relations, entity extraction, intent resolution, validation, permissions, Natural Language Execution (NLE), automation, verification, confirmation, response generation, context, and active learning. The language regression corpus contains **2,102 commands**, all of which are classified by the sandbox corpus test.

Recent implementation work added a glass-themed calendar/timetable planner window, a persistent timer/stopwatch widget, daily reminder and alarm recurrence, snooze actions, phone pairing and file transfer support, stronger crash recovery and renderer security, tighter reminder parsing for flexible time phrases such as `after 30 min`, `after 1hr`, and misspelled `tommrow`, and a local voice subsystem with continuous voice sessions, Sherpa-ONNX/Parakeet STT, RNNoise/VAD processing, voice UI, assistant integration, diagnostics, and TTS-synchronized turn-taking.

Classification does not mean every requested operating-system feature is implemented. OpenX explicitly distinguishes successful execution, clarification, and recognized-but-unconnected capabilities.

## 2. Objectives

The implementation is designed to provide:

- predictable Windows automation from conversational language;
- typo, spelling, filler-word, abbreviation, and noisy-input handling;
- multi-command planning and sequential execution;
- clear intent and entity boundaries;
- context-aware reminder, planner, phone, browser, file, and app routing;
- validation before execution and verification after execution;
- permission-aware confirmation for sensitive actions;
- bounded context and privacy-conscious active learning;
- external integrations through isolated, restricted plugins;
- one consistent response contract across chat, phone, and voice-derived text;
- testable routing without real desktop side effects.

## 3. Current architecture

```text
Input
  -> NLP
  -> NLU and context
  -> parser, language relations, and entities
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

The list below includes every project file currently present in the workspace, with local-only and generated noise excluded. Omitted paths include `node_modules/`, `dist/`, `graphify-out/`, `OpenX_Data/`, `openx_data/`, `.git/`, `.codex/`, `.cursor/`, `.agents/`, `.code-review-graph/`, `.playwright-mcp/`, `.vscode/`, `*.log`, and `*.tmp`.

```text
OpenX/
  .gitignore
  AGENTS.md
  commands.md
  config.js
  eslint.config.mjs
  package.json
  package-lock.json
  README.md
  report.md
  RULES.md
  apps/desktop/electron/crash-recovery.js
  apps/desktop/electron/main.js
  apps/desktop/electron/security.js
  apps/desktop/permissions.js
  apps/desktop/phone-verification.js
  apps/desktop/preload.js
  apps/desktop/settings.js
  apps/desktop/renderer/alert/index.css
  apps/desktop/renderer/alert/index.html
  apps/desktop/renderer/alert/index.js
  apps/desktop/renderer/chat/index.css
  apps/desktop/renderer/chat/index.html
  apps/desktop/renderer/chat/index.js
  apps/desktop/renderer/planner/index.css
  apps/desktop/renderer/planner/index.html
  apps/desktop/renderer/planner/index.js
  apps/desktop/renderer/settings/index.css
  apps/desktop/renderer/settings/index.html
  apps/desktop/renderer/settings/index.js
  apps/desktop/renderer/timer-widget/index.css
  apps/desktop/renderer/timer-widget/index.html
  apps/desktop/renderer/timer-widget/index.js
  apps/desktop/renderer/voice-capture/index.html
  apps/desktop/renderer/voice-capture/index.js
  apps/desktop/voice/index.js
  apps/desktop/voice/tts.js
  apps/desktop/voice/audio/AudioBuffer.js
  apps/desktop/voice/audio/AudioCapture.js
  apps/desktop/voice/audio/AudioConfiguration.js
  apps/desktop/voice/audio/AudioDeviceManager.js
  apps/desktop/voice/audio/AudioErrors.js
  apps/desktop/voice/audio/AudioEvents.js
  apps/desktop/voice/audio/AudioFrame.js
  apps/desktop/voice/audio/AudioPermissions.js
  apps/desktop/voice/audio/index.js
  apps/desktop/voice/config/VoiceSettings.js
  apps/desktop/voice/diagnostics/DiagnosticsConfiguration.js
  apps/desktop/voice/diagnostics/DiagnosticsErrors.js
  apps/desktop/voice/diagnostics/DiagnosticsEvents.js
  apps/desktop/voice/diagnostics/DiagnosticsManager.js
  apps/desktop/voice/diagnostics/DiagnosticsReport.js
  apps/desktop/voice/diagnostics/ErrorTracker.js
  apps/desktop/voice/diagnostics/EventTimeline.js
  apps/desktop/voice/diagnostics/HealthMonitor.js
  apps/desktop/voice/diagnostics/index.js
  apps/desktop/voice/diagnostics/LatencyMonitor.js
  apps/desktop/voice/diagnostics/MetricsCollector.js
  apps/desktop/voice/diagnostics/PerformanceMonitor.js
  apps/desktop/voice/diagnostics/privacy.js
  apps/desktop/voice/diagnostics/ResourceMonitor.js
  apps/desktop/voice/diagnostics/SessionStatistics.js
  apps/desktop/voice/diagnostics/VoiceLogger.js
  apps/desktop/voice/diagnostics/VoiceMetrics.js
  apps/desktop/voice/integration/AssistantDispatcher.js
  apps/desktop/voice/integration/AssistantInputAdapter.js
  apps/desktop/voice/integration/index.js
  apps/desktop/voice/integration/VoiceAssistantBridge.js
  apps/desktop/voice/integration/VoiceExecutionCoordinator.js
  apps/desktop/voice/integration/VoiceIntegrationConfiguration.js
  apps/desktop/voice/integration/VoiceIntegrationErrors.js
  apps/desktop/voice/integration/VoiceIntegrationEvents.js
  apps/desktop/voice/integration/VoiceResponseHandler.js
  apps/desktop/voice/normalization/AcronymNormalizer.js
  apps/desktop/voice/normalization/ApplicationNormalizer.js
  apps/desktop/voice/normalization/CommandNormalizer.js
  apps/desktop/voice/normalization/DictionaryNormalizer.js
  apps/desktop/voice/normalization/index.js
  apps/desktop/voice/normalization/NormalizationConfiguration.js
  apps/desktop/voice/normalization/NormalizationErrors.js
  apps/desktop/voice/normalization/NormalizationEvents.js
  apps/desktop/voice/normalization/NormalizedTranscript.js
  apps/desktop/voice/normalization/TechnologyNormalizer.js
  apps/desktop/voice/normalization/TextCleaner.js
  apps/desktop/voice/normalization/TextValidator.js
  apps/desktop/voice/normalization/TranscriptNormalizer.js
  apps/desktop/voice/normalization/TranscriptProcessor.js
  apps/desktop/voice/preprocessing/AudioFrameProcessor.js
  apps/desktop/voice/preprocessing/AudioPipeline.js
  apps/desktop/voice/preprocessing/AudioProcessingErrors.js
  apps/desktop/voice/preprocessing/AudioProcessingEvents.js
  apps/desktop/voice/preprocessing/AudioProcessor.js
  apps/desktop/voice/preprocessing/index.js
  apps/desktop/voice/preprocessing/ProcessedAudioFrame.js
  apps/desktop/voice/preprocessing/ProcessingConfiguration.js
  apps/desktop/voice/preprocessing/RNNoiseProcessor.js
  apps/desktop/voice/preprocessing/SpeechSourceClassifier.js
  apps/desktop/voice/preprocessing/VoiceActivityDetector.js
  apps/desktop/voice/session/SessionEvents.js
  apps/desktop/voice/session/VoiceSession.js
  apps/desktop/voice/session/VoiceSessionManager.js
  apps/desktop/voice/session/VoiceStateMachine.js
  apps/desktop/voice/stt/DecoderState.js
  apps/desktop/voice/stt/index.js
  apps/desktop/voice/stt/ModelLoader.js
  apps/desktop/voice/stt/ModelManager.js
  apps/desktop/voice/stt/ParakeetEngine.js
  apps/desktop/voice/stt/SherpaRuntime.js
  apps/desktop/voice/stt/STTConfiguration.js
  apps/desktop/voice/stt/STTEngine.js
  apps/desktop/voice/stt/STTErrors.js
  apps/desktop/voice/stt/STTEvents.js
  apps/desktop/voice/stt/TranscriptAssembler.js
  apps/desktop/voice/stt/TranscriptResult.js
  apps/desktop/voice/stt/TranscriptSegment.js
  apps/desktop/voice/ui/index.js
  apps/desktop/voice/ui/TranscriptPublisher.js
  apps/desktop/voice/ui/VoiceAccessibility.js
  apps/desktop/voice/ui/VoiceAnimationController.js
  apps/desktop/voice/ui/VoiceConfiguration.js
  apps/desktop/voice/ui/VoiceOverlay.js
  apps/desktop/voice/ui/VoiceOverlayIPC.js
  apps/desktop/voice/ui/VoiceStateRenderer.js
  apps/desktop/voice/ui/VoiceStatusIndicator.js
  apps/desktop/voice/ui/VoiceTheme.js
  apps/desktop/voice/ui/VoiceUIErrors.js
  apps/desktop/voice/ui/VoiceUIEvents.js
  apps/desktop/voice/ui/VoiceWindowController.js
  build/icon.ico
  build/icon.png
  build/ICON_README.md
  build/installer.nsh
  build/openx-chrome-host.exe
  core/assistant/Active-learning.js
  core/assistant/contest.js
  core/assistant/context.js
  core/assistant/Data.js
  core/assistant/entities.js
  core/assistant/index.js
  core/assistant/intents.js
  core/assistant/language.js
  core/assistant/nle.js
  core/assistant/nlu.js
  core/assistant/parser.js
  core/assistant/personality.js
  core/assistant/responses.js
  core/assistant/router.js
  core/assistant/active-learning/ActiveLearningManager.js
  core/assistant/active-learning/AliasStore.js
  core/assistant/active-learning/BaseStore.js
  core/assistant/active-learning/CorrectionStore.js
  core/assistant/active-learning/LearningGuard.js
  core/assistant/active-learning/LearningLanguage.js
  core/assistant/active-learning/PreferenceStore.js
  core/assistant/active-learning/UsageStatsStore.js
  core/assistant/active-learning/WorkflowStore.js
  core/assistant/nlp/nlp.js
  core/assistant/nlp/preprocessor.js
  core/assistant/nlp/scorer.js
  core/assistant/nlp/web-targets.js
  core/automation/apps.js
  core/automation/brightness.js
  core/automation/browser.js
  core/automation/communications.js
  core/automation/files.js
  core/automation/folders.js
  core/automation/index.js
  core/automation/media.js
  core/automation/planner.js
  core/automation/scheduler.js
  core/automation/screenshot-recording.js
  core/automation/system.js
  core/automation/volume.js
  core/automation/windows.js
  core/automation/common/action-confirm.js
  core/automation/common/action-velidation.js
  core/automation/common/action-verification.js
  core/automation/common/launcher.js
  core/automation/common/path-utils.js
  core/automation/common/windows-session.js
  core/context-awareness/active-window.js
  core/context-awareness/app-registry.js
  core/context-awareness/context-engine.js
  core/context-awareness/mode-engine.js
  core/context-awareness/process-monitor.js
  core/context-awareness/signals.js
  core/phone/DeviceRegistry.js
  core/phone/FileTransferManager.js
  core/phone/FileTransferProtocol.js
  core/phone/IdentityVerificationService.js
  core/phone/index.js
  core/phone/PairingService.js
  core/phone/PairingTokenManager.js
  core/phone/PhoneCommandRouter.js
  core/phone/PhoneConnectionManager.js
  core/phone/PhoneServer.js
  core/phone/QRPairingService.js
  core/phone/SecurityManager.js
  core/phone/SessionManager.js
  core/phone/TransferHistory.js
  core/phone/TransferIntegrity.js
  docs/architecture/overview.md
  docs/modules/assistant-communication.md
  docs/modules/communications.md
  docs/modules/core-engine.md
  docs/modules/nlp-pipeline.md
  docs/modules/settings.md
  docs/plugins/development.md
  docs/setup/installation.md
  docs/workflows/command-execution.md
  models/parakeet/decoder.int8.onnx
  models/parakeet/encoder.int8.onnx
  models/parakeet/joiner.int8.onnx
  models/parakeet/tokens.txt
  plugins/chrome/index.js
  plugins/chrome/plugin.json
  plugins/communications/whatsapp-desktop.js
  plugins/discord/index.js
  plugins/discord/plugin.json
  plugins/forms/index.js
  plugins/forms/understanding.js
  plugins/plugin-controller.js
  plugins/sample_plugin/index.js
  plugins/sample_plugin/plugin.json
  plugins/youtube/index.js
  plugins/youtube/plugin.json
  scripts/enable-phone-pairing-firewall.ps1
  scripts/start-electron.js
  tests/automation/apps.test.js
  tests/automation/automation.test.js
  tests/automation/browser.test.js
  tests/automation/communications.test.js
  tests/automation/file-management.test.js
  tests/automation/media.test.js
  tests/automation/volume-brightness.test.js
  tests/automation/windows-session.test.js
  tests/context-awareness/context-awareness.test.js
  tests/context-awareness/mode-engine.test.js
  tests/core/active-learning-v2.test.js
  tests/core/app-language.test.js
  tests/core/architecture-structure.test.js
  tests/core/assistant.test.js
  tests/core/browser-language.test.js
  tests/core/command-corpus.test.js
  tests/core/crash-recovery.test.js
  tests/core/data-root.test.js
  tests/core/electron-security.test.js
  tests/core/electron-shortcut.test.js
  tests/core/entities.test.js
  tests/core/human-context.test.js
  tests/core/intents.test.js
  tests/core/learning.test.js
  tests/core/learning-repair.test.js
  tests/core/logger.test.js
  tests/core/media-youtube-corpus.test.js
  tests/core/nlp.test.js
  tests/core/nlu.test.js
  tests/core/parser.test.js
  tests/core/permissions.test.js
  tests/core/phone-device-permissions.test.js
  tests/core/phone-file-transfer.test.js
  tests/core/phone-identity-verification.test.js
  tests/core/phone-pairing.test.js
  tests/core/phone-qr-pairing.test.js
  tests/core/phone-security.test.js
  tests/core/phone.test.js
  tests/core/planner.test.js
  tests/core/renderer-security.test.js
  tests/core/responses.test.js
  tests/core/router.test.js
  tests/core/scheduler-alert.test.js
  tests/core/security-critical.test.js
  tests/core/settings.test.js
  tests/core/voice-subsystem.test.js
  tests/media-handling/media-handling.test.js
  tests/ui/chat-renderer.test.js
  tests/ui/planner-renderer.test.js
  tests/ui/schedule-alert-renderer.test.js
  tests/ui/timer-widget-renderer.test.js
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
| `core/assistant/language.js` | Combined context-language and word-relation helpers for NLU, context interpretation, and active learning |
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
- timers, alarms, reminders, recurrence, snooze, and stopwatch state;
- calendar and daily timetable entries through the planner controller;
- direct-recipient message and email composition plus calls, without persistent contact storage;
- CPU, RAM, battery, disk, processes, system insights, Bluetooth settings, calculations, time, and date;
- screenshot capture;
- volume and brightness reading/control;
- window minimize, maximize, close, and Windows power/session operations;
- form filling through the forms plugin package.

Domain implementations are flat files:

```text
core/automation/
â”œâ”€â”€ apps.js
â”œâ”€â”€ brightness.js
â”œâ”€â”€ browser.js
â”œâ”€â”€ communications.js
â”œâ”€â”€ files.js
â”œâ”€â”€ folders.js
â”œâ”€â”€ index.js
â”œâ”€â”€ media.js
â”œâ”€â”€ scheduler.js
â”œâ”€â”€ screenshot-recording.js
â”œâ”€â”€ system.js
â”œâ”€â”€ volume.js
â”œâ”€â”€ windows.js
â””â”€â”€ common/
    â”œâ”€â”€ action-confirm.js
    â”œâ”€â”€ action-velidation.js
    â”œâ”€â”€ action-verification.js
    â”œâ”€â”€ launcher.js
    â”œâ”€â”€ path-utils.js
    â””â”€â”€ windows-session.js
```

The filename `action-velidation.js` intentionally follows the requested project structure. Its class and behavior use the correct term `ActionValidation`.

## 4. Command processing details

### 4.1 NLP

NLP normalizes case and spacing, applies explicit phrase repairs, corrects known token sequences, preserves domain vocabulary, and uses bounded fuzzy matching for likely spelling errors. It also identifies action/query structure and caches prepared inputs and intent patterns.

The vocabulary explicitly preserves valid words that could otherwise be mistaken for commands. For example, â€œresearchâ€ remains â€œresearchâ€ rather than being repaired to â€œsearch.â€

### 4.2 NLU and parsing

NLU produces semantic frames containing action, domain, target, values, question state, locality, and token roles. The parser separately produces command frames for deterministic action/target handling. App and browser language handlers are integrated into `nlu.js`; command-frame parsing is integrated into `parser.js`.

### 4.3 Routing

The router prioritizes explicit and domain-specific resolvers before exact intent matching and general capability classification. This order protects precise commands from broad fallbacks.

Multi-command planning occurs before generic capability fallback. This prevents a broad verb such as â€œopenâ€ or â€œcloseâ€ from swallowing later clauses.

### 4.4 Validation and clarification

`ActionValidation` checks required intent entities before NLE. Missing values return:

- the resolved intent;
- extracted entities;
- missing entity names;
- `needsClarification: true`;
- no automation execution.

Standalone incomplete phrases such as â€œopenâ€ and â€œsearch forâ€ remain rejected rather than inventing targets.

### 4.5 Permissions and confirmation

Intent permission levels pass through `apps/desktop/permissions.js`. Sensitive actions can require user confirmation. Confirmations use the stored pending intent and entities rather than trusting a forged renderer payload.

Multi-command execution can pause at a protected step and resume its remaining commands after confirmation.

### 4.6 NLE, verification, and confirmation evidence

`core/assistant/nle.js` is the sole execution delegate used by the router. It passes the resolved action and entities to the automation engine with command context.

The automation engine applies `action-verification.js`, which validates results and verifies observable postconditions where supported. `action-confirm.js` normalizes completion evidence returned with the assistant result.

### 4.7 Safe fallback

Commands with a recognizable desktop operation but no connected action are routed to `assistant.capability`. The generated response states that the request was understood but the capability is not connected.

This improves language coverage without simulating success or performing an unrelated web search.

### 4.8 Scheduling, reminders, and planner integration

The scheduler now supports timers, alarms, reminders, daily/weekly/hourly recurrence, snooze actions, and stopwatch state used by the desktop timer widget. Reminder parsing accepts schedule clauses before or after the reminder text, including compact and word-based durations:

```text
remind me to call mummy after 30 min
remind me after 5 min to call mummy
remind me to call daddy after 1hr
remind me to call daddy after one hr
remind me tommrow to wish charan on his birthday
```

The assistant-level clarification gate lets complete reminder phrases reach the router instead of incorrectly asking for a missing time. Date-only reminders such as `tomorrow` are valid and default to 9:00 AM local time when the user does not provide an exact clock time.

The planner integrates calendar and daily timetable data. `calendar.open` and `timetable.open` show the same planner window, and clicking a date reveals that day's timetable. Assistant-created reminders and alarms are surfaced as schedule entries so calendar dates can show reminder counts and the timetable can reflect upcoming personal tasks.

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

Plugin actions and intents must use `plugin.<id>.*`. A plugin may call a core automation action only when it appears in the manifestâ€™s `usesAutomation` list. This prevents a low-scope plugin from invoking arbitrary desktop operations.

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

## 7. Phone bridge

The `core/phone/` package provides local phone integration:

- `PhoneServer` hosts the local device bridge.
- `QRPairingService`, `PairingService`, and `PairingTokenManager` create short-lived pairing sessions.
- `IdentityVerificationService` and `apps/desktop/phone-verification.js` require Windows identity verification before QR pairing.
- `DeviceRegistry`, `SessionManager`, and `SecurityManager` track trusted devices and permissions.
- `FileTransferProtocol`, `FileTransferManager`, `TransferIntegrity`, and `TransferHistory` handle file/folder transfer.
- `PhoneCommandRouter` routes commands from a trusted phone through the same assistant pipeline with phone context and device permissions.

Settings expose Connect Phone and Connected Devices as separate phone panels. Trusted devices can be listed, disconnected, removed, and permission-scoped from the desktop UI.

## 8. Active learning and personality

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

## 9. Data and persistence

The managed data root is:

```text
%USERPROFILE%\OpenX_Data\
```

`core/assistant/Data.js` provides:

- data-root and legacy-root resolution;
- managed paths for settings, learning, schedules, planner entries, logs, runtime state, media, screenshots, voice diagnostics, phone state, phone transfer history, received phone files, temporary transfer archives, and backups;
- managed paths for phone pairing, trusted phone devices, phone permissions, and phone transfer history;
- atomic file and JSON writes;
- optional backup files;
- migration from `%USERPROFILE%\.jarvis` and accidental project-root schedule/planner files without overwriting newer OpenX data;
- redacting structured logging;
- shared event names and event bus;
- normalization, validation, and ID utilities.

## 10. Electron application and security

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
- trusted planner, alert, timer-widget, and settings renderer windows;
- Windows identity verification before phone pairing QR generation;
- phone-device permissions for remote command and file-transfer capabilities;
- plugin trust and namespace enforcement;
- safe user-path validation for file operations.

The preload bridge exposes a narrow API. Renderer code cannot directly access controllers or execute operating-system actions.

Desktop renderer surfaces now include chat/activity/settings, the alert window, the glass-themed planner window, and the timer/stopwatch widget. The planner window is focused separately from chat so calendar/timetable work is not interrupted by the assistant chat surface.

## 11. Settings and configuration

`config.js` contains runtime defaults for:

- OpenX data paths;
- OpenX display name and honorific;
- TTS voice, rate, volume, and naturalization;
- active learning and feedback;
- permission levels;
- logging;
- plugin directory, enablement, and trusted plugin IDs.
- phone server host/port defaults and trusted-device paths.

`apps/desktop/settings.js` persists user-facing settings, themes, profiles, and modes under the managed data root. The chat and planner surfaces consume the same theme snapshot so glass tint, contrast, and readability stay consistent across background changes. Contact storage and its renderer/IPC surface have been removed.

## 12. Testing and verification

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
- Recent focused regression evidence includes assistant reminder tests with 55 passing, router reminder tests with 6 passing, and automation reminder checks with 2 passing.
- `npm run lint` passes after the latest reminder, planner, security, and UI changes.
- Full desktop automation suites can observe live Windows state; environment-dependent app/window tests should be run with deterministic mocks or an isolated desktop state.
- `git diff --check` completes without whitespace errors.

The full test suite intentionally logs expected errors for negative tests such as unknown actions, unsafe paths, and invalid plugins.

## 13. Knowledge graph

The graphify graph was rebuilt after the implementation changes. The latest recorded update contains:

- **1,765 nodes**;
- **3,912 edges**;
- **48 communities**.

The highest-connectivity abstractions include `ActionRouter`, `Assistant`, `ActiveLearningManager`, `normalizeText()`, `ContextManager`, `MediaController`, `EntityExtractor`, `SchedulerController`, and `ActiveLearningStore`.

The graph still identifies `ActionRouter` as a god node. This is a maintainability risk, but splitting it must preserve resolver precedence, multi-command behavior, clarification, and fallback semantics.

## 14. Packaging

`npm run build` invokes Electron Builder for Windows x64 and creates an NSIS installer. The package includes application, core, and plugin code inside an ASAR archive. Tests, docs, graph output, and development metadata are excluded.

## 15. Known limitations

- Some command-corpus operations are classified but intentionally reported as unconnected capabilities.
- Screen capture is connected; full screen recording is not currently connected to a recorder controller.
- Messaging and call behavior depends on explicitly supplied chat names, phone numbers, or email addresses and available URI/desktop integration.
- Browser tab discovery and control depend on visible windows, UI Automation, or an available debugging endpoint.
- Application-launch observations can vary when a target application is already open.
- Phone pairing and file transfer require the local phone bridge to be running, Windows identity verification to pass, and the device to hold the required permission scope.
- Calendar/timetable entries are local assistant planner data; external calendar providers are not connected.
- Research and other workspace modes require corresponding user mode configuration to perform useful startup actions.
- The router remains large and should only be decomposed with resolver-precedence regression coverage.

## 16. Recommended next work

1. Connect high-value recognized capabilities from `commands.md` to real controllers, prioritizing screen recording, update management, archives/backups, external calendar providers, notifications, and richer communication controls.
2. Add explicit corpus expectations for executable, clarification, and unsupported outcomes instead of checking intent classification alone.
3. Decompose `ActionRouter` into domain resolver modules while retaining one orchestrator and the current ordering contract.
4. Add plugin-specific integration tests for Chrome, YouTube, Discord, planner, and phone actions.
5. Add deterministic mocks for all tests that can observe live Windows applications, visible browser tabs, or paired phones.

## 17. Conclusion

OpenX now has the requested flat architecture and a connected assistant execution pipeline. It provides broad natural-language classification, deterministic automation for connected actions, safe clarification for missing details, explicit unsupported responses, restricted plugins, active learning, secured Electron IPC, managed persistence, phone pairing/file transfer, local calendar/timetable planning, timer/reminder/stopwatch UI, and a large sandbox command corpus.

The next engineering priority is not broader generic recognition; it is converting the most valuable recognized capabilities into verified, real automation controllers while preserving the current safety contract.
