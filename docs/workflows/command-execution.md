# Command Execution Workflow

## Voice Mode

```
User activates OpenX by hotkey, chat, phone, or voice UI
  → Wake word detected
  → Orb glows blue (listening)
  → Assistant captures audio
  → Speech-to-text converts to text
  → Text enters shared pipeline
```

## Chat Mode

```
User clicks orb
  → Chat window opens
  → User types command
  → Text enters shared pipeline
```

## Shared Pipeline (both modes)

```
1. Input Normalizer
   - Lowercase, trim, remove punctuation
   - Strip wake word if present

2. Intent Matcher
   - Compare against pattern index
   - Calculate confidence score
   - Return best matching intent

3. Entity Extractor
   - Extract numeric values, app names, file paths
   - Resolve aliases (e.g., "VSCode" → "code")

4. Permission Validator
   - Check permission level
   - Low: auto-execute
   - Medium: confirm
   - High/Critical: require auth

5. Action Router
   - Map intent to automation module
   - Execute operation

6. Response Generator
   - Select template based on result
   - Interpolate entities and data
   - Apply personality formatting
```

## Example: "Open Chrome"

```
Input: "Open Chrome"
  → Normalized: "open chrome"
  → Intent: app.open (confidence: 0.95)
  → Entities: { appName: "chrome" }
  → Permission: low (auto-execute)
  → Action: automation.apps.open("chrome")
  → Response: "Opening Chrome, sir."
```
