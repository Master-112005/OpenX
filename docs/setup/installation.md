# Installation Guide

## Prerequisites

- Windows 10 or later
- Node.js 18+
- npm 9+

## Quick Start

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Start in production mode
npm start
```

## Configuration

Edit `config.js` to customize:
- Wake word
- Orb appearance
- Voice settings
- Permission levels
- Theme preferences

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:core
npm run test:automation
npm run test:voice
```

## Building

```bash
# Package for Windows
npm run package
```

## Directory Structure

```
jarvis/
├── apps/           # Desktop application (Electron)
├── core/           # Core engine
│   ├── assistant/  # Input processing, intent matching
│   ├── automation/ # Windows operations
│   ├── voice/      # Speech recognition & synthesis
│   ├── permissions/# Security validation
│   └── ui/         # State management
├── plugins/        # Extensible plugin system
├── config/         # Application configuration
├── tests/          # Test suites
└── docs/           # Documentation
```
