# Architecture Overview

## System Architecture

OpenX follows a layered, event-driven architecture with clear separation of concerns:

```
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

## Stable module entry points

The assistant architecture is implemented through flat, role-based modules in `core/assistant/`:

- `nlp/nlp.js` normalizes input and repairs language.
- `nlu.js` builds semantic context.
- `parser.js` creates command frames and entities.
- `router.js` selects intents and routes actions.
- `nle.js` delegates resolved actions to the automation engine.
- `context.js`, `contest.js`, `entities.js`, and `intents.js` provide command understanding state.
- `Active-learning.js`, `personality.js`, `responses.js`, and `Data.js` provide learning, presentation, and persistence boundaries.

System-side capabilities are implemented directly by the flat modules in `core/automation/`. Validation, verification, and confirmation are separated under `core/automation/common/`.

Desktop integration is exposed through `apps/desktop/preload.js`, `settings.js`, `permissions.js`, and `voice/tts.js`. External integrations continue through `plugins/plugin-controller.js` and isolated plugin packages.

## Command execution contract

Every command follows the same deterministic pipeline:

`NLP correction -> NLU/context -> parser/entities -> intent -> validation -> permission -> NLE -> automation -> verification -> confirmation -> response/personality -> context/learning/Data`

- Required information is validated before NLE. Missing values produce `needsClarification: true` and never execute an action.
- NLE is the only assistant layer that delegates a resolved action to automation.
- Automation attaches postcondition validation and verification evidence.
- The confirmation layer records whether execution completed successfully.
- Active learning records routing outcomes and adapts future entity resolution without bypassing validation or permissions.
- Commands describing an unconnected operation are classified as `assistant.capability`; the response states that the operation is understood but not connected instead of claiming false execution.

`commands.md` is the authoritative natural-language regression corpus. Its test executes all commands against a sandbox automation engine, so coverage cannot trigger real desktop side effects.

## External plugins

Forms, YouTube, Chrome, Discord, and communication-specific adapters live under `plugins/`. Loadable plugins declare trust, permission levels, and every core automation action they are allowed to call. Plugin actions and intents must remain inside their own `plugin.<id>.*` namespace.

## Layer Definitions

### 1. Input Layer
- Voice output (`apps/desktop/voice/tts.js`)
- Chat input (`apps/desktop/renderer/chat/`)

### 2. Processing Layer (`core/assistant/`)
- **Parser**: normalizes input and strips lead-ins
- **Intent Matcher**: deterministically maps commands to intents
- **Entity Extractor**: extracts structured values, names, paths, and targets

### 3. Security Layer (`apps/desktop/permissions.js`)
- Validates permission levels
- Requires confirmation for dangerous actions

### 4. Routing Layer (`core/assistant/router.js`)
- Maps intents to actions
- Orchestrates the shared command pipeline

### 5. Automation Layer (`core/automation/`)
- File operations
- Application control
- System monitoring
- Windows OS commands

### 6. Response Layer (`core/assistant/responses.js`)
- Template-based responses
- Personality integration
- Deterministic response generation

### 7. Data and Event Layer (`core/assistant/Data.js`)
- Shared event bus for voice, assistant, and UI modules
- Standard lifecycle events including:
  - `wakeword.detected`
  - `listener.started`
  - `speech.detected`
  - `utterance.finalized`
  - `stt.completed`
  - `intent.detected`
  - `command.executed`
  - `response.generated`
  - `ui.state.changed`

### 8. Desktop UI Layer (`apps/desktop/renderer/`)
- Electron renderer surfaces own chat, settings, notifications, and schedule alerts
- UI never executes automation directly
- Voice and chat stay as presentation surfaces over the same backend

## Key Design Rules

- **UI never executes automation directly**: all commands go through the router
- **Voice and chat share the same pipeline**: identical backend execution path
- **No LLM dependencies**: purely deterministic pattern matching and routing
- **Modular automation**: each capability is isolated in its own module
- **Event-driven coordination**: voice, assistant, and UI communicate through lifecycle events
- **Explicit speech states**: idle, wake detected, listening, hearing speech, processing, responding, error
