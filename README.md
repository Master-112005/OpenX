JARVIS — Windows Desktop Assistant Platform
Project Overview
Property	Value
Name	jarvis-assistant
Version	1.0.0
Description	Intelligent Windows Desktop Assistant Platform — offline, voice-controlled, deterministic automation engine
License	MIT
Entry Point	apps/desktop/electron/main.js
Platform	Windows 10+ (Electron desktop app)
Runtime	Node.js 18+
Tech Stack
Core Runtime
Node.js 18+ — main application runtime

Electron ^28.0.0 — desktop shell (3 windows: orb, chat, settings)

Python 3.8+ — subprocess workers for ML inference (Whisper STT / wake word)

Key Dependencies
Package	Version	Purpose
electron	^28.0.0	Desktop shell / window management
electron-store	^8.1.0	Persistent settings (JSON)
electron-builder	^24.9.1	Windows packaging (.exe / .msi)
uuid	^9.0.0	Unique identifiers
mocha	^10.2.0	Test runner
chai	^4.3.10	Assertion library
eslint	^8.56.0	Linting
Optional Dependencies
Package	Purpose
vosk	Offline speech recognition (alternative STT engine)
node-windows	Windows service management
Python Dependencies (Worker Scripts)
faster-whisper — local STT + wake word detection (runs via subprocess)

sounddevice — audio capture in Python workers

webrtcvad — voice activity detection (Python side)

Windows-Native Technologies
PowerShell — system automation (volume, brightness, shutdown, processes)

WMI (Win32 API) — brightness control, system info queries

COM (WMPlayer.OCX) — volume control via ActiveX

SAPI (System.Speech) — text-to-speech via C# / PowerShell

Win32 API (user32.dll) — window management, window focus

Keyboard Media Keys — media playback control (play/pause/next/prev)

Directory Structure
OpenX/
├── config/index.js              # Default configuration
├── core/                        # All application logic
│   ├── shared/                  # Shared utilities
│   │   ├── index.js             # Logger, Validator, Normalizer, IdGenerator
│   │   └── events.js            # AssistantEventBus, EVENTS enum
│   ├── assistant/               # Core assistant pipeline
│   │   ├── index.js             # Assistant main class
│   │   ├── parser/              # InputParser (wake word stripping, normalization)
│   │   ├── nlp/                 # NLP pipeline (preprocessor, scorer, vocabulary)
│   │   ├── intents/             # 80+ intent definitions + IntentRegistry
│   │   ├── entities/            # EntityExtractor (numbers, apps, files, etc.)
│   │   ├── router/              # ActionRouter (orchestrates full pipeline)
│   │   ├── personality/         # Personality (formal address config)
│   │   ├── responses/           # ResponseGenerator (50+ templates)
│   │   └── context/             # ContextManager (in-memory session state)
│   ├── automation/              # 11 automation controllers
│   │   ├── volume/              # VolumeController
│   │   ├── brightness/          # BrightnessController
│   │   ├── files/               # FileController
│   │   ├── folders/             # FolderController
│   │   ├── apps/                # AppController (25+ known apps)
│   │   ├── browser/             # BrowserController
│   │   ├── media/               # MediaController (YouTube, Spotify, etc.)
│   │   ├── communications/      # WhatsApp Desktop, email, ContactStore
│   │   ├── system/              # System stats (CPU, RAM, battery, etc.)
│   │   ├── windows/             # Windows session (shutdown, lock, etc.)
│   │   ├── scheduler/           # Timers, alarms, reminders
│   │   └── common/              # Shared automation utilities
│   ├── permissions/             # PermissionValidator (4 levels)
│   ├── settings/                # SettingsService (persistent config)
│   ├── voice/                   # Voice pipeline
│   │   ├── wakeword/            # WakeWordDetector + Python worker
│   │   ├── stt/                 # Speech-to-text + Python worker
│   │   ├── tts/                 # Text-to-speech (SAPI)
│   │   ├── listener/            # ActiveListener (audio capture)
│   │   ├── state/               # SpeechStateMachine (7 states)
│   │   ├── buffering/           # AudioBufferManager
│   │   └── vad/                 # VoiceActivityDetector
│   └── ui/                      # UI state management
│       ├── orb/                 # OrbStateManager (5 states)
│       ├── chat/                # Chat state (placeholder)
│       ├── notifications/       # NotificationManager
│       ├── overlay/             # OverlayManager
│       └── state/               # UIStateManager (singleton)
├── apps/desktop/                # Electron app
│   ├── electron/main.js         # Main process (3 windows, tray, IPC)
│   └── renderer/                # UI renders
│       ├── chat/index.html      # Chat UI (1400+ lines, 4 themes)
│       └── settings/index.html  # Settings UI
├── plugins/                     # Plugin system
│   ├── index.js                 # PluginManager
│   └── sample_plugin/           # Example plugin
├── tests/                       # 17 test suites (Mocha + Chai)
│   ├── core/                    # Intent, parser, router, entities, etc.
│   ├── voice/                   # Voice pipeline, wake word, state machine
│   └── automation/              # All 11 controllers
├── docs/                        # Documentation
└── config/index.js              # All default config values
Architecture — 9-Stage Pipeline
[Input Sources: Voice / Chat Text]
         │
         ▼
