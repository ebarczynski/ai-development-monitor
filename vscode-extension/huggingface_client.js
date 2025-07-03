// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

/**
 * Hugging Face API Client for AI Development Monitor
 * 
 * This module provides integration with Hugging Face API-hosted models as an alternative
 * to local Ollama LLM for code evaluation and test generation.
 */
const vscode = require('vscode');
const axios = require('axios');
const Logger = require('./logger');

class HuggingFaceClient {
    constructor() {
        this.apiKey = null;
        this.model = null;
        this.apiBaseUrl = 'https://api-inference.huggingface.co/models/';
        this.isConfigured = false;
        this.requestQueue = [];
        this.processingQueue = false;
        this.rateLimitDelay = 1000; // Milliseconds between API calls to respect rate limits
        this.cache = new Map(); // Simple cache to avoid duplicate requests
        this.cacheEnabled = true;
        
        // Load configuration
        this.loadConfiguration();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aiDevelopmentMonitor.huggingFace')) {
                Logger.info('Hugging Face API configuration changed, reloading...', 'huggingface');
                this.loadConfiguration();
            }
        });
    }
    
    /**
     * Load configuration from VS Code settings
     */
    loadConfiguration() {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor.huggingFace');
        this.apiKey = config.get('apiKey', '');
        this.model = config.get('defaultModel', 'microsoft/codebert-base');
        this.cacheEnabled = config.get('enableResponseCaching', true);
        
        // Check if we have the minimum required configuration
        this.isConfigured = this.apiKey && this.apiKey.trim().length > 0;
        
        if (!this.isConfigured) {
            Logger.warn('Hugging Face API is not configured. Please set your API key in settings.', 'huggingface');
        } else {
            Logger.info(`Hugging Face API configured with model: ${this.model}`, 'huggingface');
        }
    }
    
    /**
     * Check if the client is properly configured
     */
    isReady() {
        return this.isConfigured;
    }
    
    /**
     * Process a request through the Hugging Face API
     * @param {Object} requestData - The data to send to the model
     * @param {string} requestType - The type of request (e.g., 'evaluation', 'test-generation')
     * @returns {Promise<Object>} - The model response
     */
    async processRequest(requestData, requestType) {
        if (!this.isConfigured) {
            throw new Error('Hugging Face API is not configured. Please set your API key in settings.');
        }
        
        // Generate a simple hash for the request to use as cache key
        const requestHash = this.generateRequestHash(requestData, requestType);
        
        // Check cache if enabled
        if (this.cacheEnabled && this.cache.has(requestHash)) {
            Logger.debug('Using cached response for Hugging Face API request', 'huggingface');
            return this.cache.get(requestHash);
        }
        
        try {
            // Add request to queue and process
            return await this.queueRequest(requestData, requestType, requestHash);
        } catch (error) {
            Logger.error('Error processing Hugging Face API request:', error, 'huggingface');
            throw error;
        }
    }
    
    /**
     * Queue a request to respect rate limits
     */
    async queueRequest(requestData, requestType, cacheKey) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                requestData,
                requestType,
                cacheKey,
                resolve,
                reject
            });
            
            if (!this.processingQueue) {
                this.processQueue();
            }
        });
    }
    
    /**
     * Process the queue of requests
     */
    async processQueue() {
        if (this.requestQueue.length === 0) {
            this.processingQueue = false;
            return;
        }
        
        this.processingQueue = true;
        const request = this.requestQueue.shift();
        
        try {
            const response = await this.makeApiRequest(request.requestData, request.requestType);
            
            // Cache the response if enabled
            if (this.cacheEnabled) {
                this.cache.set(request.cacheKey, response);
                
                // Limit cache size
                if (this.cache.size > 100) { // Arbitrary limit to prevent memory issues
                    // Remove oldest entry
                    const firstKey = this.cache.keys().next().value;
                    this.cache.delete(firstKey);
                }
            }
            
            request.resolve(response);
        } catch (error) {
            request.reject(error);
        }
        
        // Wait before processing next request to respect rate limits
        setTimeout(() => {
            this.processQueue();
        }, this.rateLimitDelay);
    }
    
    /**
     * Make an API request to Hugging Face
     */
    async makeApiRequest(requestData, requestType) {
        const modelUrl = `${this.apiBaseUrl}${this.model}`;
        
        // Format the request data based on the request type
        // Different request types might need different formatting
        const formattedData = this.formatRequestData(requestData, requestType);
        
        try {
            Logger.debug(`Making Hugging Face API request to ${this.model}`, 'huggingface');
            
            const response = await axios.post(modelUrl, formattedData, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 seconds timeout
            });
            
            return this.formatResponse(response.data, requestType);
        } catch (error) {
            // Handle specific API errors
            if (error.response) {
                const statusCode = error.response.status;
                
                if (statusCode === 429) {
                    Logger.warn('Hugging Face API rate limit exceeded. Retrying after delay.', 'huggingface');
                    // Increase the delay for future requests
                    this.rateLimitDelay = Math.min(this.rateLimitDelay * 1.5, 10000); // Max 10 seconds
                    throw new Error('Rate limit exceeded. Please try again later.');
                }
                
                Logger.error(`Hugging Face API error (${statusCode}):`, error.response.data, 'huggingface');
                throw new Error(`API error: ${error.response.data.error || 'Unknown error'}`);
            }
            
            Logger.error('Hugging Face API request failed:', error, 'huggingface');
            throw error;
        }
    }
    
    /**
     * Format the request data based on the request type
     */
    formatRequestData(data, requestType) {
        switch (requestType) {
            case 'evaluation':
                return {
                    inputs: {
                        original_code: data.originalCode,
                        proposed_changes: data.proposedChanges,
                        task_description: data.taskDescription || 'Evaluate code quality'
                    }
                };
                
            case 'test-generation':
                return {
                    inputs: {
                        code: data.code,
                        language: data.language,
                        iteration: data.iteration || 1,
                        task_description: data.taskDescription || 'Generate tests for code'
                    }
                };
                
            default:
                return { inputs: data };
        }
    }
    
    /**
     * Format the API response based on request type
     */
    formatResponse(responseData, requestType) {
        // Format the response to match the expected format for the given request type
        // This ensures compatibility with the rest of the system
        
        switch (requestType) {
            case 'evaluation':
                // Format to match the evaluation response expected by the extension
                return {
                    evaluation: responseData[0]?.generated_text || responseData,
                    score: this.extractScoreFromResponse(responseData),
                    provider: 'huggingface',
                    model: this.model
                };
                
            case 'test-generation':
                // Format to match the test generation response expected by the extension
                return {
                    test_code: responseData[0]?.generated_text || responseData,
                    provider: 'huggingface',
                    model: this.model
                };
                
            default:
                return responseData;
        }
    }
    
    /**
     * Extract a numeric score from the evaluation response
     */
    extractScoreFromResponse(response) {
        try {
            // Attempt to extract a score (0-1) from the response
            // This will depend on the specific model output format
            const text = response[0]?.generated_text || JSON.stringify(response);
            
            // Look for patterns like "score: 0.85" or "rating: 8.5/10"
            const scoreMatch = text.match(/score:\s*(\d+\.\d+)/i) || 
                               text.match(/rating:\s*(\d+\.?\d*)\/10/i);
                               
            if (scoreMatch && scoreMatch[1]) {
                let score = parseFloat(scoreMatch[1]);
                
                // Normalize to 0-1 range if necessary
                if (scoreMatch[0].includes('/10')) {
                    score = score / 10;
                }
                
                return Math.max(0, Math.min(1, score)); // Clamp between 0 and 1
            }
            
            // Default score if we can't extract one
            return 0.5;
        } catch (error) {
            Logger.warn('Error extracting score from Hugging Face response', 'huggingface');
            return 0.5; // Default middle score
        }
    }
    
    /**
     * Generate a simple hash for request caching
     */
    generateRequestHash(data, type) {
        try {
            const stringData = JSON.stringify(data);
            return `${type}-${stringData.length}-${stringData.substring(0, 100)}`;
        } catch (error) {
            return `${type}-${Date.now()}`;
        }
    }
    
    /**
     * Clear the response cache
     */
    clearCache() {
        this.cache.clear();
        Logger.info('Hugging Face API response cache cleared', 'huggingface');
    }
}

module.exports = HuggingFaceClient;
