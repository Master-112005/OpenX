# OpenX - Intelligent Windows Desktop Assistant Platform

## Overview

OpenX is an offline-first intelligent Windows desktop assistant built with Node.js, Electron, and Windows-native services. It provides deterministic voice-controlled automation, local AI-style command processing, system-level automation, and modular plugin support without relying on cloud services.

The platform is designed around a layered architecture with intent routing, entity extraction, permission validation, event-driven communication, and Windows-native automation.

---

# Key Features

* Offline-first voice assistant
* Deterministic NLP pipeline (No LLM dependency)
* Windows-native automation engine
* Chat-first deterministic command processing with TTS response output
* Naturalized Windows SAPI text-to-speech
* Modular plugin system
* Event-driven architecture
* Context signal foundation for active windows and processes
* Adaptive mode engine for development, streaming, gaming, media, work, and focus contexts
* Centralized assistant memory and runtime data under `%USERPROFILE%\OpenX_Data`
* Permission-based execution model
* Multi-window Electron desktop interface
* 80+ built-in intents
* Local-only processing for privacy and performance
* Hardened Electron renderer sandbox with trusted-origin IPC validation
* Bounded renderer/main-process crash recovery with restart-loop suppression
* Structured, redacted, size-rotated logs under `OpenX_Data/logs`
* **Form auto-fill with personal context learning**
* **Multi-command natural language processing (",", "and", "then", "also", "plus")**
* **40+ verb action vocabulary with advanced fuzzy matching**
* **Formal servant-style responses with consistent honorific address**
* **Context-aware error handling and clarification recovery**

---

# Project Information

| Property          | Value                           |
| ----------------- | ------------------------------- |
| Name              | OpenX                           |
| Version           | 1.0.0                           |
| Platform          | Windows 10+                     |
| Runtime           | Node.js 18+                     |
| Desktop Framework | Electron                        |
| License           | MIT                             |
| Entry Point       | `apps/desktop/electron/main.js` |

---

# Tech Stack

## Core Technologies

* Node.js 18+
* Electron ^28.0.0
* PowerShell
* Win32 API
* WMI
* COM / ActiveX
* Windows SAPI

## Node.js Dependencies

| Package          | Purpose                             |
| ---------------- | ----------------------------------- |
| electron         | Desktop shell and window management |
| active-win       | Foreground application and active window detection |
| electron-store   | Persistent JSON settings            |
| double-metaphone | Phonetic matching for media and noisy command understanding |
| fuse.js          | Fuzzy search support |
| electron-builder | Windows packaging                   |
| uuid             | Unique identifiers                  |
| mocha            | Testing framework                   |
| chai             | Assertions                          |
| eslint           | Code linting                        |

## Optional Dependencies

| Package      | Purpose                    |
| ------------ | -------------------------- |
| node-windows | Windows service management |

---

# Architecture

## 9-Stage Processing Pipeline

```text
Input Sources (Voice / Chat)
        ↓
1. Parser
        ↓
2. NLP Processing
        ↓
3. Intent Matching
        ↓
4. Entity Extraction
        ↓
5. Permission Validation
        ↓
6. Action Routing
        ↓
7. Automation Execution
        ↓
8. Response Generation
        ↓
9. Output Delivery
```

---

# Directory Structure

```text
OpenX/
|-- apps/
|   `-- desktop/
|-- bin/
|   `-- whisper/
|-- config/
|-- core/
|   |-- assistant/
|   |   |-- context/
|   |   |-- entities/
|   |   |-- intents/
|   |   |-- learning/
|   |   |-- nlp/
|   |   |-- nlu/
|   |   |-- parser/
|   |   |-- personality/
|   |   |-- responses/
|   |   `-- router/
|   |-- automation/
|   |   |-- apps/
|   |   |-- brightness/
|   |   |-- browser/
|   |   |-- common/
|   |   |-- communications/
|   |   |-- files/
|   |   |-- folders/
|   |   |-- forms/
|   |   |-- media/
|   |   |-- scheduler/
|   |   |-- screenshot/
|   |   |-- system/
|   |   |-- volume/
|   |   `-- windows/
|   |-- context-awareness/
|   |-- media-handling/
|   |-- permissions/
|   |-- settings/
|   |-- shared/
|   `-- voice/
|-- docs/
|-- graphify-out/
|-- plugins/
`-- tests/
```

---

# Core Modules

## Assistant Pipeline

* InputParser
* NLP Processor
* Intent Registry
* Entity Extractor
* Action Router
* Context Manager
* Response Generator
* **Learning Engine** — active learning, personal facts, preferences, and command corrections; credential-like facts are rejected and purged
* **Natural Language Understanding** — command-frame parsing, multi-command splitting, semantic routing, and typo/noise repair
* **Response Style Engine** — formal servant tone, honorific application, context-aware responses

## Automation Controllers

