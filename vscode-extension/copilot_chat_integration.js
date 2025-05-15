/**
 * Copilot Chat Integration for AI Development Monitor
 * 
 * This module handles integration with GitHub Copilot Chat to capture conversations
 * and extract relevant information for code evaluation.
 */
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Logger = require('./logger');
const contextManager = require('./context_manager');
const { execSync } = require('child_process');

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
        this.autoCaptureChatHistory = vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoCaptureChatHistory', true);
        this.autoRunTestsOnSuggestions = vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoRunTestsOnSuggestions', true);
        
        // Listen for configuration changes
        this.configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aiDevelopmentMonitor.autoCaptureChatHistory')) {
                this.autoCaptureChatHistory = vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoCaptureChatHistory', true);
                Logger.info(`Auto-capture chat history setting changed to: ${this.autoCaptureChatHistory}`, 'copilot-chat');
            }
            
            if (e.affectsConfiguration('aiDevelopmentMonitor.autoRunTestsOnSuggestions')) {
                this.autoRunTestsOnSuggestions = vscode.workspace.getConfiguration('aiDevelopmentMonitor').get('autoRunTestsOnSuggestions', true);
                Logger.info(`Auto-run tests on suggestions setting changed to: ${this.autoRunTestsOnSuggestions}`, 'copilot-chat');
            }
        });
        
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
        
        // Command to send "Continue" to Copilot Chat
        vscode.commands.registerCommand('aiDevelopmentMonitor.copilotChatContinue', () => {
            this.sendContinue(true);
        });
        
        // Command to request changes from Copilot Chat
        vscode.commands.registerCommand('aiDevelopmentMonitor.copilotChatRequestChanges', async () => {
            // Prompt the user for specific feedback
            const feedback = await vscode.window.showInputBox({
                placeHolder: "Enter specific feedback (optional)",
                prompt: "What changes would you like to request?"
            });
            
            // Send the request changes message
            this.requestChanges(feedback || "", true);
        });
    }
    
    /**
     * Track a webview that might be Copilot Chat
     * @param {vscode.Webview} webview The webview to track
     */
    trackChatWebview(webview) {
        try {
            this.logWebviewCommunication('initialization', 'attempt', 'Setting up tracking for potential Copilot Chat webview');
            
            // Create a message listener with improved error handling
            const messageListener = webview.onDidReceiveMessage(message => {
                try {
                    this.logWebviewCommunication('message-received', 'success', message);
                    
                    if (this.isCopilotChatMessage(message)) {
                        this.processChatMessage(message);
                    } else {
                        this.logWebviewCommunication('message-processing', 'skipped', 'Non-Copilot message ignored');
                    }
                } catch (error) {
                    this.logWebviewCommunication('message-processing', 'failed', message, error);
                }
            });
            
            // Store the listener so we can dispose it later
            if (!this.webviewListeners) {
                this.webviewListeners = [];
            }
            this.webviewListeners.push(messageListener);
            
            // Set up state checking to verify the connection is still alive
            this.webviewConnectionTimeout = setTimeout(() => {
                this.checkWebviewConnection(webview);
            }, 5000);
            
            // Inject custom script to capture chat content
            this.injectChatCaptureScript(webview);
            
            // Send a ping to test the connection
            try {
                webview.postMessage({ type: 'ai-dev-monitor-ping' });
                this.logWebviewCommunication('ping', 'attempt', 'Sent ping to test connection');
            } catch (error) {
                this.logWebviewCommunication('ping', 'failed', null, error);
            }
            
            this.logWebviewCommunication('initialization', 'success', 'Webview tracking set up successfully');
        } catch (error) {
            this.logWebviewCommunication('initialization', 'failed', null, error);
        }
    }
    
    /**
     * Inject a script to capture chat content
     * @param {vscode.Webview} webview The webview to inject into
     */
    injectChatCaptureScript(webview) {
        try {
            Logger.info('Setting up communication with Copilot Chat webview', 'copilot-chat');
            
            // Set up proper message handling for the webview
            webview.onDidReceiveMessage(message => {
                Logger.debug(`Received message from Copilot Chat webview: ${JSON.stringify(message)}`, 'copilot-chat');
                this.processChatMessage(message);
            });
            
            // Create a proper extension-to-webview communication channel
            // This uses VS Code's supported mechanism for webview communication
            const extensionId = 'local-publisher.ai-development-monitor';
            
            // Create the content to inject - using VS Code's supported postMessage mechanism
            const script = `
                // Only execute in GitHub Copilot Chat webview
                if (document.querySelector('.chat-content') || 
                    document.querySelector('.copilot-chat-history')) {
                    
                    console.log('[AI Dev Monitor] Chat capture script initialized');
                    
                    // Create a utility function to safely extract chat content
                    function extractChatContent() {
                        try {
                            const chatContent = document.querySelector('.chat-content') || 
                                              document.querySelector('.copilot-chat-history');
                            
                            if (!chatContent) return null;
                            
                            const chatMessages = Array.from(
                                chatContent.querySelectorAll('.message, .chat-entry')
                            );
                            
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
                            
                            return extractedChat;
                        } catch (error) {
                            console.error('[AI Dev Monitor] Error extracting chat content:', error);
                            return null;
                        }
                    }
                    
                    // Set up the observer using a more robust approach
                    const observer = new MutationObserver((mutations) => {
                        // Extract content only when we observe actual changes
                        const extractedChat = extractChatContent();
                        if (extractedChat && extractedChat.length > 0) {
                            // Use the VS Code webview API's postMessage
                            // This is the officially supported way to communicate from webview to extension
                            const vscode = acquireVsCodeApi();
                            vscode.postMessage({
                                type: 'ai-dev-monitor-chat-extract',
                                chatHistory: extractedChat,
                                timestamp: new Date().toISOString()
                            });
                        }
                    });
                    
                    // Configure a more efficient observer
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                        characterData: false // Reduce overhead by not observing text changes
                    });
                    
                    // Do an initial extraction
                    setTimeout(() => {
                        const extractedChat = extractChatContent();
                        if (extractedChat && extractedChat.length > 0) {
                            try {
                                const vscode = acquireVsCodeApi();
                                vscode.postMessage({
                                    type: 'ai-dev-monitor-chat-extract',
                                    chatHistory: extractedChat,
                                    timestamp: new Date().toISOString()
                                });
                                console.log('[AI Dev Monitor] Initial chat content extracted');
                            } catch (error) {
                                console.error('[AI Dev Monitor] Error sending initial extraction:', error);
                            }
                        }
                    }, 1500); // Give a bit more time for the chat to initialize
                    
                    // Add error handling
                    window.addEventListener('error', (event) => {
                        console.error('[AI Dev Monitor] Error in chat capture script:', event.error);
                    });
                }
            `;
            
            // Only attempt to modify the HTML if we have access to it
            if (webview.html) {
                // Try to inject our script safely
                if (webview.html.includes('</body>')) {
                    webview.html = webview.html.replace('</body>', `<script>${script}</script></body>`);
                    Logger.info('Successfully injected chat capture script', 'copilot-chat');
                } else {
                    Logger.warn('Could not find </body> tag to inject script', 'copilot-chat');
                }
            } else {
                Logger.warn('No access to webview HTML content', 'copilot-chat');
                // Consider using a message-based approach to request content instead
            }
            
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
            // Add basic message validation
            if (!message) {
                Logger.warn('Received empty message from Copilot Chat', 'copilot-chat');
                return;
            }
            
            // Handle ping responses to verify connection is alive
            if (message.type === 'ai-dev-monitor-pong') {
                this.webviewConnectionAlive = true;
                Logger.debug('Received pong from Copilot Chat webview', 'copilot-chat');
                return;
            }
            
            // Check if this is our custom extraction message
            if (message.type === 'ai-dev-monitor-chat-extract') {
                // Validate the chat history structure
                if (!message.chatHistory || !Array.isArray(message.chatHistory)) {
                    Logger.warn('Received malformed chat history', 'copilot-chat');
                    return;
                }
                
                // Log receipt of chat history with timestamp
                Logger.info(`Captured ${message.chatHistory.length} chat messages at ${message.timestamp || 'unknown time'}`, 'copilot-chat');
                
                // Filter out empty messages and ensure required properties
                const validMessages = message.chatHistory.filter(msg => 
                    msg && msg.role && (msg.content || (msg.codeBlocks && msg.codeBlocks.length))
                );
                
                if (validMessages.length !== message.chatHistory.length) {
                    Logger.debug(`Filtered out ${message.chatHistory.length - validMessages.length} invalid messages`, 'copilot-chat');
                }
                
                this.chatHistoryCache = validMessages;
                
                // Only extract if we actually have valid messages
                if (this.chatHistoryCache.length > 0) {
                    this.extractContextFromChat();
                }
                
                return;
            }
            
            // Handle regular Copilot Chat messages
            if (message.command === 'chatResponse' || message.kind === 'chat') {
                const content = message.text || message.content || '';
                
                if (!content) {
                    Logger.debug('Received empty chat content, ignoring', 'copilot-chat');
                    return;
                }
                
                // Log receipt of chat message
                Logger.debug(`Received chat message: ${content.substring(0, 50)}...`, 'copilot-chat');
                
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
                
                // Process any new context - auto-extract if enabled
                if (this.autoCaptureChatHistory) {
                    this.debouncedExtractContext(true);
                    Logger.debug('Auto-capturing chat history enabled, extracting context', 'copilot-chat');
                    
                    // Execute tests on code blocks if enabled and the message is from the assistant
                    if (this.autoRunTestsOnSuggestions && !message.isUser && codeBlocks.length > 0) {
                        // Get the current task context
                        const currentContext = contextManager.getContext();
                        const taskDescription = currentContext?.task?.description || '';
                        
                        // Run tests on each code block
                        codeBlocks.forEach(async (codeBlock, index) => {
                            if (codeBlock.language && codeBlock.content && codeBlock.content.length > 10) {
                                try {
                                    Logger.info(`Running tests on code suggestion #${index+1}`, 'copilot-chat');
                                    
                                    // Execute tests on this suggestion
                                    const testResults = await this.runTestsOnSuggestion(codeBlock, codeBlock.language, taskDescription);
                                    
                                    // Update TDD dashboard with execution results if available
                                    if (testResults) {
                                        // Use extension module to update TDD dashboard
                                        const { TDDExtension } = require('./tdd_extension');
                                        TDDExtension.updateTDDDashboard(
                                            {
                                                total: testResults.total_tests || 0,
                                                passed: testResults.passed_tests || 0,
                                                failed: testResults.failed_tests || 0,
                                                success: testResults.success || false,
                                                output: testResults.output || ''
                                            },
                                            testResults.test_code || '',
                                            codeBlock.content,
                                            1, // Start with iteration 1 for Copilot suggestions
                                            codeBlock.language,
                                            testResults
                                        );
                                        
                                        // Also send to AI Monitor Panel for display in the TDD Dashboard
                                        const AIMonitorPanel = require('./ai_monitor_panel');
                                        if (AIMonitorPanel.currentPanel) {
                                            // Create a GitHub Copilot specific evaluation object
                                            const copilotEvaluation = {
                                                github_copilot_execution: {
                                                    ...testResults,
                                                    implementation_code: codeBlock.content,
                                                    language: codeBlock.language,
                                                    source: 'github-copilot-chat',
                                                    timestamp: new Date().toISOString()
                                                }
                                            };
                                            
                                            // Update the panel with the test execution results
                                            AIMonitorPanel.currentPanel.setEvaluationResults(copilotEvaluation);
                                            
                                            Logger.info(`Displayed GitHub Copilot test execution results in TDD Dashboard: ${testResults.passed_tests}/${testResults.total_tests} tests passed`, 'copilot-chat');
                                        }
                                    }
                                } catch (testError) {
                                    Logger.error(`Error executing tests on suggestion: ${testError.message}`, 'copilot-chat');
                                }
                            }
                        });
                    }
                } else {
                    Logger.debug('Auto-capturing chat history disabled, skipping extraction', 'copilot-chat');
                }
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
     * Extract context from the current chat history via a debounced function
     * This prevents multiple extractions from happening in rapid succession
     * @param {boolean} showNotification Whether to show a notification about the extraction
     */
    debouncedExtractContext(showNotification = false) {
        if (this.extractionDebounceTimer) {
            clearTimeout(this.extractionDebounceTimer);
        }
        
        this.extractionDebounceTimer = setTimeout(() => {
            if (!this.pendingExtraction) {
                const result = this.extractContextFromChat();
                
                // Show a subtle notification if auto-capture is enabled and we have a result
                if (this.autoCaptureChatHistory && result && showNotification) {
                    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
                    const notificationLevel = config.get('notificationLevel', 'normal');
                    
                    // Only show notifications if not in minimal mode
                    if (notificationLevel !== 'minimal') {
                        vscode.window.setStatusBarMessage('$(telescope) AI Monitor: Captured Copilot Chat', 3000);
                    }
                }
            }
        }, 1000); // Wait 1 second after the last call
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
     * Check if the webview connection is still alive
     * @param {vscode.Webview} webview The webview to check
     */
    checkWebviewConnection(webview) {
        try {
            // Clear existing timeout
            if (this.webviewConnectionTimeout) {
                clearTimeout(this.webviewConnectionTimeout);
                this.webviewConnectionTimeout = null;
            }
            
            // Try to ping the webview
            try {
                const pingData = { 
                    type: 'ai-dev-monitor-ping', 
                    timestamp: new Date().toISOString() 
                };
                
                webview.postMessage(pingData);
                this.logWebviewCommunication('connection-check', 'attempt', pingData);
                
                // Set up the next check
                this.webviewConnectionTimeout = setTimeout(() => {
                    this.checkWebviewConnection(webview);
                }, 30000); // Check every 30 seconds
            } catch (error) {
                this.logWebviewCommunication('connection-check', 'failed', 'Webview connection appears to be broken', error);
                // The webview might have been disposed, so we'll stop checking
                this.webviewConnectionAlive = false;
            }
        } catch (error) {
            this.logWebviewCommunication('connection-check-setup', 'failed', null, error);
        }
    }
    
    /**
     * Log webview communication events with consistent formatting
     * @param {string} action The communication action being performed
     * @param {string} status The status of the action (success, failure, attempt)
     * @param {any} data Optional data related to the communication
     * @param {Error} error Optional error object if the action failed
     */
    logWebviewCommunication(action, status, data = null, error = null) {
        const timestamp = new Date().toISOString();
        
        // Base message includes the action and status
        let message = `WebView ${action} - ${status}`;
        
        // Add optional data summary if provided
        if (data) {
            let dataSummary = '';
            if (typeof data === 'string') {
                dataSummary = data.length > 50 ? `${data.substring(0, 50)}...` : data;
            } else if (typeof data === 'object') {
                try {
                    const jsonStr = JSON.stringify(data);
                    dataSummary = jsonStr.length > 50 ? `${jsonStr.substring(0, 50)}...` : jsonStr;
                } catch (jsonError) {
                    dataSummary = `[Object of type ${data.constructor.name}]`;
                }
            } else {
                dataSummary = String(data);
            }
            message += ` - ${dataSummary}`;
        }
        
        // Add error details if provided
        if (error) {
            message += ` - Error: ${error.message}`;
            
            // Log at error or warning level based on status
            if (status === 'failed') {
                Logger.error(message, 'copilot-chat-webview');
                // Log stack trace at debug level
                Logger.debug(`Stack trace: ${error.stack}`, 'copilot-chat-webview');
            } else {
                Logger.warn(message, 'copilot-chat-webview');
            }
        } else {
            // No error, use appropriate log level based on status
            if (status === 'success') {
                Logger.info(message, 'copilot-chat-webview');
            } else if (status === 'attempt') {
                Logger.debug(message, 'copilot-chat-webview');
            } else {
                Logger.warn(message, 'copilot-chat-webview');
            }
        }
        
        // Also add to diagnostic information for later troubleshooting
        if (!this.webviewCommunicationLog) {
            this.webviewCommunicationLog = [];
        }
        
        // Keep a limited history of communication logs
        this.webviewCommunicationLog.push({
            timestamp,
            action,
            status,
            data: data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null,
            error: error ? error.message : null
        });
        
        // Trim log if it gets too large
        if (this.webviewCommunicationLog.length > 100) {
            this.webviewCommunicationLog.shift();
        }
    }
    
    /**
     * Clean up resources when extension is deactivated
     */
    dispose() {
        Logger.info('Disposing CopilotChatIntegration resources', 'copilot-chat');
        
        // Unregister from context manager to prevent memory leaks
        if (this.contextChangeUnsubscribe) {
            this.contextChangeUnsubscribe();
            this.contextChangeUnsubscribe = null;
            Logger.debug('Unregistered from context manager', 'copilot-chat');
        }
        
        // Dispose configuration change listener
        if (this.configChangeListener) {
            this.configChangeListener.dispose();
            this.configChangeListener = null;
            Logger.debug('Disposed configuration change listener', 'copilot-chat');
        }
        
        // Clean up all webview-related listeners
        if (this.webviewListeners && this.webviewListeners.length > 0) {
            Logger.debug(`Disposing ${this.webviewListeners.length} webview listeners`, 'copilot-chat');
            this.webviewListeners.forEach(listener => {
                try {
                    listener.dispose();
                } catch (error) {
                    Logger.warn(`Error disposing webview listener: ${error.message}`, 'copilot-chat');
                }
            });
            this.webviewListeners = [];
        }
        
        // Clear webview connection timeout
        if (this.webviewConnectionTimeout) {
            clearTimeout(this.webviewConnectionTimeout);
            this.webviewConnectionTimeout = null;
            Logger.debug('Cleared webview connection timeout', 'copilot-chat');
        }
        
        // Clear extraction debounce timer
        if (this.extractionDebounceTimer) {
            clearTimeout(this.extractionDebounceTimer);
            this.extractionDebounceTimer = null;
            Logger.debug('Cleared extraction debounce timer', 'copilot-chat');
        }
        
        // Clear message caches to free memory
        const chatHistorySize = this.chatHistoryCache ? this.chatHistoryCache.length : 0;
        const suggestionCacheSize = this.suggestionCache ? this.suggestionCache.size : 0;
        
        this.chatHistoryCache = [];
        if (this.suggestionCache) {
            this.suggestionCache.clear();
        }
        
        Logger.info(`Cleared chat history (${chatHistorySize} items) and suggestion cache (${suggestionCacheSize} items)`, 'copilot-chat');
        Logger.info('CopilotChatIntegration resources successfully disposed', 'copilot-chat');
    }

    /**
     * Send a message to GitHub Copilot Chat
     * @param {string} message - The message to send
     * @param {boolean} showNotification - Whether to show a notification about the action
     * @returns {Promise<boolean>} Whether the message was sent successfully
     */
    async sendMessageToChat(message, showNotification = false) {
        try {
            if (!this.isAvailable) {
                Logger.warn('Cannot send message: GitHub Copilot Chat is not available', 'copilot-chat');
                if (showNotification) {
                    vscode.window.showWarningMessage('GitHub Copilot Chat is not available. Please install and activate the extension.');
                }
                return false;
            }

            // First check if the chat panel is already open
            let chatPanelOpen = false;
            try {
                // Try to execute a chat-specific command to see if panel is open
                chatPanelOpen = await vscode.commands.executeCommand('github.copilot.chat.focus');
            } catch (e) {
                // If command fails, panel is not open
                chatPanelOpen = false;
            }
            
            // If panel is not open, try to open a new chat
            if (!chatPanelOpen) {
                try {
                    await vscode.commands.executeCommand('github.copilot.chat.start');
                    // Wait a bit longer for the new panel to initialize
                    await new Promise(resolve => setTimeout(resolve, 800));
                } catch (e) {
                    Logger.warn('Failed to open Copilot Chat panel', 'copilot-chat');
                    // Try to focus the panel again as a fallback
                    await vscode.commands.executeCommand('github.copilot.chat.focus');
                }
            }
            
            // Wait a moment for the panel to become active
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Use clipboard to temporarily store the message
            await vscode.env.clipboard.writeText(message);
            
            // Simulate keyboard input by pasting the message
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            
            // Add a small delay before sending
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Press enter to send the message
            await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: '\u000D' }); // Carriage return
            
            if (showNotification) {
                vscode.window.showInformationMessage(`Sent to Copilot Chat: ${message}`);
            }
            
            Logger.info(`Message sent to GitHub Copilot Chat: ${message}`, 'copilot-chat');
            return true;
        } catch (error) {
            Logger.error(`Error sending message to GitHub Copilot Chat: ${error.message}`, error, 'copilot-chat');
            if (showNotification) {
                vscode.window.showErrorMessage(`Failed to send message to GitHub Copilot Chat: ${error.message}`);
            }
            return false;
        }
    }
    
    /**
     * Send a "continue" message to GitHub Copilot Chat
     * @param {boolean} showNotification - Whether to show a notification
     * @returns {Promise<boolean>} Whether the message was sent successfully
     */
    async sendContinue(showNotification = true) {
        return await this.sendMessageToChat("Continue", showNotification);
    }
    
    /**
     * Send a "request changes" message to GitHub Copilot Chat
     * @param {string} feedback - Optional specific feedback to include
     * @param {boolean} showNotification - Whether to show a notification
     * @returns {Promise<boolean>} Whether the message was sent successfully
     */
    async requestChanges(feedback = "", showNotification = true) {
        let message = "Please make the following changes:";
        if (feedback) {
            message += " " + feedback;
        }
        return await this.sendMessageToChat(message, showNotification);
    }

    /**
     * Execute tests on a code suggestion from Copilot Chat
     * 
     * @param {Object} codeBlock The code block from Copilot Chat containing the suggestion
     * @param {string} language The detected language of the code
     * @param {string} taskDescription The description of the task being solved
     * @returns {Promise<Object|null>} The test execution results or null if tests couldn't be run
     */
    async runTestsOnSuggestion(codeBlock, language, taskDescription = '') {
        if (!this.autoRunTestsOnSuggestions || !codeBlock || !codeBlock.content) {
            return null;
        }
        
        try {
            Logger.info(`Running tests on Copilot suggestion (${language})`, 'copilot-chat');
            
            // Prepare the test execution request
            const testExecutionRequest = {
                implementation_code: codeBlock.content,
                language: language || codeBlock.language || 'javascript',
                task_description: taskDescription,
                iteration: 1, // Start with iteration 1 for Copilot suggestions
            };
            
            // Get existing test code if any is found in the context
            const existingContext = contextManager.getContext();
            if (existingContext && existingContext.tdd && existingContext.tdd.testCode) {
                testExecutionRequest.test_code = existingContext.tdd.testCode;
            } else {
                // Generate a basic test template using the task description
                testExecutionRequest.generate_test = true;
            }
            
            // Call the test execution endpoint in Python backend
            const tempFile = path.join(os.tmpdir(), `copilot-test-${Date.now()}.json`);
            
            // Write the request to a temp file
            fs.writeFileSync(tempFile, JSON.stringify(testExecutionRequest, null, 2));
            
            // Call the Python script to execute tests
            const pythonInterpreter = this.getPythonInterpreter();
            const agentDir = contextManager.getAgentDirectory();
            const scriptPath = path.join(agentDir, 'examples', 'run_test_execution.py');
            
            const command = `"${pythonInterpreter}" "${scriptPath}" "${tempFile}"`;
            Logger.debug(`Executing command: ${command}`, 'copilot-chat');
            
            // Execute the test script
            const output = execSync(command, { encoding: 'utf-8' });
            
            // Parse the results
            let testExecution = null;
            try {
                const results = JSON.parse(output);
                testExecution = results;
                Logger.info(`Tests completed: ${results.passed_tests}/${results.total_tests} passed`, 'copilot-chat');
            } catch (parseError) {
                Logger.error(`Error parsing test execution results: ${parseError}`, 'copilot-chat');
                return null;
            }
            
            // Clean up temp file
            try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }
            
            return testExecution;
            
        } catch (error) {
            Logger.error(`Error running tests on suggestion: ${error.message}`, 'copilot-chat');
            return null;
        }
    }
    
    /**
     * Get Python interpreter path
     * @returns {string} Path to Python interpreter
     */
    getPythonInterpreter() {
        // Try to get Python path from configuration
        const pythonPath = vscode.workspace.getConfiguration('python').get('defaultInterpreterPath');
        if (pythonPath && fs.existsSync(pythonPath)) {
            return pythonPath;
        }
        
        // Fallback to system Python
        return process.platform === 'win32' ? 'python.exe' : 'python3';
    }
}

module.exports = CopilotChatIntegration;
