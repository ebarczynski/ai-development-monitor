# Context Manager Integration Guide

This document outlines how to integrate the new Context Manager with existing components of the AI Development Monitor extension.

## Overview

The Context Manager (`context_manager.js`) provides centralized management of task descriptions, code snippets, and other contextual data across the extension. This ensures:

1. Consistent handling of task descriptions
2. Proper prioritization of information sources (chat > editor > fallback)
3. Automatic cleaning of visual markers and generic descriptions
4. Notification of context changes to all components

## Integration Steps by Component

### 1. Copilot Chat Integration (`copilot_chat_integration.js`)

- Import the Context Manager
```javascript
const contextManager = require('./context_manager');
```

- Modify the `extractContextFromChat` method to update the Context Manager instead of `lastExtractedContext`:
```javascript
// Replace:
this.lastExtractedContext = { ... };

// With:
contextManager.updateContext({
  taskDescription: taskDescription,
  originalCode: originalCode,
  proposedCode: proposedCode,
  language: language,
  sourceType: 'chat'
});

// Keep local reference for backward compatibility
this.lastExtractedContext = contextManager.getContext();
```

- Update the `getExtractedContext` method:
```javascript
getExtractedContext() {
  // First try to get context from ContextManager
  const contextFromManager = contextManager.getContext();
  
  // If Context Manager has content, use it
  if (contextFromManager.taskDescription) {
    return contextFromManager;
  }
  
  // Fall back to local context if needed
  return this.lastExtractedContext;
}
```

### 2. MCP Client (`mcp_client.js`)

- Import the Context Manager
```javascript
const contextManager = require('./context_manager');
```

- Modify the `updateEnhancedContext` method:
```javascript
updateEnhancedContext(context) {
  if (!context) return;
  
  // Update the Context Manager
  contextManager.updateContext({
    taskDescription: context.taskDescription,
    originalCode: context.originalCode,
    language: context.language,
    sourceType: context.sourceType || 'unknown'
  });
  
  // Keep local reference for backward compatibility
  this.enhancedContext = contextManager.getContext();
}
```

- Update the `sendSuggestion` method:
```javascript
// Replace:
if (this.enhancedContext.taskDescription && !suggestion.task_description) {
  suggestion.task_description = this.enhancedContext.taskDescription;
}

// With:
const currentContext = contextManager.getContext();
if (currentContext.taskDescription && !suggestion.task_description) {
  suggestion.task_description = currentContext.taskDescription;
}
```

### 3. TDD Extension (`tdd_extension.js`)

- Import the Context Manager
```javascript
const contextManager = require('./context_manager');
```

- Update the `sendTDDRequest` function:
```javascript
// After the initial taskDescription handling:
if (!taskDescription) {
  // Try to get from Context Manager
  const context = contextManager.getContext();
  if (context.taskDescription) {
    taskDescription = context.taskDescription;
    outputChannel.appendLine(`Using task description from Context Manager: ${taskDescription}`);
  } else {
    // Fall back to extracting from code
    taskDescription = extractMeaningfulDescription(code, language);
  }
}
```

### 4. Extension Main (`extension.js`)

- Import the Context Manager
```javascript
const contextManager = require('./context_manager');
```

- Update task description handling in evaluation:
```javascript
// Replace:
let taskDescription;
if (copilotChatIntegration && copilotChatIntegration.isAvailable) {
  const extractedContext = copilotChatIntegration.getExtractedContext();
  if (extractedContext && extractedContext.taskDescription) {
    taskDescription = extractedContext.taskDescription;
  }
}

// With:
let taskDescription;
// Try to get task description from Context Manager
const context = contextManager.getContext();
if (context.taskDescription) {
  taskDescription = context.taskDescription;
  Logger.debug(`Using task description from Context Manager: ${taskDescription.substring(0, 50)}...`, 'evaluation');
} else if (copilotChatIntegration && copilotChatIntegration.isAvailable) {
  const extractedContext = copilotChatIntegration.getExtractedContext();
  if (extractedContext && extractedContext.taskDescription) {
    taskDescription = extractedContext.taskDescription;
    Logger.debug(`Using task description from Copilot Chat: ${taskDescription.substring(0, 50)}...`, 'evaluation');
  }
}
```

## Testing the Integration

After implementing these changes, test the following scenarios:

1. Capture a GitHub Copilot Chat query and verify it's correctly stored in the Context Manager
2. Check that TDD tests use the correct task description
3. Ensure the evaluation system uses the context from the Context Manager
4. Verify that task descriptions are cleaned properly (no visual markers, no generic descriptions)

## Troubleshooting

If issues occur:

1. Check the logs for context-related messages (tagged with 'context')
2. Verify that the Context Manager is being properly imported in all components
3. Check for any syntax errors in the integration code
4. Make sure the Context Manager is properly initialized before use
