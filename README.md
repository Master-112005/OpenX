# OpenX — Intelligent Windows Desktop Assistant Platform

## Overview

OpenX is an offline-first intelligent Windows desktop assistant built with Node.js, Electron, and Python. It provides deterministic voice-controlled automation, local AI processing, system-level automation, and modular plugin support without relying on cloud services.

The platform is designed around a layered architecture with intent routing, entity extraction, permission validation, event-driven communication, and Windows-native automation.

---

# Key Features

* Offline-first voice assistant
* Deterministic NLP pipeline (No LLM dependency)
* Windows-native automation engine
* Wake word detection + hallucination-resistant speech-to-text
* Naturalized Windows SAPI text-to-speech
* Modular plugin system
* Event-driven architecture
* Context signal foundation for active windows, processes, and audio devices
* Adaptive mode engine for development, streaming, gaming, media, work, and focus contexts
* Permission-based execution model
* Multi-window Electron desktop interface
* 80+ built-in intents
* Local-only processing for privacy and performance

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
* Python 3.8+
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
| electron-builder | Windows packaging                   |
| uuid             | Unique identifiers                  |
| mocha            | Testing framework                   |
| chai             | Assertions                          |
| eslint           | Code linting                        |

## Optional Dependencies

| Package      | Purpose                    |
| ------------ | -------------------------- |
| vosk         | Offline speech recognition |
| node-windows | Windows service management |

## Python Dependencies

* faster-whisper
* sounddevice
* webrtcvad

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
├── config/
├── core/
│   ├── assistant/
│   ├── automation/
│   ├── context-awareness/
│   ├── device-detection/
│   ├── modes/
│   ├── permissions/
│   ├── settings/
│   ├── shared/
│   ├── ui/
│   └── voice/
├── apps/
│   └── desktop/
├── plugins/
├── tests/
├── docs/
└── config/
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

## Context Awareness

* Active Window Monitor
* Process Monitor
* Context Signal Event Emitter
* Categorized App Registry
* Context Engine
* Mode Engine

## Device Detection

* Audio Device Manager
* Headphone Detector
* Device Event Monitor

## Assistant Modes

* Development Mode
* Stream Mode
* Game Mode
* Media Mode
* Work Mode
* Focus Mode

## Voice System

* Wake Word Detector
* Hallucination-resistant Speech-to-Text
* Naturalized Text-to-Speech
* Voice Activity Detection
* Audio Buffer Management
* Speech State Machine

---

# Built-in Capabilities

## System Automation

* Volume control
* Brightness control
* App launching
* File management
* Folder operations
* Browser automation
* Media playback control
* Windows session management
* Screenshot capture
* System monitoring
* Foreground app and active window detection
* Running process monitoring
* Audio output and headphone detection

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

---

# Voice Pipeline

## Voice Flow

```text
Wake Word Detection
        ↓
Active Listening
        ↓
Audio Reliability Gates
        ↓
Speech-to-Text
        ↓
Transcript Reliability Filter
        ↓
Intent Processing
        ↓
Automation Execution
        ↓
Text-to-Speech Response
```

## Speech State Machine

