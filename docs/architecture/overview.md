# Architecture Overview

## System Architecture

JARVIS follows a layered, event-driven architecture with clear separation of concerns:

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

## Layer Definitions

### 1. Input Layer
- Voice input (`core/voice/`)
- Chat input (`apps/desktop/renderer/chat/`)

Voice flow now follows:
`wake word -> spoken acknowledgement -> active listener session -> local Whisper STT -> shared assistant pipeline`
with Windows Speech Recognition kept only as a fallback backend.

Key voice modules:
- `core/voice/state/`: explicit speech lifecycle state machine
- `core/voice/listener/`: active listening session control
- `core/voice/vad/`: deterministic speech activity gate
- `core/voice/buffering/`: pre-roll and utterance buffering

### 2. Processing Layer (`core/assistant/`)
- **Parser**: normalizes input and strips lead-ins
- **Intent Matcher**: deterministically maps commands to intents
- **Entity Extractor**: extracts structured values, names, paths, and targets

### 3. Security Layer (`core/permissions/`)
- Validates permission levels
- Requires confirmation for dangerous actions

### 4. Routing Layer (`core/assistant/router/`)
- Maps intents to actions
- Orchestrates the shared command pipeline

### 5. Automation Layer (`core/automation/`)
- File operations
- Application control
- System monitoring
- Windows OS commands

### 6. Response Layer (`core/assistant/responses/`)
- Template-based responses
- Personality integration
- Deterministic response generation

### 7. Event Layer (`core/shared/events.js`)
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

### 8. UI Synchronization Layer (`core/ui/state/`)
- Backend state drives orb state changes
- UI never executes automation directly
- Voice and chat stay as presentation surfaces over the same backend

## Key Design Rules

- **UI never executes automation directly**: all commands go through the router
- **Voice and chat share the same pipeline**: identical backend execution path
- **No LLM dependencies**: purely deterministic pattern matching and routing
- **Modular automation**: each capability is isolated in its own module
- **Event-driven coordination**: voice, assistant, and UI communicate through lifecycle events
- **Explicit speech states**: idle, wake detected, listening, hearing speech, processing, responding, error
