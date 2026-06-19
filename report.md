# OpenX Project Report

Generated on: 2026-06-19
Project path: `C:\Users\rakes\Documents\OpenX`

## 1. Project Overview

OpenX is an offline-first intelligent Windows desktop assistant platform. It is built as a Node.js and Electron desktop application with Node-owned Windows SAPI voice support and Windows-native automation through PowerShell, Win32 APIs, WMI, COM/ActiveX, and Windows SAPI.

The project is designed to provide deterministic voice-controlled automation without depending on cloud LLM services. Voice input and chat input both enter the same assistant command pipeline, which handles parsing, NLP normalization, intent matching, entity extraction, permission validation, action routing, automation execution, and response generation.

## 2. Basic Project Information

| Property | Value |
| --- | --- |
| Project name | OpenX |
| Package name | `jarvis-assistant` |
| Version | `1.0.0` |
| Platform | Windows 10+ |
| Runtime | Node.js 18+ |
| Desktop framework | Electron |
| Main entry point | `apps/desktop/electron/main.js` |
| License | MIT |
| Main language | JavaScript |
| Supporting language | Windows PowerShell scripts invoked from Node |

## 3. Main Purpose

OpenX acts as a local desktop assistant that can:

- Listen for hotkey-activated voice commands.
- Accept typed commands through the desktop UI.
- Match natural language commands to deterministic intents.
- Extract command entities such as app names, paths, files, folders, URLs, media targets, contacts, and numeric values.
- Validate permissions before executing sensitive actions.
- Execute Windows automation tasks.
- Generate deterministic assistant responses.
- Support plugins that register custom behavior.

## 4. Key Features

- Offline-first assistant behavior.
- Deterministic NLP pipeline with no required LLM dependency.
- Hotkey activation and Node-owned speech-to-text workflow.
- Naturalized text-to-speech responses.
- Windows-native automation engine.
- Modular automation controllers.
- Permission-based execution model.
- Centralized assistant-owned memory and runtime data under `OpenX_Data`.
- Multi-window Electron interface.
- Event-driven coordination through a shared event bus.
- Plugin support with lifecycle hooks.
- Local-only processing for privacy and performance.

## 5. Technology Stack

### Core Technologies

- Node.js 18+
- Electron 28
- PowerShell
- Win32 API
- WMI
- COM / ActiveX
- Windows SAPI

### Runtime Dependencies

| Package | Purpose |
| --- | --- |
| `active-win` | Foreground application and active window detection |
| `electron-store` | Persistent JSON settings |
| `double-metaphone` | Phonetic matching for media and noisy command understanding |
| `fuse.js` | Fuzzy search support |
| `uuid` | Unique ID generation |

### Optional Dependencies

| Package | Purpose |
| --- | --- |
| `node-windows` | Windows service integration |

### Development Dependencies

| Package | Purpose |
| --- | --- |
| `electron` | Desktop shell |
| `electron-builder` | Windows packaging |
| `mocha` | Test runner |
| `chai` | Assertions |
| `eslint` | JavaScript linting |

## 6. NPM Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Electron application |
| `npm run dev` | Start the Electron application in dev mode |
| `npm test` | Run all tests recursively |
| `npm run test:core` | Run core tests |
| `npm run test:automation` | Run automation tests |
| `npm run lint` | Run ESLint |
| `npm run package` | Build Windows package with Electron Builder |

## 7. High-Level Architecture

OpenX follows a layered, event-driven architecture:

```text
Wake Word / Chat Input
  -> Shared Event Bus
  -> Voice State Machine
  -> Listener / VAD / Buffering
  -> Speech To Text
  -> Parser / NLP / Intent Matching
  -> Entity Extraction
  -> Permission Validation
  -> Action Router
  -> Automation Engine
  -> Response Generator / TTS
  -> UI State Synchronization
```

The important architectural rule is that UI surfaces do not execute automation directly. Voice and chat commands go through the same backend command pipeline.

## 8. Command Processing Pipeline

The shared command pipeline has these stages:

