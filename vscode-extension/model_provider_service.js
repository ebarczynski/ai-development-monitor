// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Edwin Barczyński

/**
 * Model Provider Service for AI Development Monitor
 * 
 * This module provides an abstraction layer for different model providers
 * to allow seamless switching between local Ollama LLM and Hugging Face API.
 */
const vscode = require('vscode');
const Logger = require('./logger');
const HuggingFaceClient = require('./huggingface_client');

class ModelProviderService {
    constructor() {
        this.currentProvider = null;
        this.huggingFaceClient = new HuggingFaceClient();
        
        // Load configuration
        this.loadConfiguration();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('aiDevelopmentMonitor.modelProvider')) {
                Logger.info('Model provider configuration changed, reloading...', 'model-provider');
                this.loadConfiguration();
            }
        });
    }
    
    /**
     * Load configuration from VS Code settings
     */
    loadConfiguration() {
        const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
        this.providerType = config.get('modelProvider', 'ollama');
        
        // Validate provider type
        if (!['ollama', 'huggingface'].includes(this.providerType)) {
            Logger.warn(`Unknown model provider type: ${this.providerType}, defaulting to ollama`, 'model-provider');
            this.providerType = 'ollama';
        }
        
        Logger.info(`Using model provider: ${this.providerType}`, 'model-provider');
    }
    
    /**
     * Get the appropriate client for the configured provider
     */
    getClient() {
        switch (this.providerType) {
            case 'huggingface':
                if (this.huggingFaceClient.isReady()) {
                    return this.huggingFaceClient;
                } else {
                    Logger.warn('Hugging Face API not configured, falling back to Ollama', 'model-provider');
                    return null; // Will trigger fallback in the MCP client
                }
                
            case 'ollama':
            default:
                // The MCP client will handle Ollama directly
                return null;
        }
    }
    
    /**
     * Process a request through the appropriate model provider
     * @param {Object} requestData - The data to send to the model
     * @param {string} requestType - The type of request (e.g., 'evaluation', 'test-generation')
     * @returns {Promise<Object>} - The model response
     */
    async processRequest(requestData, requestType) {
        const client = this.getClient();
        
        if (client) {
            // Use the provider-specific client
            try {
                return await client.processRequest(requestData, requestType);
            } catch (error) {
                Logger.error(`Error using ${this.providerType} for ${requestType}:`, error, 'model-provider');
                
                // If we're using Hugging Face and it fails, try falling back to Ollama
                if (this.providerType === 'huggingface') {
                    Logger.info('Falling back to Ollama due to Hugging Face API error', 'model-provider');
                    return null; // Signal to MCP client to use Ollama
                }
                
                throw error;
            }
        }
        
        // Return null to indicate the MCP client should use Ollama
        return null;
    }
    
    /**
     * Check if we should use an external provider instead of Ollama
     */
    shouldUseExternalProvider() {
        return this.providerType === 'huggingface' && this.huggingFaceClient.isReady();
    }
    
    /**
     * Get information about the current provider configuration
     */
    getProviderInfo() {
        return {
            type: this.providerType,
            isConfigured: this.providerType === 'huggingface' ? this.huggingFaceClient.isReady() : true,
            model: this.providerType === 'huggingface' ? this.huggingFaceClient.model : 'local-ollama'
        };
    }
}

module.exports = new ModelProviderService();
