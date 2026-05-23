MASTER RULES & DEVELOPMENT PRINCIPLES
FOR THE WINDOWS ASSISTANT PLATFORM

These rules are designed to guide:

AI coding agents
developers
contributors
future maintainers
automation systems

These are SYSTEM-LEVEL RULES for the assistant architecture, behavior, engineering quality, scalability, and development workflow.

1. ASSISTANT BEHAVIOR RULES
RULE 1 — USER RESPECT PROTOCOL

The assistant must always treat the user formally and respectfully.

Allowed addressing:

sir
master
boss (optional configurable)
commander (optional configurable)

Default:

sir

Examples:

"Good evening, sir."
"Task completed, sir."
"Awaiting your command, sir."

The assistant must NEVER:

act like a friend
use slang
use emojis
behave casually
make jokes unless explicitly enabled
RULE 2 — TASK ORIENTED COMMUNICATION

The assistant must:

stay concise
stay operational
stay professional

BAD:

"Haha done bro!"

GOOD:

"Operation completed successfully, sir."
RULE 3 — NEVER PRETEND

If the assistant cannot perform an action:

clearly explain failure
never fake execution
never hallucinate results

BAD:

"File deleted successfully."

(when file delete failed)

GOOD:

"Unable to delete the file, sir. Access was denied."
RULE 4 — ALWAYS CONFIRM DANGEROUS ACTIONS

Before dangerous actions:

ask confirmation
explain consequences

Examples:

"This operation will permanently delete 542 files.
Shall I proceed, sir?"
RULE 5 — NEVER EXECUTE RAW USER TEXT

All commands must go through:

intent
→ validation
→ permissions
→ execution

NEVER:

execute(userText)
2. ARCHITECTURE RULES
RULE 6 — EVERYTHING MUST BE MODULAR

Every feature must:

exist independently
have isolated logic
have isolated tests
have isolated documentation

BAD:

main.ts handles everything

GOOD:

automation/files/
automation/system/
automation/browser/
RULE 7 — SINGLE RESPONSIBILITY PRINCIPLE

Every module should do ONE thing only.

BAD:

voice module controlling files

GOOD:

voice module
→ only handles voice
RULE 8 — UI MUST NEVER EXECUTE AUTOMATION DIRECTLY

BAD:

button click
→ delete file

GOOD:

button click
→ intent engine
→ router
→ automation module
RULE 9 — AUTOMATION LAYER MUST NOT KNOW UI EXISTS

Automation modules must work independently.

Meaning:

no orb logic
no UI imports
no renderer dependencies

This allows:

CLI support later
API support later
mobile support later
RULE 10 — SHARED EXECUTION PIPELINE

Voice and chat MUST use:

same intent engine
same router
same permissions
same automation modules

BAD:

voice system logic
chat system logic

GOOD:

voice/chat
→ shared pipeline
3. CODEBASE RULES
RULE 11 — CLEAN DIRECTORY STRUCTURE

A developer must instantly understand:

what each folder does
where features belong
how workflows operate

Folder names must be:

predictable
descriptive
scalable
RULE 12 — NEVER PLACE RANDOM LOGIC

BAD:

utils.ts containing 500 functions

GOOD:

volume/
brightness/
files/
folders/
RULE 13 — EVERY FEATURE NEEDS ITS OWN MODULE

Example:

feature:
screenshot support

Must create:

automation/screenshots/
intents/screenshot.intent.ts
RULE 14 — USE TYPE SAFETY

All commands should use strict schemas.

Example:

interface Command {
  intent: string;
  entities: Record<string, any>;
  confidence: number;
  requiresConfirmation: boolean;
}
RULE 15 — NO MAGIC VALUES

BAD:

if(volume > 80)

GOOD:

MAX_SAFE_VOLUME
4. INTENT ENGINE RULES
RULE 16 — INTENTS MUST BE EXPLICIT

BAD:

"do something"

GOOD:

volume.up
file.delete
app.open
RULE 17 — EVERY INTENT NEEDS:
patterns
entities
permissions
tests
responses
RULE 18 — ENTITY EXTRACTION MUST BE STRUCTURED

BAD:

"delete notes"

GOOD:

{
  "intent": "file.delete",
  "filename": "notes.txt"
}
RULE 19 — INTENT CONFIDENCE SYSTEM

Each intent should include confidence scoring.

Example:

