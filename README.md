# OpenX — Intelligent Windows Desktop Assistant Platform

## Overview

OpenX is an offline-first intelligent Windows desktop assistant built with Node.js, Electron, and Python. It provides deterministic voice-controlled automation, local AI processing, system-level automation, and modular plugin support without relying on cloud services.

The platform is designed around a layered architecture with intent routing, entity extraction, permission validation, event-driven communication, and Windows-native automation.

---

# Key Features

* Offline-first voice assistant
* Deterministic NLP pipeline (No LLM dependency)
* Windows-native automation engine
* Wake word detection + speech-to-text
* Modular plugin system
* Event-driven architecture
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

## Voice System

* Wake Word Detector
* Speech-to-Text
* Text-to-Speech
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
Speech-to-Text
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

The project includes 17 dedicated test suites covering:

* NLP pipeline
* Intent matching
* Entity extraction
* Voice pipeline
* Automation engine
* Controllers
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
2. Speech converted to text
3. Intent matched → app.open
4. Entity extracted → calculator
5. Permission validated
6. Automation executed
7. Response generated
8. Text-to-speech playback
```

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
