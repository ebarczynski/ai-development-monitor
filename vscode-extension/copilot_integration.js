/**
 * Copilot Integration for AI Development Monitor
 * 
 * This module handles integration with GitHub Copilot to detect and monitor suggestions.
 */
const vscode = require('vscode');
const Logger = require('./logger');

/**
 * Class to handle GitHub Copilot integration
 */
class CopilotIntegration {
    constructor() {
        this.isAvailable = false;
        this.copilotExtension = null;
        this.copilotExports = null;
        this.textDocumentChangeListener = null;
        this.ghostTextDecorationTypes = [];
        this.lastDetectedSuggestion = null;
        this.suggestionChangeCallbacks = [];
    }

    /**
     * Initialize the Copilot integration
     * @returns {boolean} Whether Copilot is available
     */
    async initialize() {
        Logger.info('Initializing GitHub Copilot integration', 'copilot');
        
        // Check if Copilot is installed
        try {
            this.copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
            
            if (!this.copilotExtension) {
                Logger.warn('GitHub Copilot extension not found', 'copilot');
                this.isAvailable = false;
                return false;
            }
            
            Logger.info('GitHub Copilot extension found', 'copilot');
            
            // Try to activate the extension if it's not already active
            if (!this.copilotExtension.isActive) {
                Logger.debug('Activating GitHub Copilot extension', 'copilot');
                await this.copilotExtension.activate();
                Logger.info('GitHub Copilot extension activated', 'copilot');
            }
            
            // Try to access Copilot's exports (may not be public API)
            this.copilotExports = this.copilotExtension.exports;
            Logger.debug('Accessed Copilot exports: ' + (this.copilotExports ? 'Yes' : 'No'), 'copilot');
            
            // Set up listeners
            this.setupListeners();
            
            this.isAvailable = true;
            return true;
        } catch (error) {
            Logger.error('Error initializing GitHub Copilot integration', error, 'copilot');
            this.isAvailable = false;
            return false;
        }
    }
    
    /**
     * Set up listeners for detecting Copilot suggestions
     */
    setupListeners() {
        Logger.info('Setting up suggestion detection listeners', 'copilot');
        
        // Method 1: Watch for text document changes which might indicate a Copilot suggestion was applied
        this.textDocumentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (!event.contentChanges.length) return;
            
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            
            // Look for patterns that might indicate a Copilot suggestion being applied
            // This is a heuristic approach and not 100% reliable
            this.analyzeTextChange(event.contentChanges, editor);
        });
        
        // Method 2: Watch for editor view decorations that might be Copilot ghost text
        // This is an experimental approach that tries to detect when Copilot is showing a suggestion
        setInterval(() => {
            this.detectGhostTextDecorations();
        }, 500);
        
        Logger.info('Suggestion detection listeners established', 'copilot');
    }
    
    /**
     * Analyze text changes to detect potential Copilot suggestions being applied
     */
    analyzeTextChange(contentChanges, editor) {
        // Skip small changes (like single character typing)
        const significantChange = contentChanges.some(change => 
            change.text.length > 10 || change.text.includes('\n'));
        
        if (!significantChange) return;
        
        // Look for multiline insertions which are more likely to be Copilot suggestions
        const multilineChange = contentChanges.some(change => change.text.includes('\n'));
        
        if (multilineChange) {
            Logger.debug('Detected potential Copilot suggestion application (multiline change)', 'copilot');
            
            // Get the full inserted text
            const change = contentChanges.find(change => change.text.includes('\n'));
            if (change) {
                const insertedText = change.text;
                const position = change.range.start;
                const document = editor.document;
                
                // Get some context before the change
                let contextStart = new vscode.Position(
                    Math.max(0, position.line - 10),
                    0
                );
                const contextBefore = document.getText(new vscode.Range(contextStart, position));
                
                this.lastDetectedSuggestion = {
                    originalCode: contextBefore,
                    proposedChanges: insertedText,
                    time: new Date(),
                    document: document,
                    position: position
                };
                
                Logger.debug('Captured potential Copilot suggestion', 'copilot');
                Logger.debug(`Inserted text length: ${insertedText.length} characters`, 'copilot');
                
                // Notify any registered callbacks
                this.notifySuggestionChange();
            }
        }
    }
    
    /**
     * Detect ghost text decorations which might indicate active Copilot suggestions
     * This is an experimental approach and may not be reliable
     */
    detectGhostTextDecorations() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        // This is a heuristic approach to detect Copilot ghost text
        // Unfortunately, VS Code API doesn't provide direct access to ghost text
        
        // We could potentially use the InlineCompletionProvider API in the future
        // if GitHub Copilot exposes it through their extension API
    }
    
    /**
     * Register a callback to be notified when a suggestion is detected
     */
    onSuggestionDetected(callback) {
        this.suggestionChangeCallbacks.push(callback);
        return {
            dispose: () => {
                const index = this.suggestionChangeCallbacks.indexOf(callback);
                if (index !== -1) {
                    this.suggestionChangeCallbacks.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * Notify all registered callbacks about a suggestion change
     */
    notifySuggestionChange() {
        if (!this.lastDetectedSuggestion) return;
        
        for (const callback of this.suggestionChangeCallbacks) {
            try {
                callback(this.lastDetectedSuggestion);
            } catch (error) {
                Logger.error('Error in suggestion change callback', error, 'copilot');
            }
        }
    }
    
    /**
     * Get the last detected suggestion
     */
    getLastSuggestion() {
        return this.lastDetectedSuggestion;
    }
    
    /**
     * Manually trigger evaluation of current suggestion
     * (for when automatic detection doesn't work)
     */
    triggerManualEvaluation() {
        // Get the current selection or code block
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            Logger.warn('No active editor for manual evaluation', 'copilot');
            return null;
        }
        
        // Get the current selection or current function/block if no selection
        const selection = editor.selection;
        let proposedChanges;
        let originalCode;
        
        if (selection.isEmpty) {
            // Try to get from clipboard
            Logger.debug('No selection, trying clipboard', 'copilot');
            return null; // Let the main evaluation function handle this case
        } else {
            // Use the selection
            proposedChanges = editor.document.getText(selection);
            
            // Get some context before the selection
            const contextStart = new vscode.Position(
                Math.max(0, selection.start.line - 10),
                0
            );
            originalCode = editor.document.getText(new vscode.Range(contextStart, selection.start));
            
            Logger.debug('Using selection for manual evaluation', 'copilot');
            Logger.debug(`Selection length: ${proposedChanges.length} characters`, 'copilot');
            
            return {
                originalCode,
                proposedChanges,
                time: new Date(),
                document: editor.document,
                position: selection.start
            };
        }
    }
    
    /**
     * Dispose resources
     */
    dispose() {
        if (this.textDocumentChangeListener) {
            this.textDocumentChangeListener.dispose();
        }
    }
}

module.exports = CopilotIntegration;