{
  "intent": "volume.up",
  "confidence": 0.94
}

Low confidence:

ask clarification
5. SECURITY RULES
RULE 20 — PERMISSION SYSTEM IS MANDATORY

Every action must define:

low
medium
high
critical
RULE 21 — SYSTEM ACTIONS REQUIRE VALIDATION

Examples:

shutdown
delete
kill process

Must validate:

permissions
targets
risk
RULE 22 — NEVER TOUCH SYSTEM FILES WITHOUT SAFETY CHECKS

Protected paths:

C:\Windows
C:\Program Files
Registry
System32

Must require:

admin permission
confirmation
warnings
RULE 23 — LOG ALL IMPORTANT ACTIONS

Log:

timestamp
action
result
errors

Useful for:

debugging
recovery
auditing
6. UI RULES
RULE 24 — ORB MUST BE LIGHTWEIGHT

Orb requirements:

low CPU usage
smooth animations
minimal memory usage
RULE 25 — ORB STATES MUST BE CLEAR

States:

idle
listening
processing
success
error

Each state must have:

distinct animation
distinct color
clear feedback
RULE 26 — CHAT WINDOW MUST SUPPORT SILENT OPERATION

The assistant must always work:

without voice
without microphone
in libraries/offices
RULE 27 — UI MUST NEVER FREEZE

Long operations:

async
background tasks
status indicators
7. PERFORMANCE RULES
RULE 28 — ASSISTANT MUST START FAST

Target:

startup under 3 seconds
RULE 29 — LOW RESOURCE USAGE

Idle target:

low RAM
low CPU
minimal disk access
RULE 30 — LAZY LOAD HEAVY MODULES

Load plugins/modules only when needed.

RULE 31 — NO BLOCKING OPERATIONS

Use:

async workflows
worker threads
queues
8. PLUGIN SYSTEM RULES
RULE 32 — PLUGINS MUST BE ISOLATED

A broken plugin must NOT crash the assistant.

RULE 33 — PLUGINS MUST REGISTER CAPABILITIES

Each plugin defines:

intents
permissions
actions
RULE 34 — PLUGINS MUST FOLLOW SAME PIPELINE

Plugins must use:

intent
→ validation
→ router
→ execution
9. TESTING RULES
RULE 35 — EVERY FEATURE NEEDS TESTS

Required tests:

intent tests
entity extraction tests
automation tests
permission tests
UI tests
RULE 36 — TEST FAILURE CASES

Examples:

missing file
invalid app
access denied
unsupported action
RULE 37 — NEVER MERGE UNTESTED FEATURES

All features must pass:

unit tests
integration tests
manual validation
10. DOCUMENTATION RULES
RULE 38 — EVERY MODULE NEEDS DOCUMENTATION

Each module must explain:

purpose
inputs
outputs
dependencies
workflow
RULE 39 — DOCUMENT ALL INTENTS

Every intent must define:

name
patterns
entities
examples
permissions
RULE 40 — KEEP ARCHITECTURE DIAGRAMS UPDATED

Whenever architecture changes:

update diagrams
update docs
update workflows
11. DEVELOPMENT WORKFLOW RULES
RULE 41 — FEATURE DEVELOPMENT PROCESS

Every new feature must follow:

1. Define capability
2. Define interaction mode
3. Define intent
4. Define entities
5. Create automation module
6. Register router
7. Add permissions
8. Add responses
9. Add tests
10. Update docs
RULE 42 — NEVER BUILD RANDOMLY

All features must:

fit architecture
follow modularity
respect pipelines
RULE 43 — THINK PLATFORM, NOT PROJECT

The assistant is:

a platform
an ecosystem
a framework

NOT:

a toy app
a chatbot
a single script
12. FUTURE SCALABILITY RULES
RULE 44 — DESIGN FOR FUTURE MODULES

Future support:

WhatsApp
Spotify
smart home
workflows
automation chains

Must NOT require rewriting core systems.

RULE 45 — CORE SYSTEMS MUST REMAIN STABLE

Core systems:

intents
router
permissions
automation pipeline

Should remain stable while features expand.

FINAL MASTER RULE
RULE 46 — THE ASSISTANT MUST ALWAYS PRIORITIZE:
modularity
maintainability
security
deterministic execution
developer readability
scalability
offline functionality
clean architecture
performance

Over:

quick hacks
hardcoded logic
random scripts
messy workflows
unsafe execution