```text
IDLE
  ↓
WAKE_DETECTED
  ↓
LISTENING
  ↓
HEARING_SPEECH
  ↓
PROCESSING
  ↓
RESPONDING
  ↓
IDLE
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
* headphones-connected
* headphones-disconnected
* audio-device-changed
* mode-entered
* mode-exited
* mode-changed

These events are emitted by `core/context-awareness/signals.js` and are designed to remain deterministic, local-only, and independent from UI execution.

---

# Context Awareness And Device Detection

OpenX can detect local Windows environment state and publish it as deterministic context signals.

Implemented modules:

| Module | Responsibility |
| ------ | -------------- |
| `core/context-awareness/active-window.js` | Polls the foreground window every 500ms using `active-win` and normalizes app, title, path, pid, and timestamp |
| `core/context-awareness/process-monitor.js` | Uses PowerShell/WMI to track running processes and emit start/stop events |
| `core/context-awareness/signals.js` | Centralized signal/event emitter for context and device changes |
| `core/context-awareness/app-registry.js` | Categorizes known developer, streaming, media, game, and work applications |
| `core/device-detection/audio-devices.js` | Reads active audio output and enumerates known audio devices locally |
| `core/device-detection/headphones.js` | Detects headphone and Bluetooth device state |
| `core/device-detection/device-events.js` | Debounces audio device/headphone changes and emits signal events |

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

Audio device output:

```js
{
  name: "WH-1000XM4",
  type: "bluetooth-headphones",
  active: true,
  id: "device-id",
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
* Debounced device events
* Tests for context awareness and device detection

---

# Adaptive Mode Intelligence

OpenX converts raw local environment signals into adaptive assistant modes.

Implemented modules:

| Module | Responsibility |
| ------ | -------------- |
| `core/context-awareness/context-engine.js` | Aggregates active window, process, audio, fullscreen, microphone, mode, and activity history into normalized context snapshots |
| `core/context-awareness/mode-engine.js` | Scores modes, applies thresholds, smoothing, cooldowns, hysteresis, and emits mode transitions |
| `core/modes/dev-mode.js` | Scores development activity and exposes developer-focused behavior flags |
| `core/modes/stream-mode.js` | Scores OBS/Streamlabs/microphone streaming activity and suppresses noisy feedback |
| `core/modes/game-mode.js` | Scores fullscreen/game/Steam activity and minimizes assistant overhead |
| `core/modes/media-mode.js` | Scores Spotify/YouTube/media activity and prioritizes media commands |
| `core/modes/work-mode.js` | Scores Teams/Outlook/Zoom/productivity activity and reduces interruptions |
| `core/modes/focus-mode.js` | Scores long uninterrupted/fullscreen/manual focus activity and minimizes responses |

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
  audioDevice: "WH-1000XM4",
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
* Device detection
* Mode scoring
* Mode transition stability
* Permissions
* Settings
* Event system
* Windows session operations

Frameworks used:

* Mocha
* Chai

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

## Voice Command Example

```text
User: "Jarvis, open calculator"

1. Wake word detected
2. Audio passes VAD, RMS, duration, confidence, no-speech, and repetition gates
3. Speech converted to text
4. Transcript normalized and filtered before routing
5. Intent matched → app.open
6. Entity extracted → calculator
7. Permission validated
8. Automation executed
9. Response generated
10. Naturalized text-to-speech playback
```

## Voice Reliability

OpenX filters speech at two layers before any automation can run:

* `core/voice/engine/audio_engine.py` rejects weak audio, short utterances, low-confidence Whisper output, high no-speech probability, and repetitive compression artifacts.
* `core/voice/engine/audio_engine.py` and `core/voice/index.js` use command-aware recovery, so low-confidence but actionable phrases such as "open chrome" or "open youtube" still reach NLP/NLU routing.
* `core/voice/index.js` performs a second transcript reliability pass for non-command low confidence, known background-noise hallucination phrases, and repeated token loops.
* Rejected speech emits an ignored-speech event and returns to the voice state machine without publishing `speechResult`.
* In conversation mode, repeated ignored speech is capped by `voice.conversationIgnoredSpeechLimit` so background noise cannot keep re-arming the microphone forever.
* Voice transcripts still enter the same deterministic parser, NLP processor, intent matcher, entity extractor, and permission validator as chat input.

Important voice tuning options live in `config/index.js`: `voice.conversationIgnoredSpeechLimit`, plus STT options under `voice.stt` such as `minRms`, `minConfidence`, `commandRecoveryMinConfidence`, `confirmationMinConfidence`, `maxNoSpeechProbability`, `maxCompressionRatio`, `minUtteranceMs`, `startSpeechTimeoutMs`, and `maxDurationMs`.

TTS uses Windows SAPI with configurable `voice.tts.voiceName`, audible volume clamping, a slower default speaking rate, and SSML pauses when `voice.tts.naturalize` is enabled.

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
