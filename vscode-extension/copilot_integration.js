/**
 * Copilot Integration for AI Development Monitor
 * 
 * This module handles integration with GitHub Copilot to detect and monitor suggestions.
 */
const vscode = require('vscode');
const Logger = require('./logger');

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce
 * @param {number} wait The number of milliseconds to delay
 * @param {Object} options Additional options
 * @return {Function} The debounced function
 */
function debounce(func, wait, options = {}) {
    let timeout;
    return function(...args) {
        const context = this;
        
        // If we're tracking timeouts for cleanup, remove old timeout from tracking
        if (context._pendingTimeouts && timeout) {
            const index = context._pendingTimeouts.indexOf(timeout);
            if (index !== -1) {
                context._pendingTimeouts.splice(index, 1);
            }
        }
        
        // Clear existing timeout
        clearTimeout(timeout);
        
        // Create new timeout
        timeout = setTimeout(() => {
            // Clean up timeout tracking when executed
            if (context._pendingTimeouts) {
                const index = context._pendingTimeouts.indexOf(timeout);
                if (index !== -1) {
                    context._pendingTimeouts.splice(index, 1);
                }
            }
            
            // Execute the function
            func.apply(context, args);
        }, wait);
        
        // Track the timeout if we have a collection for it
        if (context._pendingTimeouts) {
            context._pendingTimeouts.push(timeout);
        }
    };
}

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
        
        // Add properties for duplicate detection
        this.lastSuggestionHash = '';
        this.lastSuggestionTime = 0;
        this.suggestionDebounceMs = 1000;
        this.ghostTextDetectionInterval = null;
        
        // Additional optimization properties
        this._pendingTimeouts = []; // Track timeouts for cleanup
        this._lastGhostTextLog = 0; // Timestamp of last ghost text log
        this._rapidDetectionCount = 0; // Count for detecting spam
        this._lastNotificationTime = 0; // For notification rate limiting
        this._loggingThrottleMap = new Map(); // To throttle specific log messages
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
        
        // Add properties for detecting duplicates
        this.lastSuggestionHash = '';
        this.lastSuggestionTime = Date.now();
        this.suggestionDebounceMs = 1000; // Prevent duplicate logging within 1 second
        
        // Method 1: Watch for text document changes which might indicate a Copilot suggestion was applied
        // Use debounce to prevent multiple rapid firings
        const debouncedAnalyzeTextChange = debounce((contentChanges, editor) => {
            this.analyzeTextChange(contentChanges, editor);
        }, 300, { trackTimeout: true });
        
        // Get configuration to adjust sensitivity
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.suggestionDebounceMs = config.get('logging.debounceTime', 1000);
        
        this.textDocumentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
            if (!event.contentChanges.length) return;
            
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            
            // Skip changes from certain file types that commonly cause false positives
            const skipFileTypes = ['.git', 'node_modules', '.vsix', 'package-lock.json'];
            if (skipFileTypes.some(type => editor.document.fileName.includes(type))) {
                return;
            }
            
            // Look for patterns that might indicate a Copilot suggestion being applied
            // This is a heuristic approach and not 100% reliable
            debouncedAnalyzeTextChange(event.contentChanges, editor);
        });
        
        // Method 2: Watch for editor view decorations that might be Copilot ghost text
        // This is an experimental approach that tries to detect when Copilot is showing a suggestion
        // Use a configurable interval to balance detection vs performance
        if (this.ghostTextDetectionInterval) {
            clearInterval(this.ghostTextDetectionInterval);
        }
        
        // Get ghost text check interval from config (default 2000ms)
        const ghostTextCheckInterval = config.get('logging.ghostTextCheckInterval', 2000);
        
        // Only set up ghost text detection if the interval is reasonable
        if (ghostTextCheckInterval > 0 && ghostTextCheckInterval < 10000) {
            this.ghostTextDetectionInterval = setInterval(() => {
                this.detectGhostTextDecorations();
            }, ghostTextCheckInterval);
            
            Logger.debug(`Ghost text detection interval set to ${ghostTextCheckInterval}ms`, 'copilot');
        } else {
            Logger.info('Ghost text detection disabled (interval out of range)', 'copilot');
        }
        
        Logger.info('Suggestion detection listeners established (optimized)', 'copilot');
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
            // Get the full inserted text
            const change = contentChanges.find(change => change.text.includes('\n'));
            if (change) {
                const insertedText = change.text;
                const position = change.range.start;
                const document = editor.document;
                
                // Create a simple hash of the inserted text to detect duplicates
                // Just use the first 100 chars and length as a simple fingerprint
                const textSample = insertedText.substring(0, 100);
                const suggestionHash = `${textSample.length}_${textSample.replace(/\s+/g, '')}_${insertedText.length}`;
                
                // Check if this is a duplicate detection (same or very similar text recently processed)
                const now = Date.now();
                if (suggestionHash === this.lastSuggestionHash && 
                    (now - this.lastSuggestionTime < this.suggestionDebounceMs)) {
                    // Skip duplicate detection
                    return;
                }
                
                // Check frequency of detections - if we're getting too many in a short period
                // this is likely not real Copilot suggestions but something else
                if (this.lastSuggestionTime > 0 && (now - this.lastSuggestionTime < 500)) {
                    this._rapidDetectionCount = (this._rapidDetectionCount || 0) + 1;
                    
                    // If we've had multiple rapid detections, throttle heavily
                    if (this._rapidDetectionCount > 3) {
                        // Skip this detection completely - likely false positive
                        return;
                    }
                } else {
                    // Reset rapid detection counter
                    this._rapidDetectionCount = 0;
                }
                
                // Update tracking info
                this.lastSuggestionHash = suggestionHash;
                this.lastSuggestionTime = now;
                
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
                
                // Combined log message to reduce spam, and only log at lower frequency
                if (this._rapidDetectionCount <= 1) {
                    Logger.debug(`Captured Copilot suggestion (${insertedText.length} chars)`, 'copilot');
                }
                
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
        // Skip if there's no active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        // Skip if we recently processed a suggestion (reduces redundant checks)
        const now = Date.now();
        if (now - this.lastSuggestionTime < 3000) { // Increased from suggestionDebounceMs to 3000ms
            return;
        }
        
        // Skip further scanning if we've had frequent detections recently
        if (this._rapidDetectionCount > 2) {
            // Too many recent detections - likely false positives
            return;
        }
        
        // Skip ghost text detection for large files (more than 1MB) to prevent performance issues
        if (editor.document.getText().length > 1000000) {
            return;
        }
        
        // This is a heuristic approach to detect Copilot ghost text
        // Unfortunately, VS Code API doesn't provide direct access to ghost text
        
        // We could potentially use the InlineCompletionProvider API in the future
        // if GitHub Copilot exposes it through their extension API
        
        // Check if Copilot is actually active (reduces unnecessary processing)
        if (this.copilotExtension && !this.copilotExtension.isActive) {
            return;
        }
        
        // Log at debug level, with low frequency
        if (now - this._lastGhostTextLog > 10000) { // Only log every 10 seconds at most
            this._lastGhostTextLog = now;
            Logger.debug(`Checking for ghost text (passive)`, 'copilot');
        }
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
     * @param {boolean} lowVerbosity If true, reduces log verbosity for this notification
     */
    notifySuggestionChange(lowVerbosity = false) {
        if (!this.lastDetectedSuggestion) return;
        
        // Apply notification rate limiting
        const now = Date.now();
        if (now - this._lastNotificationTime < 2000) { // Don't notify more than once every 2 seconds
            // For rapid notifications, increment a counter so we can track this
            this._notificationThrottleCount = (this._notificationThrottleCount || 0) + 1;
            if (this._notificationThrottleCount < 5) {
                // Only log this a few times to avoid log spam
                Logger.debug(`Throttled notification (${this._notificationThrottleCount} skipped)`, 'copilot');
            }
            return;
        }
        
        // Reset throttle counter and update last notification time
        this._notificationThrottleCount = 0;
        this._lastNotificationTime = now;
        
        // Check if we have any callbacks registered
        if (this.suggestionChangeCallbacks.length === 0) {
            return;
        }
        
        // Log only if we have callbacks and logging is needed (not in low verbosity mode)
        if (!lowVerbosity) {
            // Use message hashing to avoid logging the same message repeatedly
            const msgHash = `notify_${this.suggestionChangeCallbacks.length}_${this.lastDetectedSuggestion.proposedChanges.length}`;
            const lastLog = this._loggingThrottleMap.get(msgHash) || 0;
            
            if (now - lastLog > 10000) { // Only log this message type every 10 seconds
                Logger.debug(`Notifying ${this.suggestionChangeCallbacks.length} listeners about suggestion change`, 'copilot');
                this._loggingThrottleMap.set(msgHash, now);
            }
        }
        
        // Execute callbacks with appropriate error handling
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
     * Dispose resources and clean up all listeners and timers
     */
    dispose() {
        Logger.info('Disposing Copilot integration resources', 'copilot');
        
        // Clean up event listeners
        if (this.textDocumentChangeListener) {
            this.textDocumentChangeListener.dispose();
            this.textDocumentChangeListener = null;
        }
        
        // Clear all intervals
        if (this.ghostTextDetectionInterval) {
            clearInterval(this.ghostTextDetectionInterval);
            this.ghostTextDetectionInterval = null;
            Logger.debug('Cleared ghost text detection interval', 'copilot');
        }
        
        // Clear any pending timeouts (for debounce)
        if (this._pendingTimeouts) {
            this._pendingTimeouts.forEach(timeout => clearTimeout(timeout));
            this._pendingTimeouts = [];
        }
        
        // Clear references that might prevent garbage collection
        this.lastDetectedSuggestion = null;
        this.suggestionChangeCallbacks = [];
        this.ghostTextDecorationTypes = [];
        
        Logger.info('Copilot integration resources disposed', 'copilot');
    }
}

module.exports = CopilotIntegration;