1. Input normalization: lowercase, trim, punctuation cleanup, wake-word stripping.
2. NLP processing: phrase replacement, filler removal, token cleanup, scoring support.
3. Intent matching: compare normalized input against registered command patterns.
4. Entity extraction: extract structured command values such as apps, paths, URLs, files, folders, media queries, contacts, and numbers.
5. Permission validation: decide whether the command can run automatically or requires confirmation/authentication.
6. Action routing: map the intent to the correct automation module.
7. Automation execution: run the Windows/system action.
8. Response generation: create a deterministic assistant response.
9. Output delivery: update UI and optionally speak the response.

Example:

```text
User: "Jarvis, open calculator"
  -> Wake word detected
  -> Command normalized
  -> Intent matched: app.open
  -> Entity extracted: calculator
  -> Permission checked
  -> App automation executed
  -> Response generated
```

## 9. Main Modules

### `core/assistant`

This is the main assistant processing layer.

- `parser`: strips wake words and normalizes command text.
- `nlp`: preprocesses input, handles phrase normalization, spelling tolerance, and scoring.
- `intents`: stores known command patterns, actions, permissions, and required entities.
- `entities`: extracts structured values from natural language.
- `router`: orchestrates the command pipeline and routes actions.
- `context`: stores session state and command history.
- `learning`: stores bounded active-learning memory, personal facts, preferences, corrections, feedback, and routing evidence.
- `nlu`: provides natural-language frame parsing and routing support for word-level command understanding.
- `responses`: creates deterministic responses.
- `personality`: applies assistant tone and style rules.

### `core/automation`

This layer performs Windows automation. It contains controllers for:

- Applications
- Browser actions
- Brightness
- Communications
- Files
- Folders
- Forms
- Media
- Scheduler
- Screenshot capture
- System information/actions
- Volume
- Windows/session control

Application lifecycle automation canonicalizes common app aliases, focuses legitimate existing windows, launches Win32 or Start-menu/UWP apps, and verifies bounded open/close postconditions. Browser matching requires the browser identity in the window title, preventing Chrome-hosted PWAs such as YouTube or Instagram from being mistaken for the Chrome browser itself.

### `core/context-awareness`

This layer detects local Windows environment signals and converts them into contextual assistant state.

- `active-window.js`: polls the foreground application every 500ms and normalizes app, title, path, pid, and timestamp.
- `process-monitor.js`: scans running processes through local PowerShell/WMI and emits start/stop changes.
- `signals.js`: centralized local event emitter for environment changes.
- `app-registry.js`: categorizes known developer, streaming, media, game, and work applications.
- `context-engine.js`: aggregates local context signals into normalized context snapshots and activity history.
- `mode-engine.js`: scores assistant modes, applies transition safety, and emits mode changes.

### `core/device-detection`

This layer detects local audio output and headphone state.

- `audio-devices.js`: reads active audio output and enumerates known local audio devices.
- `headphones.js`: detects headphone and Bluetooth device state.
- `device-events.js`: debounces device changes and emits audio/headphone events.

### Context mode profiles

Mode scoring and behavior profiles live in `core/context-awareness/mode-engine.js`.

### `core/voice`

This layer handles voice interaction:

- Naturalized text-to-speech
- Windows SAPI voice selection and speaking-rate/volume handling

### `core/permissions`

This module validates whether an action is allowed. Permission levels are:

| Level | Behavior |
| --- | --- |
| Low | Auto-execute |
| Medium | Requires confirmation |
| High | Requires authentication |
| Critical | Requires authentication and explicit consent |

### `core/ui`

This layer manages backend-driven UI notifications and overlays.

### `core/shared`

This layer contains common shared utilities, the assistant event bus, and the centralized assistant data-root manager.

### Assistant Data And Memory

Assistant-owned data is centralized under `%USERPROFILE%\OpenX_Data` by default. The managed layout is:

```text
OpenX_Data/
|-- settings.json
|-- contacts.json
|-- learning.json
|-- logs/
|-- runtime/
|   |-- chrome-media-profile/
|   `-- crash-recovery.json
`-- cache/
```

`core/shared/data-root.js` builds this layout, creates required directories, and safely migrates existing `%USERPROFILE%\.jarvis` settings, contacts, and learning files without overwriting newer `OpenX_Data` files.

### `apps/desktop`

This contains the Electron desktop application:

- `electron/main.js`: Electron main process entry point.
- `electron/security.js`: trusted-renderer checks, hardened web preferences, and channel-specific IPC payload validation.
- `electron/crash-recovery.js`: persisted bounded relaunch policy that prevents startup crash loops.
- `preload/index.js`: preload bridge.
- `renderer/chat/index.html`: chat window.
- `renderer/settings/index.html`: settings UI.

### `plugins`

This folder contains the plugin manager entry point and a sample plugin. Plugins can register custom intents and respond to assistant lifecycle hooks.

### `tests`

The test suite covers assistant core logic, automation controllers, and voice behavior using Mocha and Chai.

### Electron Security, Recovery, And Logging

- Browser windows explicitly enable sandboxing, context isolation, and web security while disabling Node integration, subframe/worker Node integration, remote-module access, insecure content, and webviews.
- Renderer navigation and popups are denied unless they remain on the expected local application view.
- Every IPC channel validates both the sender origin and a bounded payload schema; forbidden object keys are rejected before settings or command handling.
- Renderer crashes are recovered with a bounded restart budget. Fatal main-process failures write crash evidence, clean up services, and use a persisted crash-loop policy before relaunching.
- `core/shared/index.js` writes redacted JSON Lines application/error/crash logs with 10 MB size rotation and five-file retention. File logging is enabled by the production logging configuration and remains off for unconfigured unit instances.

## 10. Event System

OpenX uses a shared event bus through `core/shared/events.js`. The event system coordinates voice, assistant processing, automation, responses, and UI state.

Important lifecycle events include:

- Wake word detected
- Listener started
- Speech detected
- Utterance finalized
- STT completed
- Intent detected
- Command executed
- Response generated
- UI state changed
- Settings updated
- Plugin loaded
- Error events

The local context system emits these signal events:

- `active-window-changed`
- `process-started`
- `process-stopped`
- `headphones-connected`
- `headphones-disconnected`
- `audio-device-changed`
- `mode-entered`
- `mode-exited`
- `mode-changed`

## 11. Voice Workflow

Voice mode follows this flow:

```text
User says wake word
  -> Wake word detected
  -> Orb changes to listening state
  -> Assistant captures audio
  -> Node-owned Windows SAPI recognition listens for one utterance
  -> Speech-to-text converts audio into text
  -> Transcript reliability and contextual NLU normalize the request
  -> Text enters shared assistant pipeline
  -> Automation executes
  -> Response is generated
  -> Naturalized SAPI text-to-speech speaks response
```

The current repository keeps voice output in `core/voice/tts/index.js`, backed by Windows SAPI text-to-speech. Chat and any recognized command text enter the same deterministic assistant pipeline. `core/assistant/nlp/index.js`, `core/assistant/nlu/index.js`, and `core/assistant/router/command-frame.js` now perform command-frame extraction, typo/noise repair, multi-command splitting, and semantic routing. This allows examples such as "ope chrome", "sglkn open lsg chrome", "sglkn increse lsg volum", "stop the video and set vol to 100", and "I was just talking but please open Chrome now" to resolve to executable commands while leaving pure conversation unexecuted. `core/assistant/index.js` resolves contextual follow-ups such as "open it" from recent command entities before routing.

TTS now prefers configurable natural Windows voices, defaults to a slightly slower rate, keeps volume audible, and can speak SSML with short punctuation pauses through `voice.tts.naturalize`.

The speech state machine includes:

```text
IDLE
  -> WAKE_DETECTED
  -> LISTENING
  -> HEARING_SPEECH
  -> PROCESSING
  -> RESPONDING
  -> IDLE
```

## 12. Automation Capabilities

The built-in automation layer supports:

- Volume control
- Brightness control
- App launching and closing
- File creation, deletion, rename, copy, move, and search
- Folder creation, deletion, and opening
- Browser URL opening and web search
- Media playback control
- Form understanding and form auto-fill
- WhatsApp desktop communication
- Contact storage and phone number normalization
- Timers, alarms, and reminders
- Screenshot capture
- System monitoring
- Windows lock, sleep, shutdown, restart, hibernate, logoff
- Window minimize, maximize, close, focus, and navigation actions

Context capabilities:

- Current foreground app detection.
- Active window title detection.
- Active app executable path and process id detection.
- Running process monitoring.
- Known process category mapping.
- Active audio output detection.
- Bluetooth/wired headphone detection.
- Audio device switching events.
- Debounced device event emission.
- Activity mode detection for development, streaming, gaming, media, work, and focus sessions.
- Adaptive assistant behavior profiles based on current context.

## 13. Plugin System

Plugins are loaded through the plugin manager. A plugin can register custom behavior and use lifecycle hooks.

Plugin lifecycle:

```text
PluginManager.loadAll()
  -> Discover plugins
  -> Initialize plugin
  -> Register custom intents
  -> Execute lifecycle hooks
```

Supported hook concepts include:

- `onCommand`
- `onResponse`
- `onStateChange`
- `onWakeWord`
- `onSettingsChange`

## 14. UI System

The desktop interface includes:

- Orb window
- Chat window
- Settings window

The README lists supported themes:

| Theme | Accent |
| --- | --- |
| Midnight | Blue |
| Dawn | Orange |
| Forest | Green |
| Graphite | Gray |

## 15. Documentation Structure

The `docs` directory contains:

- Architecture overview
- Core engine module documentation
- NLP pipeline documentation
- Assistant communication documentation
- Communications module documentation
- Settings module documentation
- Plugin development guide
- Installation guide
- Command execution workflow

## 16. Testing

The project contains tests for:

- Assistant pipeline
- Parser
- NLP and intent matching
- Entity extraction
- Router behavior
- Response generation
- Settings
- Permission validation
- Automation engine
- App automation
- Communications automation
- File management
- Media automation
- Volume and brightness
- Windows session control
- Voice pipeline
- Wake word behavior
- Context awareness
- Device detection
- Mode scoring
- Mode transition stability
- Electron IPC and BrowserWindow security
- Crash-loop recovery and corrupt recovery-state handling
- Structured logger redaction, rotation, and retention

Test command:

```bash
npm test
```

Latest complete verification result: 465 passing, with repository-wide ESLint passing.

## 17. Context Awareness And Device Detection

Goal: make OpenX aware of the local Windows environment.

Status: implemented.

Implemented deliverables:

| Deliverable | Status |
| --- | --- |
| Active window detection | Complete |
| 500ms active-window polling contract | Complete |
| Active app/title/path/pid/timestamp output | Complete |
| App registry categories | Complete |
| Running process monitor | Complete |
| Process start/stop events | Complete |
| Central signal emitter | Complete |
| Audio device manager | Complete |
| Headphone detection helpers | Complete |
| Bluetooth device helper | Complete |
| Debounced device events | Complete |
| Local-only deterministic implementation | Complete |
| Tests | Complete |

Context and device modules:

| File | Purpose |
| --- | --- |
| `core/context-awareness/active-window.js` | Active foreground window monitor using `active-win` |
| `core/context-awareness/process-monitor.js` | Running process monitor using local PowerShell/WMI |
| `core/context-awareness/signals.js` | Signal/event emitter for context changes |
| `core/context-awareness/app-registry.js` | Known application category registry |
| `core/device-detection/audio-devices.js` | Active audio output and audio device metadata |
| `core/device-detection/headphones.js` | Headphone and Bluetooth detection helpers |
| `core/device-detection/device-events.js` | Debounced audio/headphone event monitor |

Active window normalized output:

```js
{
  app: "Code.exe",
  title: "OpenX - Visual Studio Code",
  path: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
  pid: 1234,
  timestamp: 123456789
}
```

Audio device normalized output:

```js
{
  name: "WH-1000XM4",
  type: "bluetooth-headphones",
  active: true,
  id: "device-id",
  timestamp: 123456789
}
```

## 18. Adaptive Mode Intelligence

Goal: convert raw environment signals into intelligent assistant modes.

Status: implemented.

Implemented deliverables:

| Deliverable | Status |
| --- | --- |
| Context engine | Complete |
| Mode engine | Complete |
| Weighted scoring | Complete |
| Dominant mode selection | Complete |
| Score smoothing and decay | Complete |
| Minimum dominance duration | Complete |
| Minimum mode duration | Complete |
| Cooldown handling | Complete |
| Hysteresis against flapping | Complete |
| Mode transition events | Complete |
| Mode behavior handlers | Complete |
| Activity history tracking | Complete |
| Tests | Complete |

