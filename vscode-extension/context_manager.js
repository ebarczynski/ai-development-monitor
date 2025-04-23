/**
 * Context Manager for AI Development Monitor
 * 
 * This module provides centralized management of context information
 * across different components of the extension, ensuring consistent
 * handling of task descriptions, code snippets, and other contextual data.
 */
const vscode = require('vscode');
const Logger = require('./logger');

class ContextManager {
    constructor() {
        // Core context object
        this.context = {
            taskDescription: '',
            originalCode: '',
            proposedCode: '',
            language: '',
            sourceType: '',
            filePath: '',
            timestamp: '',
            metadata: {}
        };

        // Define valid source types
        this.sourceTypes = ['chat', 'editor', 'selection', 'file', 'manual', 'fallback'];
        
        // Set up storage but don't initialize until we have extension context
        this.extensionContext = null;
        this.listeners = [];
    }

    /**
     * Initialize the context manager with the extension context
     * @param {vscode.ExtensionContext} extensionContext The VS Code extension context
     */
    initialize(extensionContext) {
        if (!extensionContext) {
            Logger.error('Failed to initialize context manager: No extension context provided', null, 'context');
            return;
        }
        
        this.extensionContext = extensionContext;
        Logger.info('Context manager initialized with extension context', 'context');
        
        // Try to restore context from storage
        this.restoreContext();
        
        return this;
    }

    /**
     * Update context with new information
     * @param {Object} newContext Partial context object with updated values
     * @param {boolean} notify Whether to notify listeners of this change
     * @returns {Object} The updated context
     */
    updateContext(newContext, notify = true) {
        if (!newContext) return this.context;
        
        // Store previous values for logging changes
        const previousTaskDescription = this.context.taskDescription;
        const previousSourceType = this.context.sourceType;
        
        // Clean and validate task description
        if (newContext.taskDescription) {
            newContext.taskDescription = this.cleanTaskDescription(newContext.taskDescription);
        }
        
        // Validate source type
        if (newContext.sourceType && !this.sourceTypes.includes(newContext.sourceType)) {
            Logger.warn(`Invalid source type: ${newContext.sourceType}, defaulting to 'unknown'`, 'context');
            newContext.sourceType = 'unknown';
        }
        
        // Prioritize sources - chat has highest priority
        if (this.context.sourceType === 'chat' && newContext.sourceType && newContext.sourceType !== 'chat') {
            Logger.debug('Skipping update from lower-priority source while chat source exists', 'context');
            
            // Only override chat-sourced task description if explicitly forced or empty
            if (!newContext.forceUpdate && this.context.taskDescription) {
                delete newContext.taskDescription;
            }
        }
        
        // Update timestamp
        newContext.timestamp = new Date().toISOString();
        
        // Merge context
        this.context = {
            ...this.context,
            ...newContext
        };
        
        // Log significant changes
        if (previousTaskDescription !== this.context.taskDescription) {
            Logger.info(`Task description updated from ${previousSourceType || 'unknown'} to ${this.context.sourceType || 'unknown'}`, 'context');
            Logger.debug(`New task description: ${this.context.taskDescription.substring(0, 50)}...`, 'context');
        }
        
        // Save to storage
        this.saveContext();
        
        // Notify listeners if requested
        if (notify) {
            this.notifyListeners();
        }
        
        return this.context;
    }

    /**
     * Clean and normalize task description
     * @param {string} taskDescription Raw task description
     * @returns {string} Cleaned task description
     */
    cleanTaskDescription(taskDescription) {
        if (!taskDescription) return '';
        
        // Remove visual indicators
        if (taskDescription.startsWith('[CHAT QUERY] ')) {
            taskDescription = taskDescription.substring(13);
        } else if (taskDescription.startsWith('[EDITOR CONTENT] ')) {
            taskDescription = taskDescription.substring(17);
        }
        
        // Trim whitespace and normalize line endings
        taskDescription = taskDescription.trim().replace(/\r\n/g, '\n');
        
        // Remove generic descriptions
        const genericDescriptions = [
            'Modify code in',
            'Implement functionality',
            'Make changes to',
            'Update code'
        ];
        
        for (const genericDesc of genericDescriptions) {
            if (taskDescription.startsWith(genericDesc)) {
                Logger.debug(`Removing generic description: ${genericDesc}`, 'context');
                return '';
            }
        }
        
        return taskDescription;
    }