┌──────────────────────────────────────────┐
│ 1. PARSER                                │
│    InputParser.parse()                   │
│    - Strip wake word ("jarvis", ...)     │
│    - Strip polite lead-ins               │
│    - Return { raw, clean, source }       │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 2. NLP                                   │
│    NlpProcessor.prepare()                │
│    - Preprocess (phrase replacements)    │
│    - Token correction (Damerau-Levenshtein) │
│    - Build vocabulary, bigrams           │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 3. INTENT MATCHING                       │
│    IntentRegistry.match()                │
│    - Score 80+ pattern-based intents     │
│    - Confidence scoring (ordered, overlap, ratio) │
│    - Return { id, confidence, domain }   │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 4. ENTITY EXTRACTION                     │
│    EntityExtractor.extract()             │
│    - Numbers, apps, files, folders       │
│    - URLs, contacts, time values         │
│    - Return { entities, confidence }     │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 5. PERMISSIONS CHECK                     │
│    PermissionValidator.validate()        │
│    - 4 levels: low/medium/high/critical  │
│    - Auto-execute / confirm / auth       │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 6. ROUTER                                │
│    ActionRouter.route()                  │
│    - Orchestrates stages 1→2→3→4→5       │
│    - Dispatches to AutomationEngine      │
│    - Generates response                  │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 7. AUTOMATION EXECUTION                  │
│    AutomationEngine.dispatch()           │
│    - 11 domain controllers               │
│    - Windows-native commands             │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 8. RESPONSE GENERATION                   │
│    ResponseGenerator.generate()          │
│    - 50+ template strings                │
│    - Entity interpolation                │
│    - Formal address (sir/master/boss)    │
└──────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│ 9. OUTPUT DELIVERY                       │
│    - Text → Chat UI (via IPC)            │
│    - Speech → TTS (SAPI, via PowerShell) │
│    - UI state sync via EventBus          │
└──────────────────────────────────────────┘
All 80+ Intents
Volume (9) — Permission: low
Intent	Description
volume.up	Increase volume
volume.down	Decrease volume
volume.set	Set volume to specific level
volume.max	Set volume to 100%
volume.mute	Mute audio
volume.unmute	Unmute audio
volume.toggle	Toggle mute
volume.get	Get current volume level
volume.status	Get volume status
Brightness (4) — Permission: low
Intent	Description
brightness.up	Increase brightness
brightness.down	Decrease brightness
brightness.set	Set brightness to specific level
brightness.get	Get current brightness level
Apps (3) — Permission: low
Intent	Description
app.open	Open an application (25+ known apps)
app.close	Close an application
app.list	List running applications
Files (7) — Permission: low–medium
Intent	Description
file.create	Create a new file
file.delete	Delete a file (medium permission)
file.rename	Rename a file
file.open	Open a file
file.list	List files in a directory
file.find	Search for files
file.copy	Copy a file
Folders (3) — Permission: low
Intent	Description
folder.open	Open a folder in Explorer
folder.list	List folder contents
folder.create	Create a new folder
Browser (2) — Permission: low
Intent	Description
browser.open	Open browser to a URL
browser.search	Search the web
Media (9) — Permission: low
Intent	Description
media.play	Play / resume media
media.pause	Pause media
media.resume	Resume playback
media.next	Next track
media.previous	Previous track
media.stop	Stop playback
media.queue	Queue a song/video
media.volume	Set media player volume
media.current	Show currently playing media
System (10) — Permission: low
Intent	Description
system.status	General system status
system.battery	Battery level
system.cpu	CPU usage
system.ram	Memory usage
system.disk	Disk usage
system.processes	Running processes count
system.ip	IP address
system.os	OS version info
system.uptime	System uptime
system.date	Current date/time
Windows (10) — Permission: medium–critical
Intent	Description
windows.shutdown	Shut down PC (critical)
windows.restart	Restart PC (critical)
windows.sleep	Put PC to sleep (high)
windows.lock	Lock workstation (medium)
windows.hibernate	Hibernate PC (critical)
windows.logoff	Log off current user (high)
windows.minimize	Minimize a window
windows.maximize	Maximize a window
windows.close	Close a window
windows.tasks	Show running tasks
Communications (4) — Permission: medium
Intent	Description
message.send	Send WhatsApp message
message.check	Check messages
call.start	Start a voice/video call
email.send	Send an email
Scheduler (6) — Permission: low
Intent	Description
timer.set	Set a countdown timer
timer.show	Show active timers
alarm.set	Set an alarm
alarm.show	Show active alarms
reminder.set	Set a reminder
reminder.show	Show active reminders
Search (4) — Permission: low
Intent	Description
search.web	Search the web
search.files	Search files
search.folders	Search folders
search.windows	Windows search
Screenshot (2) — Permission: low
Intent	Description
screenshot.take	Take a screenshot
screenshot.capture	Capture screen (alias)
Voice Pipeline
Speech State Machine (7 states)
IDLE → WAKE_DETECTED → LISTENING → HEARING_SPEECH → PROCESSING → RESPONDING → IDLE
                                                                         ↘ ERROR