Supported modes:

| Mode | Primary triggers | Behavior |
| --- | --- | --- |
| `DEV_MODE` | VS Code, terminal, Docker, developer titles | Reduced verbosity, terminal intent priority, developer shortcuts |
| `STREAM_MODE` | OBS, Streamlabs, microphone activity | Speech muting, overlay-only notifications, interruption suppression |
| `GAME_MODE` | Fullscreen apps, Steam/game executables | Lower overhead, overlay suppression, reduced CPU usage |
| `MEDIA_MODE` | Spotify, YouTube, media titles/audio output | Media command priority and reduced notifications |
| `WORK_MODE` | Teams, Outlook, Zoom, productivity apps | Reduced interruptions and productivity shortcuts |
| `FOCUS_MODE` | Long uninterrupted activity, fullscreen work, manual focus flag | Minimal responses and suppressed non-essential notifications |

Context flow:

```text
Foreground Apps
+ Running Processes
+ Audio Signals
+ Window Titles
+ Environment Signals
        |
        v
Context Engine
        |
        v
Mode Scoring Engine
        |
        v
Assistant Mode State
        |
        v
Adaptive Assistant Behavior
```

Context snapshot format:

```js
{
  activeApp: "Code.exe",
  activeTitle: "OpenX - Visual Studio Code",
  runningApps: ["Code.exe", "Docker Desktop.exe"],
  audioDevice: "WH-1000XM4",
  fullscreen: false,
  timestamp: 123456789,
  currentMode: "DEV_MODE"
}
```

Mode state format:

```js
{
  currentMode: "DEV_MODE",
  scores: {
    DEV_MODE: 80,
    MEDIA_MODE: 10,
    GAME_MODE: 0
  },
  enteredAt: 123456789,
  duration: 30000
}
```

## 19. Graphify Knowledge Graph Summary

The project includes a graphify knowledge graph in `graphify-out/`.

Graph report date: 2026-06-19

Graph stats:

- 91 files analyzed.
- Approximately 209,241 words.
- 1,118 graph nodes.
- 2,408 graph edges.
- 41 communities detected.
- 78% extracted edges.
- 22% inferred edges.
- 0% ambiguous edges.

Most connected core abstractions:

| Rank | Node | Edge count |
| --- | --- | --- |
| 1 | `ActionRouter` | 110 |
| 2 | `Assistant` | 55 |
| 3 | `MediaController` | 45 |
| 4 | `ContextManager` | 42 |
| 5 | `EntityExtractor` | 37 |
| 6 | `ActiveLearningStore` | 30 |
| 7 | `FileController` | 29 |
| 8 | `FormAutomation` | 29 |
| 9 | `AppController` | 26 |
| 10 | `BrowserController` | 26 |

Important graphify observations:

- `ActionRouter` is the highest-degree abstraction and remains the main bridge between parsed language and executable automation.
- `Assistant`, `ContextManager`, and `ActiveLearningStore` are central to conversation state, follow-up resolution, active learning, and memory.
- `EntityExtractor`, `NaturalLanguageRouter`, and `CommandFrameParser` form the core language-understanding path.
- `MediaController`, `FileController`, `FormAutomation`, `AppController`, and `BrowserController` are major automation modules.
- `buildDataPaths()`, `ensureDataRoot()`, and `migrateLegacyData()` are now visible in the settings/data community.

Graphify reported these surprising inferred connections:

- `ensureDataDir()` calls or relates to `ensureDataRoot()`.
- `ensureDataDir()` calls or relates to `migrateLegacyData()`.
- `getHomeDirectory()` calls or relates to `SEARCH_ROOTS()`.
- `getSpecialFolders()` calls or relates to `SEARCH_ROOTS()`.

Graphify also reported knowledge gaps around isolated or weakly connected nodes, especially audio lifecycle concepts and some thin automation communities. These may indicate missing documentation, missing graph edges, or modules that should be better connected in docs/tests.

## 20. Community Structure From Graphify

Main detected communities include:

