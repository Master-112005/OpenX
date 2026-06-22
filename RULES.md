# OpenX Core Engineering Principles

## RULE 1 — EVERYTHING MUST BE MODULAR

Every feature shall exist as an independent module with isolated logic, tests, documentation, and interfaces.

Modules must be designed for independent development, maintenance, and replacement.

---

## RULE 2 — SINGLE RESPONSIBILITY PRINCIPLE

Each module shall have one clearly defined responsibility.

A module must not perform unrelated operations or assume responsibilities belonging to other modules.

---

## RULE 3 — UI MUST NEVER EXECUTE AUTOMATION DIRECTLY

User interface components are strictly presentation layers.

All actions must pass through:

UI → Intent Engine → Validation → Router → Automation Layer

Direct execution from the UI is prohibited.

---

## RULE 4 — AUTOMATION LAYER MUST NOT KNOW UI EXISTS

Automation modules must operate independently of user interface implementations.

Automation logic shall not import, reference, or depend on renderer, overlay, orb, or UI components.

---

## RULE 5 — SHARED EXECUTION PIPELINE

All interaction methods must use the same execution path.

Voice, chat, API, plugins, and future integrations shall process commands through:

Input → Intent → Validation → Router → Execution → Response

---

## RULE 6 — CLEAN DIRECTORY STRUCTURE

The codebase shall maintain a predictable and scalable directory hierarchy.

Folder names must clearly communicate purpose and ownership.

Developers should be able to understand system organization without additional guidance.

---

## RULE 7 — NEVER PLACE RANDOM LOGIC

Logic must be placed within its appropriate module.

Generic dumping grounds, oversized utility files, and unrelated helper collections are prohibited.

---

## RULE 8 — USE TYPE SAFETY

All internal contracts shall use explicit schemas, interfaces, or type definitions.

Inputs, outputs, entities, commands, and configuration objects must be validated and structured.

---

## RULE 9 — NO MAGIC VALUES

Hardcoded values are prohibited.

Constants, thresholds, limits, and configuration values must be declared using descriptive identifiers.

---

## RULE 10 — INTENTS MUST BE EXPLICIT

Every executable action must be represented by a well-defined intent.

Examples:

* app.open
* file.delete
* volume.up
* browser.search

Ambiguous actions are not permitted.

---

## RULE 11 — EVERY INTENT NEEDS DEFINITION

Every intent must define:

* Purpose
* Patterns
* Entities
* Permission Level
* Responses
* Validation Rules
* Tests

---

## RULE 12 — ENTITY EXTRACTION MUST BE STRUCTURED

Natural language inputs must be converted into structured data before execution.

Example:

{
"intent": "file.delete",
"filename": "notes.txt"
}

Automation modules must never depend on raw user text.

---

## RULE 13 — INTENT CONFIDENCE SYSTEM

Intent matching shall produce confidence scores.

Low-confidence matches must trigger clarification rather than execution.

Deterministic execution is preferred over assumption-based behavior.

---

## RULE 14 — PERMISSION SYSTEM IS MANDATORY

Every executable action must declare a permission level.

Minimum levels:

* Low
* Medium
* High
* Critical

Permission requirements must be enforced before execution.

---

## RULE 15 — SYSTEM ACTIONS REQUIRE VALIDATION

Sensitive operations must validate:

* Intent
* Target
* Risk Level
* Permissions
* Preconditions

Validation failures must stop execution.

---

## RULE 16 — PROTECTED SYSTEM AREAS REQUIRE SAFETY CHECKS

Operations affecting critical operating system resources require additional safeguards.

Examples include:

* System directories
* Registry modifications
* Administrative operations
* Security-sensitive resources

High-risk actions must require confirmation and validation.

---

## RULE 17 — LOG ALL IMPORTANT ACTIONS

The platform shall maintain structured logs for significant operations.

Logs should contain:

* Timestamp
* Action
* Result
* Errors
* Relevant Metadata

Logging must support auditing, debugging, and recovery.

---

## RULE 18 — PLUGINS MUST BE ISOLATED

Plugin failures must never compromise platform stability.

Plugins operate within controlled boundaries and may not crash core systems.

---

## RULE 19 — PLUGINS MUST REGISTER CAPABILITIES

Every plugin shall explicitly declare:

* Intents
* Permissions
* Actions
* Dependencies

Capabilities must be discoverable and validated during registration.

---

## RULE 20 — PLUGINS MUST FOLLOW THE PIPELINE

Plugins must integrate into the same execution architecture as native modules.

Plugin execution path:

Intent → Validation → Router → Execution

Bypassing the platform pipeline is prohibited.

---

## RULE 21 — EVERY FEATURE NEEDS TESTS

Each feature must include:

* Unit Tests
* Integration Tests
* Permission Tests
* Failure Case Tests

Untested functionality is considered incomplete.

---

## RULE 22 — EVERY MODULE NEEDS DOCUMENTATION

Every module shall document:

* Purpose
* Inputs
* Outputs
* Dependencies
* Workflows
* Extension Points

Documentation must remain synchronized with implementation.

---

## RULE 23 — NEVER BUILD RANDOMLY

New functionality must align with platform architecture.

Features that violate modularity, security, scalability, or execution standards shall not be introduced.

---

## RULE 24 — THINK PLATFORM, NOT PROJECT

OpenX is a platform architecture, not a single-purpose application.

Design decisions must prioritize extensibility, maintainability, and long-term evolution.

---

## RULE 25 — CORE SYSTEMS MUST REMAIN STABLE

The following systems are foundational:

* Intent Engine
* Router
* Permission System
* Automation Pipeline

Feature growth must not require redesigning these core systems.

---

## RULE 26 — FINAL MASTER RULE

Every engineering decision shall prioritize:

* Modularity
* Maintainability
* Security
* Deterministic Execution
* Developer Readability
* Scalability
* Offline Functionality
* Clean Architecture
* Performance

These priorities always take precedence over quick fixes, hardcoded solutions, unsafe execution paths, or short-term convenience.