Strict ALLOWED_TRANSITIONS map with 12 transition rules. core/voice/state/index.js:25-45

Voice Flow
1. WAKE WORD DETECTION (core/voice/wakeword/)
   - Python subprocess: faster-whisper + sounddevice + WebRTC VAD
   - Detects "jarvis" wake word + extracts inline command
   - Falls back to keyword-spotting in Python worker

2. ACTIVE LISTENING (core/voice/listener/ + vad/ + buffering/)
   - RMS + WebRTC VAD for utterance boundary detection
   - Pre-roll + active frame buffering
   - Auto-stops after silence timeout

3. SPEECH-TO-TEXT (core/voice/stt/)
   - Python subprocess: faster-whisper model
   - Silero VAD + silence-based endpointing
   - Fallback: Windows SAPI (System.Speech via PowerShell)

4. TEXT-TO-SPEECH (core/voice/tts/)
   - Windows SAPI via PowerShell (System.Speech assembly)
   - Configurable: voice, rate, volume
   - Methods: speak(), speakAsync(), stop()
Key Classes & Methods
Core Pipeline
Class	File	Key Methods
Assistant	core/assistant/index.js:14	constructor(config), processCommand(text, source)
InputParser	core/assistant/parser/index.js:7	parse(input, wakeWords)
NlpProcessor	core/assistant/nlp/index.js:8	prepare(text), buildVocabulary(intents), findClosestOption(token, vocab)
Preprocessor	core/assistant/nlp/preprocessor.js:7	applyPhraseReplacements(text), stripLeadIns(text), collapseRepeatedTokens(tokens), buildBigrams(tokens)
Scorer	core/assistant/nlp/scorer.js:7	countOrderedMatches(pattern, tokens), countOverlap(pattern, tokens), ratioMatch(a, b), scorePattern(pattern, tokens), scorePreparedPattern(pattern, prepared)
IntentRegistry	core/assistant/intents/index.js:9	constructor(), register(intentDef), registerCustom(intentDef), match(text), get(id), getAll(), unregister(id)
EntityExtractor	core/assistant/entities/index.js:9	extract(text, intentId), _extractValues(text), _extractAppName(text), _extractFilePath(text), _extractFolderName(text), _extractUrl(text), _extractContact(text), _extractTime(text)
ActionRouter	core/assistant/router/index.js:11	route(input, source), _buildIntentResult(intent, entities, confidence), _determineLevel(intentId, intentDef)
ContextManager	core/assistant/context/index.js:7	set(key, value), get(key), updateContext(command, response), getContextSummary(), clear()
Personality	core/assistant/personality/index.js:5	constructor(config), getHonorific(), formatAddress()
ResponseGenerator	core/assistant/responses/index.js:9	generate(intentId, result, context), _getTemplate(intentId, success), _interpolate(template, entities, context), _humanizeError(intentId, error)
Automation Controllers
Class	File	Key Methods
AutomationEngine	core/automation/index.js:12	constructor(), dispatch(intentId, entities), _getController(intentId)
VolumeController	core/automation/volume/index.js:9	setVolume(level), increaseVolume(step), decreaseVolume(step), mute(), unmute(), toggleMute(), getCurrentVolume()
BrightnessController	core/automation/brightness/index.js:8	setBrightness(level), increaseBrightness(step), decreaseBrightness(step), getCurrentBrightness()
FileController	core/automation/files/index.js:11	create(path, content), delete(path), rename(oldPath, newPath), open(path), listFiles(dirPath), find(name, location), copy(source, destination)
FolderController	core/automation/folders/index.js:8	open(path), listContents(path), create(path)
AppController	core/automation/apps/index.js:8	open(appName), close(appName), listRunning(), switchTo(appName)
BrowserController	core/automation/browser/index.js:6	open(url), search(query)
MediaController	core/automation/media/index.js:12	play(context), pause(), resume(), next(), previous(), stop(), setVolume(level), queue(url, title)
CommunicationsController	core/automation/communications/index.js:8	composeMessage(contact, message), startCall(contact), sendEmail(to, subject, body)
SystemController	core/automation/system/index.js:7	getCPUUsage(), getMemoryUsage(), getBatteryStatus(), getSystemInfo()
WindowsController	core/automation/windows/index.js:7	shutdown(), restart(), sleep(), lock(), hibernate(), logoff(), minimizeWindow(), maximizeWindow(), closeWindow()
SchedulerController	core/automation/scheduler/index.js:8	setTimer(seconds, label), setAlarm(time, label), setReminder(time, message), showAlarms()
WindowsSessionController	core/automation/common/windows-session.js:8	listWindows(), minimizeWindow(title), maximizeWindow(title), closeWindow(title), focusWindow(title)
WhatsAppDesktopController	core/automation/communications/whatsapp-desktop.js:10	sendMessage(contact, message), startVoiceCall(contact)
ContactStore	core/automation/communications/contact-store.js:7	findContact(query), addContact(name, info), removeContact(id), listContacts()
Voice System
Class	File	Key Methods
VoiceManager	core/voice/index.js:8	start(), stop(), _onWakeWord(data), _startListening(), _onSpeechEnd(audioBuffer), _processTranscript(transcript)
WakeWordDetector	core/voice/wakeword/index.js:11	start(), stop(), _spawnWorker(), _processMessage(data)
SpeechToText	core/voice/stt/index.js:10	transcribe(audioBuffer), _transcribeWhisper(audioPath), _transcribeSapi(audioPath)
TextToSpeech	core/voice/tts/index.js:6	speak(text), speakAsync(text), stop()
ActiveListener	core/voice/listener/index.js:6	start(), stop(), _processAudio(data)
SpeechStateMachine	core/voice/state/index.js:7	transition(newState), getState(), reset()
AudioBufferManager	core/voice/buffering/index.js:5	addFrame(frame), getBuffer(), clear(), trimEnd(duration)
VoiceActivityDetector	core/voice/vad/index.js:4	isSpeech(audioFrame), getVadState()
UI & Shared
Class	File	Key Methods
UIStateManager	core/ui/state/index.js:6	get(key), set(key, value), update(partial), reset()
OrbStateManager	core/ui/orb/index.js:4	setState(state), getState()
NotificationManager	core/ui/notifications/index.js:6	show(message, type), dismiss(id), info(msg), success(msg), warning(msg), error(msg)
OverlayManager	core/ui/overlay/index.js:4	show(content), dismiss()
AssistantEventBus	core/shared/events.js:6	emit(type, data), on(type, handler), onceWithTimeout(type, timeout), getHistory(n)
PluginManager	plugins/index.js:7	loadAll(), executeHook(hook, ...args), unloadPlugin(name)
SettingsService	core/settings/index.js:8	get(key), set(key, value), getAll(), reset(), getProfile(), setTheme(name), getContact(name), setContact(name, info)
PermissionValidator	core/permissions/index.js:7	validate(intentId, level), getLevel(intentId), requireConfirmation(level), requireAuth(level)
Electron Main Process
Function	File	Purpose
createOrbWindow()	apps/desktop/electron/main.js:45	Creates always-on-top orb indicator
createChatWindow()	apps/desktop/electron/main.js:70	Creates main chat interface
createSettingsWindow()	apps/desktop/electron/main.js:95	Creates settings window
createTray()	apps/desktop/electron/main.js:120	System tray icon + context menu
IPC: process-command	apps/desktop/electron/main.js:150	Routes text commands through pipeline
IPC: voice-toggle	apps/desktop/electron/main.js:175	Start/stop voice listening
IPC: get-settings	apps/desktop/electron/main.js:200	Get settings
IPC: update-settings	apps/desktop/electron/main.js:210	Update settings
IPC: take-screenshot	apps/desktop/electron/main.js:230	Screen capture
Permission System
Level	Value	Behavior	Example Intents
low	0	Auto-execute	volume.up, app.open, browser.search
medium	1	Requires user confirmation	file.delete, message.send
high	2	Requires authentication	—
critical	3	Requires auth + explicit consent	windows.shutdown, windows.restart
Event System (18 Events)
Event	Trigger
WAKE_WORD_DETECTED	Wake word detected by voice pipeline
LISTENING_STARTED	Microphone starts listening
LISTENING_STOPPED	Microphone stops listening
SPEECH_DETECTED	User speech detected
SPEECH_ENDED	User speech ended
COMMAND_RECEIVED	Command enters pipeline
COMMAND_PROCESSING	Command is being processed
COMMAND_COMPLETED	Command executed successfully
COMMAND_FAILED	Command execution failed
RESPONSE_READY	Response text generated
RESPONSE_SPOKEN	TTS finished speaking
STATE_CHANGED	Assistant state changed
ERROR	Error occurred
WARNING	Warning condition
SETTINGS_UPDATED	Settings changed
PLUGIN_LOADED	Plugin registered
PLUGIN_ERROR	Plugin encountered error
All events emitted via AssistantEventBus with envelope { type, timestamp, data }.