| Community | Main area |
| --- | --- |
| Community 0 | Action router and command execution coordination |
| Community 1 | Assistant, context manager, personality, and text compaction |
| Community 2 | Event bus, plugins, notification management, mode engine, and TTS |
| Community 3 | Audio device and headphone/device event detection |
| Community 4 | File/folder automation and path/search utilities |
| Community 5 | Media controller and Windows session helpers |
| Community 6 | Settings service, data-root management, runtime config, and UI startup helpers |
| Community 7 | Scheduler, system controller, and media parser helpers |
| Community 8 | NLP processor and normalization utilities |
| Community 9 | Command-frame parsing and entity extraction |
| Community 10 | Contact store and communications automation |
| Community 11 | Form automation and form understanding |
| Community 12 | Active-learning memory, preferences, facts, corrections, and routing evidence |
| Community 13 | App controller and input parsing helpers |
| Community 14 | Automation engine and Windows controller |
| Community 15 | Browser controller and web result parsing |
| Community 16 | Action verifier |
| Community 17 | Brightness and volume controllers |
| Community 18 | Natural-language router |
| Community 19 | Response generation and honorific/style logic |
| Community 20 | Process monitor and app categorization |
| Community 21 | Context engine payload helpers |
| Community 22 | Active-window monitor |
| Community 23 | Phonetic and platform mapping |

## 21. Directory Tree

Generated/vendor/cache directories such as `.git`, `node_modules`, `.code-review-graph`, and `graphify-out/cache` are intentionally excluded from this readable tree.

