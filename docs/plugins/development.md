# Plugin Development Guide

## Overview

Plugins extend JARVIS with new commands and capabilities. Each plugin lives in its own directory under `plugins/` and consists of:

- `plugin.json` - Manifest file
- `index.js` - Plugin implementation

## Plugin Structure

```
plugins/my-plugin/
├── plugin.json
└── index.js
```

## Manifest (`plugin.json`)

```json
{
  "name": "My Plugin",
  "id": "my_plugin",
  "version": "1.0.0",
  "description": "Description of what this plugin does",
  "author": "",
  "permissions": ["low"],
  "intents": [
    {
      "id": "myplugin.action",
      "patterns": ["trigger pattern", "another pattern"],
      "permissionLevel": "low",
      "action": "myplugin.action",
      "entities": []
    }
  ]
}
```

## Plugin Implementation (`index.js`)

```javascript
class MyPlugin {
  constructor(config, automationEngine, intentRegistry) {
    this.config = config;
    this.automation = automationEngine;
    this.intentRegistry = intentRegistry;
  }

  async initialize() {
    this.automation.registerAction('myplugin.action', (entities) => {
      // Perform your automation
      return { success: true, data: { message: 'Done!' } };
    });

    this.intentRegistry.registerCustom({
      id: 'myplugin.action',
      patterns: ['trigger pattern'],
      permissionLevel: 'low',
      action: 'myplugin.action',
      entities: [],
      description: 'My custom action'
    });

    return true;
  }

  async destroy() {
    this.automation.unregisterAction('myplugin.action');
    this.intentRegistry.unregister('myplugin.action');
  }
}

module.exports = MyPlugin;
```

## Best Practices

1. **Register all intents in `initialize()`** - never in the constructor
2. **Clean up in `destroy()`** - unregister actions and intents
3. **Use unique intent/action IDs** - prefix with your plugin name
4. **Handle errors gracefully** - return `{ success: false, error: "..." }`
5. **Keep plugins isolated** - don't depend on other plugins
