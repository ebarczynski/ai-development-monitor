/**
 * Copilot Chat Integration for AI Development Monitor
 * 
 * This module handles integration with GitHub Copilot Chat to capture conversations
 * and extract relevant information for code evaluation.
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');
const contextManager = require('./context_manager');

class CopilotChatIntegration {
    constructor() {
        this.isAvailable = false;
        this.copilotChatExtension = null;
        this.chatHistoryCache = [];
        this.chatViewProvider = null;
        this.lastExtractedContext = {};
        this.chatChangeCallbacks = [];
        this.pendingExtraction = false;
        this.extractionDebounceTimer = null;
        this.lastProcessedSuggestion = null;
        this.suggestionCache = new Set(); // Cache to track processed suggestions
        this.suggestionCacheTimeout = 5000; // Time in ms to keep suggestions in cache
        
        // Register as a listener for context changes from other sources
        this.contextChangeUnsubscribe = contextManager.registerListener(this.handleContextChange.bind(this));
        
        Logger.debug('CopilotChatIntegration initialized and registered with context manager', 'copilot-chat');
    }

    /**
     * Initialize the Copilot Chat integration
     * @returns {boolean} Whether Copilot Chat is available
     */
    async initialize() {
        Logger.info('Initializing GitHub Copilot Chat integration', 'copilot-chat');
        
        // Check if Copilot Chat is installed
        try {
            this.copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
            
            if (!this.copilotChatExtension) {
                Logger.warn('GitHub Copilot Chat extension not found', 'copilot-chat');
                this.isAvailable = false;
                return false;
            }

            
            Logger.info('GitHub Copilot Chat extension found', 'copilot-chat');
            
            // Try to activate the extension if it's not already active
            if (!this.copilotChatExtension.isActive) {
                Logger.debug('Activating GitHub Copilot Chat extension', 'copilot-chat');
                await this.copilotChatExtension.activate();
                
                Logger.info('GitHub Copilot Chat extension activated', 'copilot-chat');
            }
            
            // Set up listeners for chat views
            this.setupChatViewListeners();
            
            // Successfully initialized
            this.isAvailable = true;
            return true;
            
        } catch (error) {
            Logger.error(`Error initializing Copilot Chat integration: ${error.message}`, 'copilot-chat');
            this.isAvailable = false;
            return false;
        }
    }
    
    /**
     * Set up listeners for chat views
     */
    setupChatViewListeners() {
        try {
            // Watch for webview panels that might be Copilot Chat
            vscode.window.registerWebviewPanelSerializer('github.copilot.chat', {
                deserializeWebviewPanel: async (webviewPanel) => {
                    Logger.debug('Copilot Chat webview panel detected', 'copilot-chat');
                    this.trackChatWebview(webviewPanel.webview);
                }
            });
            
            // Listen for changes in active text editor which might be code from chat
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this.isChatRelatedDocument(editor.document)) {
                    this.extractContextFromEditor(editor);
                }
            });
            
            // Listen for chat view commands
            this.registerChatCommands();
            
            Logger.info('Chat view listeners set up successfully', 'copilot-chat');
        } catch (error) {
            Logger.error(`Error setting up chat view listeners: ${error.message}`, 'copilot-chat');
        }
    }
    
    /**
     * Register commands related to chat interaction
     */
    registerChatCommands() {
        // Command to manually extract content from active chat
        vscode.commands.registerCommand('aiDevelopmentMonitor.extractChatContext', () => {
            this.extractChatContext(true);
        });
        
        // Command to view extracted context
        vscode.commands.registerCommand('aiDevelopmentMonitor.viewExtractedContext', () => {
            this.showExtractedContext();
        });
    }
    
    /**
     * Track a webview that might be Copilot Chat
     * @param {vscode.Webview} webview The webview to track
     */
    trackChatWebview(webview) {
        // Listen for messages from the webview
        webview.onDidReceiveMessage(message => {
            if (this.isCopilotChatMessage(message)) {
                this.processChatMessage(message);
            }
        });
        
        // Inject custom script to capture chat content
        this.injectChatCaptureScript(webview);
    }
    
    /**
     * Inject a script to capture chat content
     * @param {vscode.Webview} webview The webview to inject into
     */
    injectChatCaptureScript(webview) {
        try {
            // We can't directly modify the webview content, but we can try 
            // posting a message to it that our extension can intercept
            const script = `
                const observer = new MutationObserver(mutations => {
                    // Look for chat content changes
                    const chatContent = document.querySelector('.chat-content') || 
                                       document.querySelector('.copilot-chat-history');
                    
                    if (chatContent) {
                        const chatMessages = Array.from(chatContent.querySelectorAll('.message, .chat-entry'));
                        const extractedChat = chatMessages.map(msg => {
                            const role = msg.classList.contains('user') ? 'user' : 'assistant';
                            const content = msg.querySelector('.message-content, .text-content')?.textContent || '';
                            const codeBlocks = Array.from(msg.querySelectorAll('pre code')).map(code => {
                                return {
                                    language: code.className.replace('language-', ''),
                                    content: code.textContent
                                };
                            });
                            
                            return { role, content, codeBlocks };
                        });
                        
                        // Post message to extension
                        window.postMessage({ 
                            type: 'ai-dev-monitor-chat-extract',
                            chatHistory: extractedChat
                        });
                    }
                });
                
                // Start observing chat changes
                observer.observe(document.body, { 
                    childList: true, 
                    subtree: true,
                    characterData: true 
                });
                
                // Initial extraction
                setTimeout(() => {
                    const event = new Event('chatExtractReady');
                    document.dispatchEvent(event);
                }, 1000);
            `;
            
            webview.html = webview.html?.replace('</body>', `<script>${script}</script></body>`) || '';
            
        } catch (error) {
            Logger.error(`Error injecting chat capture script: ${error.message}`, 'copilot-chat');
        }
    }
    
    /**
     * Check if a message is from Copilot Chat
     * @param {any} message The message to check
     * @returns {boolean} Whether the message is from Copilot Chat
     */
    isCopilotChatMessage(message) {
        return message && 
              (message.type === 'ai-dev-monitor-chat-extract' || 
               message.command === 'chatResponse' ||
               message.kind === 'chat');
    }
    
    /**
     * Process a message from Copilot Chat
     * @param {any} message The message to process
     */
    processChatMessage(message) {
        try {
            // Check if this is our custom extraction message
            if (message.type === 'ai-dev-monitor-chat-extract') {
                this.chatHistoryCache = message.chatHistory || [];
                Logger.debug(`Captured ${this.chatHistoryCache.length} chat messages`, 'copilot-chat');
                this.extractContextFromChat();
                return;
            }
            
            // Handle regular Copilot Chat messages
            if (message.command === 'chatResponse' || message.kind === 'chat') {
                const content = message.text || message.content || '';
                
                // Check if we've recently processed this exact message
                const messageHash = this.hashMessage(content);
                if (this.suggestionCache.has(messageHash)) {
                    Logger.debug('Skipping duplicate suggestion', 'copilot-chat');
                    return;
                }
                
                // Add to suggestion cache with timeout to auto-remove
                this.suggestionCache.add(messageHash);
                setTimeout(() => {
                    this.suggestionCache.delete(messageHash);
                }, this.suggestionCacheTimeout);
                
                // Parse code blocks
                const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
                const codeBlocks = [];
                let match;
                
                while ((match = codeBlockRegex.exec(content)) !== null) {
                    codeBlocks.push({
                        language: match[1] || 'plaintext',
                        content: match[2].trim()
                    });
                }
                
                // Add to history cache
                this.chatHistoryCache.push({
                    role: message.isUser ? 'user' : 'assistant',
                    content,
                    codeBlocks
                });
                
                // Process any new context
                this.debouncedExtractContext();
            }
        } catch (error) {
            Logger.error(`Error processing chat message: ${error.message}`, 'copilot-chat');
        }
    }
    
    /**
     * Create a simple hash for a message to detect duplicates
     * @param {string} content The message content
     * @returns {string} A hash representation of the content
     */
    hashMessage(content) {
        // Simple hashing by length and first/last chars
        if (!content) return '';
        const length = content.length;
        const firstChars = content.substring(0, Math.min(20, length));
        const lastChars = length > 20 ? content.substring(length - 20) : '';
        return `${length}:${firstChars}:${lastChars}`;
    }
    
    /**
     * Debounce the context extraction to avoid too frequent updates
     */
    debouncedExtractContext() {
        if (this.extractionDebounceTimer) {
            clearTimeout(this.extractionDebounceTimer);
        }
        
        // Use a longer debounce time to reduce frequency of extractions
        this.extractionDebounceTimer = setTimeout(() => {
            if (!this.pendingExtraction) {
                this.extractContextFromChat();
            }
        }, 1000); // Increased from 500ms to 1000ms
    }
    
    /**
     * Check if a document is related to Copilot Chat
     * @param {vscode.TextDocument} document The document to check
     * @returns {boolean} Whether the document is related to Copilot Chat
     */
    isChatRelatedDocument(document) {
        // Check if document has Copilot Chat markers or was recently created from Chat
        return document.fileName.includes('Copilot') || 
               document.uri.scheme === 'untitled' ||
               (document.lineCount > 0 && document.getText().includes('Generated by GitHub Copilot'));
    }
    
    /**
     * Extract context from the editor
     * @param {vscode.TextEditor} editor The editor to extract from
     */
    extractContextFromEditor(editor) {
        try {
            const document = editor.document;
            const text = document.getText();
            
            // Check if this looks like code from Copilot
            if (!this.isChatRelatedDocument(document)) {
                return;
            }
            
            // Determine language
            const language = document.languageId || path.extname(document.fileName).substring(1) || 'plaintext';
            
            // Find task description
            let taskDescription = '';
            
            // Check for comments describing the task
            const commentPatterns = {
                'javascript': [/\/\/\s*(.*)/g, /\/\*\s*([\s\S]*?)\s*\*\//g],
                'typescript': [/\/\/\s*(.*)/g, /\/\*\s*([\s\S]*?)\s*\*\//g],
                'python': [/#\s*(.*)/g, /"""\s*([\s\S]*?)\s*"""/g],
                'java': [/\/\/\s*(.*)/g, /\/\*\s*([\s\S]*?)\s*\*\//g],
                'csharp': [/\/\/\s*(.*)/g, /\/\*\s*([\s\S]*?)\s*\*\//g],
                'cpp': [/\/\/\s*(.*)/g, /\/\*\s*([\s\S]*?)\s*\*\//g],
                'plaintext': [/(.*)/g]
            };
            
            const patterns = commentPatterns[language] || commentPatterns['plaintext'];
            
            // Extract first comment block as potential task description
            for (const pattern of patterns) {
                const match = pattern.exec(text);
                if (match && match[1]) {
                    taskDescription = match[1].trim();
                    if (taskDescription) {
                        break;
                    }
                }
            }
            
            // If we find a task description, add it to our context BUT only if we don't already have a better one
            // from actual chat messages (prioritize chat queries over editor selections or comments)
            if (taskDescription && !this.lastExtractedContext.taskDescription) {
                // Create context update with editor content
                const newContext = {
                    taskDescription: `[EDITOR CONTENT] ${taskDescription}`, // Mark as editor content with visual indicator
                    language: language,
                    code: text,
                    sourceType: 'editor', // Add source type for tracking
                    timestamp: new Date().toISOString()
                };
                
                // Update our centralized context manager
                contextManager.updateContext(newContext);
                
                // Also keep local copy for backward compatibility
                this.lastExtractedContext = newContext;
                
                Logger.debug(`Extracted task description from editor: ${taskDescription.substring(0, 50)}...`, 'copilot-chat');
                Logger.debug('Note: This description from editor content will be overridden if a chat query is found', 'copilot-chat');
                
                // Show notification to user that we're using editor content as fallback
                vscode.window.showInformationMessage(
                    'Using editor content as task description. This will be replaced if a Copilot Chat query is found.',
                    'View Details'
                ).then(selection => {
                    if (selection === 'View Details') {
                        this.showExtractedContext();
                    }
                });
                
                // Notify listeners
                this.notifyContextChange();
            }
        } catch (error) {
            Logger.error(`Error extracting context from editor: ${error.message}`, 'copilot-chat');
        }
    }
    
    /**
     * Extract context from chat history
     * @param {boolean} force Force extraction even if recent
     */
    extractContextFromChat(force = false) {
        if (this.pendingExtraction && !force) {
            return;
        }
        
        this.pendingExtraction = true;
        
        try {
            if (!this.chatHistoryCache || this.chatHistoryCache.length === 0) {
                this.pendingExtraction = false;
                return;
            }
            
            // Initialize context
            let taskDescription = '';
            let originalCode = '';
            let proposedCode = '';
            let language = '';
            
            // Find the most relevant user query and assistant response pairs
            for (let i = 0; i < this.chatHistoryCache.length - 1; i++) {
                const currentMessage = this.chatHistoryCache[i];
                const nextMessage = this.chatHistoryCache[i + 1];
                
                // Look for a user message followed by an assistant message with code
                if (currentMessage.role === 'user' && 
                    nextMessage.role === 'assistant' && 
                    nextMessage.codeBlocks && 
                    nextMessage.codeBlocks.length > 0) {
                    
                    // This is likely a query that led to a code suggestion
                    // Use this as the task description
                    taskDescription = currentMessage.content;
                    
                    // Get the assistant's code as the proposed code
                    const codeBlock = nextMessage.codeBlocks[nextMessage.codeBlocks.length - 1];
                    proposedCode = codeBlock.content;
                    language = codeBlock.language;
                    
                    // Check if the user message has code that might be original code
                    if (currentMessage.codeBlocks && currentMessage.codeBlocks.length > 0) {
                        originalCode = currentMessage.codeBlocks[0].content;
                    }
                    
                    // Since we found a relevant pair, prioritize this over earlier ones
                    // (This ensures we get the most recent query that led to code)
                }
            }
            
            // Fallback: if we didn't find a clear query-response pair, use the last user message
            // before the most recent assistant message with code
            if (!taskDescription) {
                let lastAssistantWithCodeIndex = -1;
                
                // Find the last assistant message with code
                for (let i = this.chatHistoryCache.length - 1; i >= 0; i--) {
                    const message = this.chatHistoryCache[i];
                    if (message.role === 'assistant' && 
                        message.codeBlocks && 
                        message.codeBlocks.length > 0) {
                        lastAssistantWithCodeIndex = i;
                        
                        // Get the proposed code from this message
                        const codeBlock = message.codeBlocks[message.codeBlocks.length - 1];
                        proposedCode = codeBlock.content;
                        language = codeBlock.language;
                        break;
                    }
                }
                
                // Find the last user message before this assistant message
                if (lastAssistantWithCodeIndex > 0) {
                    for (let i = lastAssistantWithCodeIndex - 1; i >= 0; i--) {
                        const message = this.chatHistoryCache[i];
                        if (message.role === 'user') {
                            // Filter out VS Code application output that might be mistaken for user queries
                            const potentialTaskDescription = message.content;
                            
                            // Skip if it's likely application output (long stack traces, verbose logging, etc.)
                            if (this.isLikelyApplicationOutput(potentialTaskDescription)) {
                                Logger.debug('Skipping likely application output in task description', 'copilot-chat');
                                continue;
                            }
                            
                            taskDescription = potentialTaskDescription;
                            
                            // Check for original code
                            if (message.codeBlocks && message.codeBlocks.length > 0) {
                                originalCode = message.codeBlocks[0].content;
                            }
                            break;
                        }
                    }
                }
            }
            
            // Apply advanced parsing to extract more specific requirements from conversation
            taskDescription = this.parseSpecificRequirements(taskDescription, this.chatHistoryCache);
            
            // Only update if we have new information
            if (taskDescription || originalCode || proposedCode) {
                // Create context update object
                const contextUpdate = {
                    taskDescription: taskDescription,
                    originalCode: originalCode || this.lastExtractedContext.originalCode,
                    proposedCode: proposedCode || this.lastExtractedContext.proposedCode,
                    language: language || this.lastExtractedContext.language,
                    sourceType: 'chat', // Indicate this came from chat, not editor
                    timestamp: new Date().toISOString()
                };
                
                // Update central context manager
                contextManager.updateContext(contextUpdate);
                
                // Also keep local copy for backward compatibility
                this.lastExtractedContext = contextManager.getContext();
                
                Logger.info('Extracted context from Copilot Chat and updated context manager', 'copilot-chat');
                Logger.debug(`Task: ${taskDescription ? taskDescription.substring(0, 30) + '...' : 'none'} | Source: chat`, 'copilot-chat');
                
                // Show notification that we're using a chat query with view details option
                vscode.window.showInformationMessage(
                    'Using Copilot Chat query as task description',
                    'View Details'
                                ).then(selection => {
                    if (selection === 'View Details') {
                        this.showExtractedContext();
                    }
                });
                
                // Notify listeners
                this.notifyContextChange();
            }
        } catch (error) {
            Logger.error(`Error extracting context from chat: ${error.message}`, 'copilot-chat');
        } finally {
            this.pendingExtraction = false;
        }
    }
    
    /**
     * Manually extract chat context
     * @param {boolean} showNotification Show notification about the extraction
     */
    extractChatContext(showNotification = false) {
        this.extractContextFromChat(true);
        
        if (showNotification) {
            // Get the latest context from the context manager to ensure we have the most up-to-date information
            const currentContext = contextManager.getContext();
            const taskDescription = currentContext.taskDescription || 'No task description found';
            
            vscode.window.showInformationMessage(
                'Extracted context from Copilot Chat', 
                'View Details',
                'Edit Task'
            ).then(selection => {
                if (selection === 'View Details') {
                    this.showExtractedContext();
                } else if (selection === 'Edit Task') {
                    this.promptForTaskEdit(taskDescription);
                }
            });
        }
    }
    
    /**
     * Show the extracted context in a new editor
     */
    showExtractedContext() {
        try {
            // Get the latest context from the central context manager
            const context = contextManager.getContext();
            
            if (!context || !context.taskDescription) {
                vscode.window.showInformationMessage('No context has been extracted yet');
                return;
            }
            
            // Create a summary of the context for display
            const summary = {
                taskDescription: context.taskDescription,
                language: context.language,
                sourceType: context.sourceType,
                timestamp: context.timestamp,
                metadata: context.metadata || {},
                // Include snippet previews instead of full code to avoid overwhelming the display
                originalCodePreview: context.originalCode ? 
                    `${context.originalCode.substring(0, 100)}${context.originalCode.length > 100 ? '...' : ''}` : 
                    'None',
                proposedCodePreview: context.proposedCode ? 
                    `${context.proposedCode.substring(0, 100)}${context.proposedCode.length > 100 ? '...' : ''}` : 
                    'None'
            };
            
            // Create a nicely formatted JSON representation
            const content = JSON.stringify(summary, null, 2);
            
            // Create a new untitled document
            vscode.workspace.openTextDocument({ 
                content,
                language: 'json'
            }).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        } catch (error) {
            Logger.error(`Error showing extracted context: ${error.message}`, 'copilot-chat');
            vscode.window.showErrorMessage('Error showing extracted context');
        }
    }
    
    /**
     * Prompt the user to edit the task description
     * @param {string} currentDescription The current task description
     */
    promptForTaskEdit(currentDescription) {
        vscode.window.showInputBox({
            prompt: 'Edit the task description',
            value: currentDescription,
            placeHolder: 'Enter task description',
            validateInput: text => {
                return text.length > 0 ? null : 'Task description cannot be empty';
            }
        }).then(newDescription => {
            if (newDescription && newDescription !== currentDescription) {
                // Update the context with the user-edited task description
                // Use forceUpdate to override any existing task description, including from chat
                contextManager.updateContext({
                    taskDescription: newDescription,
                    sourceType: 'manual', // Indicate manual edit by user
                    forceUpdate: true // Force override regardless of source priority
                });
                
                Logger.info('Task description manually updated by user', 'copilot-chat');
                vscode.window.showInformationMessage('Task description updated successfully');
            }
        });
    }
    
    /**
     * Register a callback for when the chat context changes
     * @param {Function} callback The callback function
     */
    onContextChange(callback) {
        if (typeof callback === 'function') {
            this.chatChangeCallbacks.push(callback);
        }
    }
    
    /**
     * Notify all listeners of a context change
     */
    notifyContextChange() {
        // Get the latest context from the context manager
        const currentContext = contextManager.getContext();
        
        // Notify all registered callbacks with the current context
        for (const callback of this.chatChangeCallbacks) {
            try {
                callback(currentContext);
            } catch (error) {
                Logger.error(`Error in chat context change callback: ${error.message}`, 'copilot-chat');
            }
        }
    }
    
    /**
     * Get the last extracted context
     * @returns {Object} The latest context from the context manager
     */
    getExtractedContext() {
        return contextManager.getContext();
    }
    
    /**
     * Check if a string is likely to be application output rather than a user query
     * @param {string} text The text to check
     * @returns {boolean} Whether the text is likely application output
     */
    isLikelyApplicationOutput(text) {
        if (!text) return false;
        
        // Define patterns that suggest application output
        const applicationOutputPatterns = [
            // Stack traces
            /at\s+[\w.]+\s+\(.*:\d+:\d+\)/i,
            // Log lines with timestamps
            /^\[\d{2}:\d{2}:\d{2}\]/,
            // Error messages with file paths
            /Error: .* in .*\.(?:js|ts|py|java|cs)/i,
            // Long console output with many special characters
            /^.*?(?:\n.*?){10,}$/m && /[(){}\[\]<>|]/g.test(text) && text.length > 500,
            // Terminal command output patterns
            /^\$\s+.*\n(?:.*\n){3,}/m,
            // Build output
            /(?:Building|Compiling)\s+\d+\/\d+/i,
            // Test output patterns
            /(\d+)\s+(?:passing|failing|skipped)/i,
            // VS Code specific messages
            /Extension host|Window reload|Language server/i
        ];
        
        // Check if any pattern matches
        for (const pattern of applicationOutputPatterns) {
            if (pattern.test(text)) {
                return true;
            }
        }
        
        // Also check for excessively long text that doesn't look like a query
        if (text.length > 1000 && text.split('\n').length > 15) {
            // Long text with many lines - likely debug output
            return true;
        }
        
        // Check for common query indicators - if these are present, it's likely a user query
        const queryIndicators = [
            /(?:can|could) you/i,
            /(?:please|how to|write|generate|create|implement|update|fix|help|code for)/i,
            /(?:\?|function|class|method|component|module)/i
        ];
        
        // If short text (likely a query) contains query indicators, ensure we don't filter it out
        if (text.length < 500) {
            for (const indicator of queryIndicators) {
                if (indicator.test(text)) {
                    return false; // This is likely a user query, not application output
                }
            }
        }
        
        return false;
    }
    
    /**
     * Parse conversations to extract specific requirements and instructions
     * @param {string} basicTaskDescription The basic task description already extracted
     * @param {Array} chatHistory The full chat history
     * @returns {string} Enhanced task description with specific requirements
     */
    parseSpecificRequirements(basicTaskDescription, chatHistory) {
        if (!basicTaskDescription || !chatHistory || chatHistory.length === 0) {
            return basicTaskDescription;
        }
        
        try {
            // Start with the basic task description
            let enhancedDescription = basicTaskDescription;
            
            // Instruction patterns (common ways users request things)
            const instructionPatterns = [
                /(?:can|could) you (?:please )?(create|implement|add|fix|update|modify|refactor|optimize|improve) ([^?\.]+)/i,
                /(?:please |kindly )?(create|implement|add|fix|update|modify|refactor|optimize|improve) ([^?\.]+)/i,
                /(?:I need|I want|I'd like|I would like)(?: you)? to (create|implement|add|fix|update|modify|refactor|optimize|improve) ([^?\.]+)/i,
                /(?:Let's|We should|We need to) (create|implement|add|fix|update|modify|refactor|optimize|improve) ([^?\.]+)/i,
                /(?:How (?:can|do) I|How would I) (create|implement|add|fix|update|modify|refactor|optimize|improve) ([^?\.]+)/i
            ];
            
            // Requirement keywords (words that often indicate specific requirements)
            const requirementKeywords = [
                'must', 'should', 'needs to', 'has to', 'required', 'ensure', 'make sure',
                'important', 'critical', 'essential', 'necessary'
            ];
            
            // Collect all user messages
            const userMessages = chatHistory
                .filter(msg => msg.role === 'user')
                .map(msg => msg.content);
            
            // Extract specific instructions matching known patterns
            let extractedInstructions = [];
            
            for (const message of userMessages) {
                // Check against instruction patterns
                for (const pattern of instructionPatterns) {
                    const match = message.match(pattern);
                    if (match) {
                        const verb = match[1]; // The action verb (create, implement, etc.)
                        const what = match[2]; // What to do
                        extractedInstructions.push(`${verb} ${what}`);
                    }
                }
                
                // Look for sentences containing requirement keywords
                const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
                
                for (const sentence of sentences) {
                    for (const keyword of requirementKeywords) {
                        if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
                            extractedInstructions.push(sentence.trim());
                            break; // Only add the sentence once
                        }
                    }
                }
                
                // Try to identify issues to be fixed
                const issueMatches = message.match(/(?:bug|issue|problem|error|not working)(?:[:\-])? ([^.?!]+)/i);
                if (issueMatches) {
                    extractedInstructions.push(`Fix: ${issueMatches[1].trim()}`);
                }
            }
            
            // Build enhanced task description with clear sections
            if (extractedInstructions.length > 0) {
                // Start with original description
                // Add specific requirements section if we found any
                enhancedDescription += "\n\nSpecific Requirements:\n" + 
                    extractedInstructions.map((instr, i) => `${i+1}. ${instr}`).join('\n');
                
                // Clean up any double spaces or excessive newlines
                enhancedDescription = enhancedDescription
                    .replace(/\n{3,}/g, '\n\n')
                    .replace(/  +/g, ' ');
            }
            
            return enhancedDescription;
            
        } catch (error) {
            Logger.error(`Error parsing specific requirements: ${error.message}`, 'copilot-chat');
            // Fall back to basic task description in case of error
            return basicTaskDescription;
        }
    }
    
    /**
     * Handle context changes from the central context manager
     * @param {Object} updatedContext The updated context from context manager
     */
    handleContextChange(updatedContext) {
        // Only process updates that didn't originate from this component
        if (updatedContext.sourceType !== 'chat') {
            Logger.debug(`Received context update from ${updatedContext.sourceType || 'unknown'} source`, 'copilot-chat');
            
            // Update our local copy of the context
            this.lastExtractedContext = updatedContext;
            
            // We could use this context to enrich Copilot Chat interactions
            // For example, we might use the task description to provide better context for Chat
        }
    }
    
    /**
     * Clean up resources when extension is deactivated
     */
    dispose() {
        // Unregister from context manager to prevent memory leaks
        if (this.contextChangeUnsubscribe) {
            this.contextChangeUnsubscribe();
            this.contextChangeUnsubscribe = null;
        }
        
        // Clear any pending timers
        if (this.extractionDebounceTimer) {
            clearTimeout(this.extractionDebounceTimer);
            this.extractionDebounceTimer = null;
        }
        
        // Clear caches to free memory
        this.chatHistoryCache = [];
        this.suggestionCache.clear();
        
        Logger.info('CopilotChatIntegration disposed', 'copilot-chat');
    }
}

module.exports = CopilotChatIntegration;