```text
OpenX/
|-- .codex/
|-- .cursor/
|-- .gitignore
|-- AGENTS.md
|-- README.md
|-- RULES.md
|-- eslint.config.mjs
|-- package-lock.json
|-- package.json
|-- report.md
|-- apps/
|   `-- desktop/
|       |-- electron/
|       |   |-- crash-recovery.js
|       |   |-- main.js
|       |   `-- security.js
|       |-- preload/
|       |   `-- index.js
|       `-- renderer/
|           |-- chat/
|           |   |-- index.css
|           |   |-- index.html
|           |   `-- index.js
|           `-- settings/
|               |-- index.css
|               |-- index.html
|               `-- index.js
|-- bin/
|   `-- whisper/
|       |-- bench.exe
|       |-- command.exe
|       |-- ggml.dll
|       |-- ggml-base.dll
|       |-- ggml-cpu.dll
|       |-- main.exe
|       |-- SDL2.dll
|       |-- stream.exe
|       |-- test.wav
|       |-- test-vad.exe
|       |-- test-vad-full.exe
|       |-- wchess.exe
|       |-- whisper.dll
|       |-- whisper-bench.exe
|       |-- whisper-cli.exe
|       |-- whisper-command.exe
|       |-- whisper-lsp.exe
|       |-- whisper-quantize.exe
|       |-- whisper-server.exe
|       |-- whisper-stream.exe
|       |-- whisper-talk-llama.exe
|       `-- whisper-vad-speech-segments.exe
|-- config/
|   `-- index.js
|-- core/
|   |-- assistant/
|   |   |-- context/
|   |   |   `-- index.js
|   |   |-- entities/
|   |   |   `-- index.js
|   |   |-- index.js
|   |   |-- intents/
|   |   |   `-- index.js
|   |   |-- learning/
|   |   |   `-- index.js
|   |   |-- nlp/
|   |   |   |-- constants.js
|   |   |   |-- index.js
|   |   |   |-- preprocessor.js
|   |   |   |-- scorer.js
|   |   |   `-- web-targets.js
|   |   |-- nlu/
|   |   |   `-- index.js
|   |   |-- parser/
|   |   |   `-- index.js
|   |   |-- personality/
|   |   |   `-- index.js
|   |   |-- responses/
|   |   |   |-- index.js
|   |   |   `-- style.js
|   |   `-- router/
|   |       |-- command-frame.js
|   |       `-- index.js
|   |-- automation/
|   |   |-- apps/
|   |   |   `-- index.js
|   |   |-- brightness/
|   |   |   `-- index.js
|   |   |-- browser/
|   |   |   `-- index.js
|   |   |-- common/
|   |   |   |-- action-verifier.js
|   |   |   |-- launcher.js
|   |   |   |-- path-utils.js
|   |   |   `-- windows-session.js
|   |   |-- communications/
|   |   |   |-- contact-store.js
|   |   |   |-- index.js
|   |   |   `-- whatsapp-desktop.js
|   |   |-- files/
|   |   |   `-- index.js
|   |   |-- folders/
|   |   |   `-- index.js
|   |   |-- forms/
|   |   |   |-- index.js
|   |   |   `-- understanding.js
|   |   |-- index.js
|   |   |-- media/
|   |   |   `-- index.js
|   |   |-- scheduler/
|   |   |   `-- index.js
|   |   |-- screenshot/
|   |   |   `-- index.js
|   |   |-- system/
|   |   |   `-- index.js
|   |   |-- volume/
|   |   |   `-- index.js
|   |   `-- windows/
|   |       `-- index.js
|   |-- context-awareness/
|   |   |-- active-window.js
|   |   |-- app-registry.js
|   |   |-- context-engine.js
|   |   |-- mode-engine.js
|   |   |-- process-monitor.js
|   |   `-- signals.js
|   |-- device-detection/
|   |   |-- audio-devices.js
|   |   |-- device-events.js
|   |   `-- headphones.js
|   |-- media-understanding/
|   |   |-- media-router.js
|   |   |-- parser.js
|   |   |-- phonetic.js
|   |   `-- platform-mapper.js
|   |-- permissions/
|   |   `-- index.js
|   |-- settings/
|   |   `-- index.js
|   |-- shared/
|   |   |-- data-root.js
|   |   |-- events.js
|   |   `-- index.js
|   |-- ui/
|   |   |-- notifications/
|   |   |   `-- index.js
|   |   `-- overlay/
|   |       `-- index.js
|   `-- voice/
|       `-- tts/
|           `-- index.js
|-- docs/
|   |-- architecture/
|   |   `-- overview.md
|   |-- modules/
|   |   |-- assistant-communication.md
|   |   |-- communications.md
|   |   |-- core-engine.md
|   |   |-- nlp-pipeline.md
|   |   `-- settings.md
|   |-- plugins/
|   |   `-- development.md
|   |-- setup/
|   |   `-- installation.md
|   `-- workflows/
|       `-- command-execution.md
|-- graphify-out/
|   |-- GRAPH_REPORT.md
|   |-- graph.html
|   `-- graph.json
|-- plugins/
|   |-- index.js
|   `-- sample_plugin/
|       |-- index.js
|       `-- plugin.json
`-- tests/
    |-- automation/
    |   |-- apps.test.js
    |   |-- automation.test.js
    |   |-- browser.test.js
    |   |-- communications.test.js
    |   |-- file-management.test.js
    |   |-- media.test.js
    |   |-- volume-brightness.test.js
    |   `-- windows-session.test.js
    |-- context-awareness/
    |   |-- context-awareness.test.js
    |   `-- mode-engine.test.js
    |-- core/
    |   |-- assistant.test.js
    |   |-- command-corpus.test.js
    |   |-- crash-recovery.test.js
    |   |-- data-root.test.js
    |   |-- electron-security.test.js
    |   |-- entities.test.js
    |   |-- intents.test.js
    |   |-- learning.test.js
    |   |-- logger.test.js
    |   |-- media-youtube-corpus.test.js
    |   |-- nlp.test.js
    |   |-- nlu.test.js
    |   |-- parser.test.js
    |   |-- permissions.test.js
    |   |-- responses.test.js
    |   |-- renderer-security.test.js
    |   |-- router.test.js
    |   |-- security-critical.test.js
    |   `-- settings.test.js
    |-- device-detection/
    |   `-- device-detection.test.js
    `-- media-understanding/
        `-- media-understanding.test.js
```

## 22. Important Entry Points

