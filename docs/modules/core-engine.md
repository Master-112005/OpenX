# Core Engine Modules

## Assistant (`core/assistant/`)

### Intents
- Registry of all known commands
- Each intent has: id, patterns, permission level, action, entities
- Supports custom intent registration via plugins

### Parser
- Normalizes input text
- Detects and strips wake word
- Extracts command text

### Entities
- Extracts structured data from commands
- Supports: values, app names, filenames, URLs, paths
- Resolves common aliases (apps, folders)

### Router
- Orchestrates full pipeline
- Calculates confidence scores
- Handles confirmation flows

### Responses
- Template-based response generation
- Interpolation of entities and execution data
- Customizable via personality module

### Context
- Maintains command history
- Session data with time-based expiry
- Conversation summary

## Automation (`core/automation/`)

### Volume Controller
- Get/set system volume via WinMM API
- Mute/unmute
- Increment/decrement by configurable steps

### App Controller
- Open known applications
- Close by process name
- Switch focus between windows
- Alias resolution for common apps

### File Controller
- Create, delete, rename, copy, move files
- Search filesystem
- Path validation and sanitization

### Folder Controller
- Create, delete, open folders
- Special folder aliases (Downloads, Documents, etc.)

### Browser Controller
- Open URLs in default browser
- Web search via Google
- Automatic protocol handling

### System Controller
- CPU, RAM, battery, disk monitoring
- Process count
- Windows Management Instrumentation (WMI) queries

### Windows Controller
- Shutdown, restart, sleep, lock
- Window minimize/maximize/close
- Hibernate and logoff

## Voice (`apps/desktop/voice/`)

### Wake Word Detector
- Listens for activation phrase
- Supports manual activation via orb
- Event-based architecture

### Speech-to-Text
- Windows SAPI integration
- Optional Vosk support for offline recognition
- Dictation grammar for natural speech

### Text-to-Speech
- Windows SAPI speech synthesis
- Configurable voice, rate, volume
- Available voice enumeration

## Permissions (`apps/desktop/permissions.js`)

- Level-based permission system (low → critical)
- Confirmation required for medium+
- Authentication for high/critical
- Configurable user level