* Volume Controller
* Brightness Controller
* File Controller
* Folder Controller
* App Controller
* Browser Controller
* Media Controller
* Communications Controller
* System Controller
* Windows Controller
* Scheduler Controller
* **Form Controller** — intelligent form field analysis, type inference, and auto-fill using personal context
* Screenshot Controller

## Context Awareness

* Active Window Monitor
* Process Monitor
* Context Signal Event Emitter
* Categorized App Registry
* Context Engine
* Mode Engine

## Assistant Modes

* Development Mode
* Stream Mode
* Game Mode
* Media Mode
* Work Mode
* Focus Mode

## Data And Memory Management

Assistant-owned data is stored under `%USERPROFILE%\OpenX_Data` by default:

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

`core/assistant/Data.js` owns this layout. It creates required directories, points runtime config to the same managed paths, and safely migrates old `%USERPROFILE%\.jarvis` settings, contacts, and learning files without overwriting newer data.

## Voice System

* Naturalized Text-to-Speech
* Windows SAPI voice selection
* Configurable speaking rate and volume
* Shared response output for chat and automation results

---

# Built-in Capabilities

## System Automation

* Volume control
* Brightness control
* App launching
* Verified app open/focus/close lifecycle with Store-app discovery and browser-PWA isolation
* File management
* Folder operations
* Browser automation
* Media playback control
* Windows session management
* Screenshot capture
* System monitoring
* Foreground app and active window detection
* Running process monitoring

## Communication Features

* WhatsApp messaging
* Voice and video calls
* Email sending
* Contact management

## Productivity Features

* Timers
* Alarms
* Reminders
* File search
* Web search
* **Form auto-fill with personal context** — automatically fills form fields using learned personal information

## Natural Language Processing

* **40+ verb action vocabulary** for flexible command interpretation
* **Advanced fuzzy matching** (0.58 threshold) for typo tolerance
* **Multi-command detection** via ",", "and", "then", "also", "plus" connectors
* **Implicit command splitting** for natural compound requests
* **Contextual follow-up resolution** ("open it", "close that")
* **Noisy STT repair** — recovers executable commands from corrupted speech transcripts

## Personal Context Learning

The assistant learns and remembers personal information through natural conversation:

* **Names** — "call me X", "my name is X"
* **Locations** — "I live in X", "I'm from X"
* **Education** — "I study at X"
* **Work** — "I work at/in X"
* **Preferences** — favorite food, color, movie, music, sport
* **Possessions** — "I have a X"
* **Contact info** — email, phone number
* **Credential safety** — passwords, passcodes, tokens, and secrets are not stored in assistant learning memory
* **Command corrections** — learns from user feedback to improve future responses
* **Sequence learning** — remembers common command patterns

## Response System

* **Formal servant-style responses** — always addresses user as "sir"
* **Context-aware error messages** — references recent actions in errors
* **Clarification recovery** — handles unrelated input during pending confirmations
* **Confirmation flows** —危险操作前的正式确认请求

---

# Command Output Pipeline

## Command Flow

```text
Chat or recognized text
        |
        v
Parser and NLP normalization
        |
        v
NLU command-frame extraction
        |
        v
Intent routing and entity extraction
        |
        v
Permission validation
        |
        v
Automation execution
        |
        v
Response generation and optional TTS
```

---

# Permission System

| Level    | Behavior                                   |
| -------- | ------------------------------------------ |
| Low      | Auto-execute                               |
| Medium   | Requires confirmation                      |
| High     | Requires authentication                    |
| Critical | Requires authentication + explicit consent |

---

# Event System

The platform uses an event-driven architecture powered by `AssistantEventBus`.

## Main Events

* WAKE_WORD_DETECTED
* COMMAND_RECEIVED
* COMMAND_PROCESSING
* COMMAND_COMPLETED
* COMMAND_FAILED
* RESPONSE_READY
* RESPONSE_SPOKEN
* SETTINGS_UPDATED
* PLUGIN_LOADED
* ERROR

## Context Signal Events

The local context system emits these environmental signal events:

* active-window-changed
* process-started
* process-stopped
* mode-entered
* mode-exited
* mode-changed

These events are emitted by `core/context-awareness/signals.js` and are designed to remain deterministic, local-only, and independent from UI execution.

---

# Context Awareness

OpenX can detect local Windows environment state and publish it as deterministic context signals.

Implemented modules:

| Module | Responsibility |
| ------ | -------------- |
| `core/context-awareness/active-window.js` | Polls the foreground window every 500ms using `active-win` and normalizes app, title, path, pid, and timestamp |
| `core/context-awareness/process-monitor.js` | Uses PowerShell/WMI to track running processes and emit start/stop events |
| `core/context-awareness/signals.js` | Centralized signal/event emitter for context changes |
| `core/context-awareness/app-registry.js` | Categorizes known developer, streaming, media, game, and work applications |

Active window output:

```js
{
  app: "Code.exe",
  title: "OpenX - Visual Studio Code",
  path: "C:\\Program Files\\Microsoft VS Code\\Code.exe",
  pid: 1234,
  timestamp: 123456789
}
```