| File | Role |
| --- | --- |
| `apps/desktop/electron/main.js` | Electron application startup |
| `apps/desktop/electron/security.js` | Trusted renderer boundary, hardened web preferences, and IPC schema validation |
| `apps/desktop/electron/crash-recovery.js` | Persisted bounded restart and crash-loop suppression policy |
| `apps/desktop/preload/index.js` | Renderer preload bridge |
| `core/assistant/index.js` | Assistant module entry |
| `core/assistant/router/index.js` | Command routing and execution coordination |
| `core/assistant/router/command-frame.js` | Word/frame-level command parsing support |
| `core/assistant/nlu/index.js` | Natural-language routing and command frame interpretation |
| `core/assistant/learning/index.js` | Active-learning memory, preferences, facts, corrections, and routing evidence |
| `core/assistant/intents/index.js` | Intent registry |
| `core/assistant/entities/index.js` | Entity extraction |
| `core/automation/index.js` | Automation engine entry |
| `core/automation/common/action-verifier.js` | Shared action result validation helpers |
| `core/automation/forms/index.js` | Form automation entry |
| `core/automation/forms/understanding.js` | Form field understanding and validation |
| `core/automation/screenshot/index.js` | Screenshot automation |
| `core/media-understanding/parser.js` | Media command parsing |
| `core/media-understanding/media-router.js` | Media intent routing |
| `core/context-awareness/active-window.js` | Active window monitor |
| `core/context-awareness/context-engine.js` | Context aggregation and snapshots |
| `core/context-awareness/mode-engine.js` | Mode scoring and transition control |
| `core/context-awareness/process-monitor.js` | Process monitor |
| `core/context-awareness/signals.js` | Context signal emitter |
| `core/device-detection/device-events.js` | Audio/headphone event monitor |
| `core/voice/tts/index.js` | Windows SAPI text-to-speech |
| `core/shared/data-root.js` | Centralized `OpenX_Data` layout, directory creation, and legacy migration |
| `core/shared/events.js` | Shared event bus |
| `plugins/index.js` | Plugin manager |
| `config/index.js` | Project configuration |

## 23. Strengths

- Clear layered architecture.
- Good separation between assistant logic, automation, voice, UI, settings, permissions, and plugins.
- Deterministic command matching is easier to test and reason about than LLM-based routing.
- Permission validation is part of the command path.
- Tests exist across core, automation, settings, NLU, media-understanding, context-awareness, and device-detection areas.
- NLU and routing tests cover command-frame extraction from conversational speech, noisy command repair, pure-conversation rejection, contextual pronoun resolution, multi-command execution, active-learning feedback records, and centralized data-root storage.
- Documentation exists for architecture, setup, modules, workflows, and plugins.
- Graphify knowledge graph exists and gives useful insight into central abstractions.
- Context sensing is modular, local-only, event-driven, and covered by tests.
- Mode intelligence reuses existing context signals and avoids duplicate environment polling.

## 24. Risks And Improvement Areas

- Some graphify communities have low cohesion, especially NLP/entity extraction and audio-related modules. This may indicate modules that are broad or under-documented.
- `emit()` is a major cross-community bridge, so event contracts should be documented and tested carefully.
- `EntityExtractor` is highly connected and likely carries significant behavioral risk when changed.
- Voice/audio lifecycle concepts appear as weakly connected nodes in the graph report, which may indicate missing documentation or incomplete graph extraction.
- STT thresholds are command-aware defaults and may need microphone-specific tuning through `voice.conversationIgnoredSpeechLimit`, `voice.stt.minConfidence`, and `voice.stt.commandRecoveryMinConfidence`.
- The README and package name differ: README calls the project OpenX, while `package.json` uses `jarvis-assistant`.
- Audio endpoint detection depends on Windows PowerShell and MMDevice interop, so runtime failures should remain logged and non-fatal.
- Mode scoring is deterministic and rule-based; future changes should tune weights with tests to avoid accidental mode flapping.

## 25. Recommended Next Steps

- Keep `graphify-out/GRAPH_REPORT.md` updated when code changes.
- Add or improve documentation for event names, payload shapes, and lifecycle guarantees.
- Add more focused tests around `EntityExtractor`, `ActionRouter`, context signal wiring, and mode behavior consumption as future features build on adaptive modes.
- Wire mode behavior into assistant response/voice/UI layers through shared pipeline contracts, not direct UI automation.
- Consider removing generated `__pycache__` files from the repo if they are tracked.
- Confirm whether the public project name should be OpenX or Jarvis Assistant and align metadata if needed.
- Review thin graphify communities to decide whether they need stronger docs, tests, or module boundaries.