Plugin System
Lifecycle
PluginManager.loadAll()
  → discovers plugins/*/plugin.json
  → require() module
  → plugin.initialize(config, automationEngine, intentRegistry)
  → intentRegistry.registerCustom(intentDef)
Available Hooks
onCommand(command, context) — intercept before routing

onResponse(response, context) — modify outgoing response

onStateChange(newState, oldState) — react to state changes

onWakeWord(data) — react to wake word detection

onSettingsChange(key, value) — react to settings changes

Chat UI (4 Themes)
Theme	Background	Accent Color
midnight	#0a0e27	#4fc3f7
dawn	#faf3e0	#e17055
forest	#0d1f0d	#81c784
graphite	#1a1a1a	#b0b0b0
Data Storage
Data	Location	Format
Settings	%USERPROFILE%\.jarvis\settings.json	JSON
Contacts	%USERPROFILE%\.jarvis\contacts.json	JSON
Session Context	In-memory (ContextManager Map)	—
Event History	In-memory (AssistantEventBus Array)	—
Test Coverage (17 Suites)
Suite	File	Tests
Intents	tests/core/intents.test.js	IntentRegistry init (20+ intents), get/register/unregister
Parser	tests/core/parser.test.js	InputParser: wake word, command extraction, normalization, edge cases
Router	tests/core/router.test.js	ActionRouter: full pipeline for all domains, confidence, fuzzy matching
Entities	tests/core/entities.test.js	EntityExtractor: values, apps aliases, files, folders, time
Permissions	tests/core/permissions.test.js	PermissionValidator: all 4 levels, confirm, auth, tracking
Responses	tests/core/responses.test.js	ResponseGenerator: templates, interpolation, error humanization
Settings	tests/core/settings.test.js	SettingsService: persistence, profile, contacts, theme
Voice	tests/voice/voice.test.js	VoiceManager lifecycle, activation, pipeline, state
Wake Word	tests/voice/wakeword.test.js	Python worker self-test, exact/fuzzy matching
Pipeline	tests/voice/pipeline.test.js	Event bus, state machine transitions, listener
Automation	tests/automation/automation.test.js	AutomationEngine actionMap dispatch
Apps	tests/automation/apps.test.js	AppController open/close/list
Communications	tests/automation/communications.test.js	Messaging controller
File Management	tests/automation/file-management.test.js	FileController CRUD
Media	tests/automation/media.test.js	MediaController playback/queue/volume
Volume/Brightness	tests/automation/volume-brightness.test.js	Volume + brightness controllers
Windows Session	tests/automation/windows-session.test.js	Window operations
Main Workflow (End-to-End)
User says "jarvis, open calculator"
         │
         ▼
[Voice Pipeline] WakeWordDetector detects "jarvis"
         │  extracts "open calculator"
         ▼
[Voice Pipeline] SpeechToText transcribes audio → "open calculator"
         │
         ▼
[Parser] InputParser.parse("open calculator")
         │  strips wake word → raw: "open calculator"
         │  strips lead-ins → clean: "open calculator"
         ▼
[NLP] NlpProcessor.prepare("open calculator")
         │  phrase replacements → none needed
         │  token correction → no corrections
         │  vocabulary match → { app.open, app.close }
         ▼
[Intents] IntentRegistry.match("open calculator")
         │  scores all 80+ intent patterns
         │  ordered match on "open" + "calculator"
         │  → best: app.open (confidence: 0.95)
         ▼
[Entities] EntityExtractor.extract("open calculator", "app.open")
         │  identifies "calculator" as appName
         │  → { appName: "calculator" }
         ▼
[Permissions] PermissionValidator.validate("app.open", "low")
         │  level: low → auto-execute
         ▼
[Router] ActionRouter.route(...)
         │  bundles: { intent, entities, confidence, permissions }
         ▼
[Automation] AutomationEngine.dispatch("app.open", { appName: "calculator" })
         │  AppController.open("calculator")
         │  → PowerShell: Start-Process calculator://
         │  → returns { success: true, appName: "Calculator" }
         ▼
[Response] ResponseGenerator.generate("app.open", { success: true, ... })
         │  template: "Calculator has been opened, sir."
         │  interpolates entities
         ▼
[Output] TTS speaks + Chat UI displays
         │  VoiceManager → TextToSpeech.speak()
         │  Electron IPC → Chat window
Design Principles (from RULES.md)
Modularity — every feature is an independent module with isolated logic, tests, and docs

Single Responsibility — each module does exactly one thing

Layered Architecture — UI never talks directly to automation; all goes through intent → router → permissions → automation

Offline-First — no cloud dependency; everything runs locally (Whisper, SAPI, PowerShell)

Deterministic NLP — pattern-based intent matching, no LLM, fuzzy correction as fallback

Event-Driven — all components communicate via AssistantEventBus

Security — every action has a permission level; system actions require confirmation/auth

Plugin Extension — third-party capabilities via lifecycle hooks

Platform Thinking — designed as a framework/ecosystem, not a single-purpose app

Performance — startup < 3s, lazy-loaded heavy modules, async operations



