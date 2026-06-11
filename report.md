# OpenX Project Report

Generated on: 2026-06-02  
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
| `npm run test:voice` | Run voice tests |
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
- Media
- Scheduler
- System information/actions
- Volume
- Windows/session control

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

Mode scoring and behavior profiles now live in `core/context-awareness/mode-engine.js`.
The assistant no longer uses separate hardcoded `core/modes/*` modules.

### `core/voice`

This layer handles voice interaction:

- Hotkey activation
- Speech lifecycle state machine
- Node Windows SAPI speech-to-text
- Transcript reliability and contextual NLU
- Naturalized text-to-speech

### `core/permissions`

This module validates whether an action is allowed. Permission levels are:

| Level | Behavior |
| --- | --- |
| Low | Auto-execute |
| Medium | Requires confirmation |
| High | Requires authentication |
| Critical | Requires authentication and explicit consent |

### `core/ui`

This layer manages backend-driven UI state and notifications. It includes orb state handling, overlays, and notification behavior.

### `core/shared`

This layer contains common shared utilities and the assistant event bus.

### `apps/desktop`

This contains the Electron desktop application:

- `electron/main.js`: Electron main process entry point.
- `preload/index.js`: preload bridge.
- `renderer/chat/index.html`: chat window.
- `renderer/orb/index.html`: orb UI.
- `renderer/settings/index.html`: settings UI.

### `plugins`

This folder contains the plugin manager entry point and a sample plugin. Plugins can register custom intents and respond to assistant lifecycle hooks.

### `tests`

The test suite covers assistant core logic, automation controllers, and voice behavior using Mocha and Chai.

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

Voice reliability was redesigned around a Node-owned Windows SAPI STT engine instead of the previous Python worker. `core/voice/stt/windows-sapi.js` runs one recognition session per hotkey/follow-up listen request and emits the same voice events consumed by `VoiceManager`. It writes each recognition script to a temporary PowerShell file and launches it with `-File`, avoiding Windows `spawn ENAMETOOLONG` crashes when the command grammar grows. Electron now registers the primary `voice.activationShortcut` plus fallback shortcuts and exposes tray > Start Listening, then prints activation/listening console events so startup clearly shows whether activation fired and whether SAPI armed a recognition session. It loads an OpenX command grammar for common verbs, targets, aliases, and polite variants, then returns SAPI alternates so `VoiceManager` can recover an actionable phrase when the primary transcript is wrong. `core/voice/index.js` applies command-aware recovery through `voice.stt.commandRecoveryMinConfidence`, allowing actionable phrases such as "open chrome", "open youtube", and "please open youtube" to reach NLP/NLU routing even when recognition confidence is imperfect. It also blocks one-word non-actions and short filler phrases such as "the know of" or "the tool" before they reach the command router. `core/assistant/nlp/index.js` now performs command-frame extraction and noisy command repair, reducing transcripts such as "ope chrome", "sglkn open lsg chrome", and "sglkn increse lsg volum" to executable commands while preserving file names and multi-action media requests. It also extracts safe actions from conversational speech such as "I was just talking but please open Chrome now", "I was saying search for Java tutorial", "background speech set timer for 5 minutes", and "I was saying stop music", while leaving pure conversation unexecuted. `core/assistant/index.js` resolves contextual follow-ups such as "open it" from recent command entities before routing. Ignored speech returns the voice state machine to idle or, in conversation mode, re-arms only up to `voice.conversationIgnoredSpeechLimit` before ending the conversation without publishing `speechResult`.

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
- WhatsApp desktop communication
- Contact storage and phone number normalization
- Timers, alarms, and reminders
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

Test command:

```bash
npm test
```

Latest verification result: 182 passing.

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

Graph report date: 2026-06-02

Graph stats:

- 83 files analyzed.
- Approximately 111,720 words.
- 738 graph nodes.
- 1,411 graph edges.
- 33 communities detected.
- 76% extracted edges.
- 24% inferred edges.
- 0% ambiguous edges.

Most connected core abstractions:

| Rank | Node | Edge count |
| --- | --- | --- |
| 1 | `emit()` | 37 |
| 2 | `EntityExtractor` | 35 |
| 3 | `VoiceManager` | 29 |
| 4 | `MediaController` | 24 |
| 5 | `ActionRouter` | 22 |
| 6 | `AudioEngine` | 20 |
| 7 | `AppController` | 17 |
| 8 | `Assistant` | 15 |
| 9 | `WindowsSessionController` | 14 |
| 10 | `ContextEngine` | 14 |

Important graphify observations:

- `EntityExtractor` is the highest-degree project abstraction, which shows that entity parsing is central to command routing.
- `emit()` is a major cross-community bridge, connecting voice, assistant, UI, and service modules through events.
- `VoiceManager`, `AudioEngine`, and speech state modules are important in the voice pipeline.
- `ActionRouter` is a central bridge between interpreted commands and executable automation.
- `MediaController`, `AppController`, and `WindowsSessionController` are major automation modules.

Graphify reported two surprising inferred connections:

- `getHomeDirectory()` calls or relates to `SEARCH_ROOTS()`.
- `getSpecialFolders()` calls or relates to `SEARCH_ROOTS()`.

Graphify also reported knowledge gaps around isolated or weakly connected nodes, especially audio lifecycle concepts and some thin automation communities. These may indicate missing documentation, missing graph edges, or modules that should be better connected in docs/tests.

## 20. Community Structure From Graphify

Main detected communities include:

| Community | Main area |
| --- | --- |
| Community 0 | Entity extraction and NLP normalization |
| Community 1 | Audio engine, wake command extraction, and audio processing |
| Community 2 | Logger, speech state machine, and voice manager |
| Community 3 | File/folder automation and path utilities |
| Community 4 | Assistant, context, and personality |
| Community 5 | Action router and orb state |
| Community 6 | Event bus, UI windows, plugins, and notification management |
| Community 7 | App controller and Windows controller |
| Community 8 | Settings, shared object utilities, and runtime reload helpers |
| Community 9 | Media controller |
| Community 10 | Automation engine, intent registry, and sample plugin |
| Community 11 | Brightness and volume controllers |
| Community 12 | Response generation and honorific/style logic |
| Community 13 | Communications and WhatsApp desktop automation |
| Community 14 | Contact store and phone normalization |
| Community 15 | Input parser, system controller, and self-test |
| Community 16 | Windows session controller |
| Community 17 | ID generator and scheduler controller |
| Community 18 | Text-to-speech |
| Community 19 | Permission validator |
| Community 20 | Browser controller |

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
|-- package-lock.json
|-- package.json
|-- report.md
|-- apps/
|   `-- desktop/
|       |-- electron/
|       |   `-- main.js
|       |-- preload/
|       |   `-- index.js
|       `-- renderer/
|           |-- chat/
|           |   `-- index.html
|           |-- orb/
|           |   `-- index.html
|           `-- settings/
|               `-- index.html
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
|   |   |-- nlp/
|   |   |   |-- constants.js
|   |   |   |-- index.js
|   |   |   |-- preprocessor.js
|   |   |   `-- scorer.js
|   |   |-- parser/
|   |   |   `-- index.js
|   |   |-- personality/
|   |   |   `-- index.js
|   |   |-- responses/
|   |   |   |-- index.js
|   |   |   `-- style.js
|   |   `-- router/
|   |       `-- index.js
|   |-- automation/
|   |   |-- apps/
|   |   |   `-- index.js
|   |   |-- brightness/
|   |   |   `-- index.js
|   |   |-- browser/
|   |   |   `-- index.js
|   |   |-- common/
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
|   |   |-- index.js
|   |   |-- media/
|   |   |   `-- index.js
|   |   |-- scheduler/
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
|   |-- permissions/
|   |   `-- index.js
|   |-- settings/
|   |   `-- index.js
|   |-- shared/
|   |   |-- events.js
|   |   `-- index.js
|   |-- ui/
|   |   |-- notifications/
|   |   |   `-- index.js
|   |   |-- orb/
|   |   |   `-- index.js
|   |   |-- overlay/
|   |   |   `-- index.js
|   |   `-- state/
|   |       `-- index.js
|   `-- voice/
|       |-- index.js
|       |-- state/
|       |   `-- index.js
|       |-- stt/
|       |   `-- windows-sapi.js
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
    |   |-- communications.test.js
    |   |-- file-management.test.js
    |   |-- media.test.js
    |   |-- volume-brightness.test.js
    |   `-- windows-session.test.js
    |-- core/
    |   |-- assistant.test.js
    |   |-- entities.test.js
    |   |-- intents.test.js
    |   |-- parser.test.js
    |   |-- permissions.test.js
    |   |-- responses.test.js
    |   |-- router.test.js
    |   `-- settings.test.js
    |-- context-awareness/
    |   |-- context-awareness.test.js
    |   `-- mode-engine.test.js
    |-- device-detection/
    |   `-- device-detection.test.js
    `-- voice/
        |-- pipeline.test.js
        |-- stt-engine.test.js
        |-- voice.test.js
```

## 22. Important Entry Points

| File | Role |
| --- | --- |
| `apps/desktop/electron/main.js` | Electron application startup |
| `apps/desktop/preload/index.js` | Renderer preload bridge |
| `core/assistant/index.js` | Assistant module entry |
| `core/assistant/router/index.js` | Command routing and execution coordination |
| `core/assistant/intents/index.js` | Intent registry |
| `core/assistant/entities/index.js` | Entity extraction |
| `core/automation/index.js` | Automation engine entry |
| `core/context-awareness/active-window.js` | Active window monitor |
| `core/context-awareness/context-engine.js` | Context aggregation and snapshots |
| `core/context-awareness/mode-engine.js` | Mode scoring and transition control |
| `core/context-awareness/process-monitor.js` | Process monitor |
| `core/context-awareness/signals.js` | Context signal emitter |
| `core/device-detection/device-events.js` | Audio/headphone event monitor |
| `core/voice/index.js` | Voice module entry |
| `core/shared/events.js` | Shared event bus |
| `plugins/index.js` | Plugin manager |
| `config/index.js` | Project configuration |

## 23. Strengths

- Clear layered architecture.
- Good separation between assistant logic, automation, voice, UI, settings, permissions, and plugins.
- Deterministic command matching is easier to test and reason about than LLM-based routing.
- Permission validation is part of the command path.
- Tests exist across core, automation, and voice areas.
- Voice reliability and NLU tests cover Node SAPI engine behavior, temp-file SAPI script launching, expanded command grammar generation, alternate transcript recovery, low-confidence/no-speech transcripts, low-confidence fuzzy command recovery, command-frame extraction from conversational speech, noisy STT command repair, pure-conversation rejection, contextual pronoun resolution, one-word and short-phrase non-action filtering, common background hallucination phrases, and repeated ignored-noise conversation re-arming.
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