    /**
     * Clear context data
     * @param {boolean} notify Whether to notify listeners
     */
    clearContext(notify = true) {
        this.context = {
            taskDescription: '',
            originalCode: '',
            proposedCode: '',
            language: '',
            sourceType: '',
            filePath: '',
            timestamp: new Date().toISOString(),
            metadata: {}
        };
        
        this.saveContext();
        
        if (notify) {
            this.notifyListeners();
        }
        
        Logger.info('Context cleared', 'context');
    }

    /**
     * Save context to persistent storage
     */
    saveContext() {
        try {
            if (!this.extensionContext) {
                Logger.warn('Cannot save context: Extension context not initialized', 'context');
                return;
            }
            
            // Don't store potentially large code snippets
            const storageContext = {
                ...this.context,
                originalCode: this.context.originalCode ? `(${this.context.originalCode.length} chars)` : '',
                proposedCode: this.context.proposedCode ? `(${this.context.proposedCode.length} chars)` : ''
            };
            
            this.extensionContext.globalState.update('ai-dev-monitor-context', storageContext);
            Logger.debug('Context saved to global storage', 'context');
        } catch (error) {
            Logger.error('Failed to save context to storage', error, 'context');
        }
    }

    /**
     * Restore context from persistent storage
     */
    restoreContext() {
        try {
            if (!this.extensionContext) {
                Logger.warn('Cannot restore context: Extension context not initialized', 'context');
                return;
            }
            
            const storedContext = this.extensionContext.globalState.get('ai-dev-monitor-context');
            if (storedContext) {
                // Only restore metadata, not code or other potentially stale data
                this.context.metadata = storedContext.metadata || {};
                Logger.info('Context metadata restored from storage', 'context');
            }
        } catch (error) {
            Logger.error('Failed to restore context from storage', error, 'context');
        }
    }

    /**
     * Get the current context
     * @returns {Object} The current context object
     */
    getContext() {
        return {...this.context};
    }

    /**
     * Get just the task description
     * @returns {string} Current task description
     */
    getTaskDescription() {
        return this.context.taskDescription || '';
    }

    /**
     * Get source information
     * @returns {Object} Source information including type and timestamp
     */
    getSourceInfo() {
        return {
            type: this.context.sourceType || 'unknown',
            timestamp: this.context.timestamp
        };
    }

    /**
     * Register a listener for context changes
     * @param {Function} listener Callback function called when context changes
     * @returns {Function} Function to unregister the listener
     */
    registerListener(listener) {
        if (typeof listener !== 'function') {
            throw new Error('Context listener must be a function');
        }
        
        this.listeners.push(listener);
        Logger.debug(`Context listener registered (total: ${this.listeners.length})`, 'context');
        
        // Return function to unregister
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
            Logger.debug(`Context listener unregistered (remaining: ${this.listeners.length})`, 'context');
        };
    }

    /**
     * Notify all listeners of context changes
     */
    notifyListeners() {
        const contextCopy = {...this.context};
        for (const listener of this.listeners) {
            try {
                listener(contextCopy);
            } catch (error) {
                Logger.error('Error in context change listener', error, 'context');
            }
        }
        Logger.debug(`Notified ${this.listeners.length} context listeners`, 'context');
    }

    /**
     * Check if context contains meaningful information
     * @returns {boolean} Whether the context has meaningful content
     */
    hasContent() {
        return Boolean(
            this.context.taskDescription || 
            this.context.originalCode || 
            this.context.proposedCode
        );
    }

    /**
     * Create a formatted context summary for logging/debugging
     * @returns {string} Formatted context summary
     */
    createContextSummary() {
        return `
Context Summary:
- Task: ${this.context.taskDescription ? this.context.taskDescription.substring(0, 50) + '...' : 'None'}
- Source: ${this.context.sourceType || 'Unknown'}
- Language: ${this.context.language || 'Unknown'}
- Original Code: ${this.context.originalCode ? `${this.context.originalCode.length} chars` : 'None'}
- Proposed Code: ${this.context.proposedCode ? `${this.context.proposedCode.length} chars` : 'None'}
- Updated: ${this.context.timestamp || 'Unknown'}
`;
    }
}

// Create singleton instance
const contextManager = new ContextManager();

module.exports = contextManager;