This context layer follows the master rules:

* Local only
* No cloud APIs
* No LLM integrations
* Deterministic polling and event emission
* Modular code
* Clean shutdown through `stop()`
* Tests for context awareness

---

# Adaptive Mode Intelligence

OpenX converts raw local environment signals into adaptive assistant modes.

Implemented modules:

| Module | Responsibility |
| ------ | -------------- |
| `core/context-awareness/context-engine.js` | Aggregates active window, process, audio, fullscreen, microphone, mode, and activity history into normalized context snapshots |
| `core/context-awareness/mode-engine.js` | Data-driven mode profile scoring, behavior flags, thresholds, smoothing, cooldowns, hysteresis, and mode transition events |

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

Context snapshot:

```js
{
  activeApp: "Code.exe",
  activeTitle: "OpenX - Visual Studio Code",
  runningApps: ["Code.exe", "Docker Desktop.exe"],
  fullscreen: false,
  timestamp: 123456789,
  currentMode: "DEV_MODE"
}
```

Mode state:

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

Mode transition safety:

* Weighted deterministic scoring
* Minimum dominance duration before entering a mode
* Minimum active duration before switching away
* Transition cooldowns
* Score smoothing and decay
* Hysteresis to prevent unstable switching
* Duplicate transition prevention

The adaptive mode system remains local-only and consumes existing context signal events instead of creating duplicate environment polling.

---

# Plugin System

## Lifecycle

```text
PluginManager.loadAll()
    ↓
Discover plugins
    ↓
Initialize plugin
    ↓
Register custom intents
    ↓
Execute lifecycle hooks
```

## Available Hooks

* onCommand()
* onResponse()
* onStateChange()
* onWakeWord()
* onSettingsChange()

---

# UI System

## Desktop Windows

* Orb Window
* Chat Window
* Settings Window

## Supported Themes

| Theme    | Accent |
| -------- | ------ |
| Midnight | Blue   |
| Dawn     | Orange |
| Forest   | Green  |
| Graphite | Gray   |

---

# Testing

The project includes dedicated test suites covering:

* NLP pipeline
* Intent matching
* Entity extraction
* Voice pipeline
* Automation engine
* Controllers
* Context awareness
* Mode scoring
* Mode transition stability
* Permissions
* Settings
* Event system
* Windows session operations
* Electron IPC sender and payload validation
* BrowserWindow sandbox preferences
* Crash-loop recovery policy
* Structured log redaction, rotation, and retention

Frameworks used:

* Mocha
* Chai

Latest complete verification: `465 passing` and repository-wide ESLint passing.

---

# Desktop Security And Recovery

* Browser windows use `contextIsolation`, Chromium sandboxing, web security, and disabled Node/webview integration.
* IPC calls are accepted only from local renderer files and validated with channel-specific size and shape limits.
* Renderer crashes are recorded and recovered with a bounded three-restart-per-minute policy.
* Fatal main-process errors write crash records, attempt lifecycle cleanup, and relaunch only within a persisted crash budget.
* Application, error, and crash logs are JSON Lines files with sensitive-field redaction, 10 MB rotation, and five-file retention.

---

# Design Principles

* Modular Architecture
* Single Responsibility Principle
* Layered System Design
* Offline-First Processing
* Deterministic NLP
* Event-Driven Communication
* Security-Focused Automation
* Plugin Extensibility
* Performance Optimization

---

# Example Workflow

## Command Example

```text
User: "open calculator"

1. Command text received
2. Parser and NLP normalize the request
3. NLU extracts command frames
4. Intent matched -> app.open
5. Entity extracted -> calculator
6. Permission validated
7. Automation executed
8. Response generated
9. Optional text-to-speech playback
```

## Voice Reliability

Command text from chat or any recognition source enters the same deterministic parser, NLP processor, NLU frame parser, intent matcher, entity extractor, permission validator, and action router.

* `core/assistant/nlp/nlp.js` repairs noisy command text by finding strong actions and known targets inside the sentence.
* `core/assistant/nlu.js` and `core/assistant/parser.js` extract actionable command frames from natural language.
* Multi-command requests such as "stop the video and set vol to 100" are split and executed in order.
* Contextual follow-ups such as "open it" are resolved from recent command context before routing.
* Pure conversation is kept out of automation when no actionable frame is found.
* `apps/desktop/voice/tts.js` uses Windows SAPI with configurable `voice.tts.voiceName`, audible volume clamping, speaking rate control, and SSML pauses when `voice.tts.naturalize` is enabled.

---

# Performance Goals

* Startup time under 3 seconds
* Lazy-loaded heavy modules
* Fully asynchronous operations
* Local execution without cloud dependency

---

# Future Scope

* Advanced plugin marketplace
* Expanded automation integrations
* AI-enhanced local NLP models
* Multi-device synchronization
* Advanced workflow automation

---

# License

This project is licensed under the MIT License.

---

# Author

Developed as a modular Windows desktop assistant framework focused on offline automation, extensibility, and deterministic control.
