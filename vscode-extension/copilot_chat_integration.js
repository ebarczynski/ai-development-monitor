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
            
            // If we find a task description, add it to our context
            if (taskDescription) {
                this.lastExtractedContext.taskDescription = taskDescription;
                this.lastExtractedContext.language = language;
                this.lastExtractedContext.code = text;
                
                Logger.debug(`Extracted task description from editor: ${taskDescription.substring(0, 50)}...`, 'copilot-chat');
                
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
            
            // Process chat history to extract context
            for (let i = 0; i < this.chatHistoryCache.length; i++) {
                const message = this.chatHistoryCache[i];
                
                // Check for task description in user messages
                if (message.role === 'user') {
                    // If no task description yet, use this message
                    if (!taskDescription) {
                        taskDescription = message.content;
                    }
                    
                    // Check for code in the message that might be original code
                    if (message.codeBlocks && message.codeBlocks.length > 0) {
                        const codeBlock = message.codeBlocks[0];
                        originalCode = codeBlock.content;
                        language = codeBlock.language;
                    }
                } 
                // Check for proposed code in assistant messages
                else if (message.role === 'assistant') {
                    // Get the last code block from the assistant as the proposed code
                    if (message.codeBlocks && message.codeBlocks.length > 0) {
                        const codeBlock = message.codeBlocks[message.codeBlocks.length - 1];
                        proposedCode = codeBlock.content;
                        
                        // If we don't have a language yet, use this one
                        if (!language) {
                            language = codeBlock.language;
                        }
                    }
                }
            }
            
            // Only update if we have new information
            if (taskDescription || originalCode || proposedCode) {
                this.lastExtractedContext = {
                    taskDescription: taskDescription || this.lastExtractedContext.taskDescription,
                    originalCode: originalCode || this.lastExtractedContext.originalCode,
                    proposedCode: proposedCode || this.lastExtractedContext.proposedCode,
                    language: language || this.lastExtractedContext.language,
                    timestamp: new Date().toISOString()
                };
                
                Logger.info('Extracted context from Copilot Chat', 'copilot-chat');
                Logger.debug(`Task: ${taskDescription.substring(0, 30)}... | Original: ${originalCode.length} chars | Proposed: ${proposedCode.length} chars`, 'copilot-chat');
                
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
            vscode.window.showInformationMessage('Extracted context from Copilot Chat');
        }
    }
    
    /**
     * Show the extracted context in a new editor
     */
    showExtractedContext() {
        try {
            const context = this.lastExtractedContext;
            
            if (!context || !context.taskDescription) {
                vscode.window.showInformationMessage('No context has been extracted from Copilot Chat yet');
                return;
            }
            
            // Create a JSON representation
            const content = JSON.stringify(context, null, 2);
            
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
        for (const callback of this.chatChangeCallbacks) {
            try {
                callback(this.lastExtractedContext);
            } catch (error) {
                Logger.error(`Error in chat context change callback: ${error.message}`, 'copilot-chat');
            }
        }
    }
    
    /**
     * Get the last extracted context
     * @returns {Object} The last extracted context
     */
    getExtractedContext() {
        return this.lastExtractedContext;
    }
}

module.exports = CopilotChatIntegration;
