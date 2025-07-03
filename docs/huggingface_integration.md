# Hugging Face API Integration

This document describes the Hugging Face API integration features added in version 0.7.0 of the AI Development Monitor.

## Overview

The AI Development Monitor now provides integration with Hugging Face's hosted AI models as an alternative to the local Ollama LLM. This enables:

1. Accessing more powerful, cloud-hosted models for code evaluation and test generation
2. Using specialized models optimized for specific programming languages and tasks
3. Benefiting from Hugging Face's model ecosystem while maintaining the features of the AI Development Monitor

## Key Components

### Model Provider Service

The `model_provider_service.js` module provides an abstraction layer that allows seamless switching between:

- **Local Ollama LLM**: Running locally for privacy and no API costs
- **Hugging Face API**: Cloud-hosted models with potentially better performance

The service handles model selection, API communication, error handling, and fallback mechanisms.

### Hugging Face Client

The dedicated `huggingface_client.js` module manages communication with the Hugging Face API with features including:

- API key and model management
- Rate limiting and request queuing
- Response caching to reduce token usage
- Error handling with automatic fallback to Ollama

## Configuration

### Settings

The following settings can be configured in VS Code settings:

- **aiDevelopmentMonitor.modelProvider**: Select which model provider to use (`ollama` or `huggingface`)
- **aiDevelopmentMonitor.huggingFace.apiKey**: Your Hugging Face API key
- **aiDevelopmentMonitor.huggingFace.defaultModel**: The default model to use
- **aiDevelopmentMonitor.huggingFace.enableResponseCaching**: Toggle response caching to reduce API usage
- **aiDevelopmentMonitor.huggingFace.availableModels**: List of models available for selection

### Recommended Models

The following Hugging Face models work well with the AI Development Monitor:

1. **microsoft/codebert-base**: Good general code understanding
2. **codellama/CodeLlama-7b-hf**: Strong code generation capabilities
3. **bigcode/starcoder**: Specialized for code completion and analysis
4. **bigcode/santacoder**: Lightweight option with good performance
5. **facebook/incoder-1B**: Good for code translation and fixing

## Usage

### Switching Between Providers

1. Open the VS Code Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type "AI Monitor: Show Status Menu"
3. In the menu, look for the "Model Provider" section
4. Click the settings gear icon next to the current provider
5. This will open settings where you can change `aiDevelopmentMonitor.modelProvider`

### Setting Up Hugging Face API

1. Get an API key from Hugging Face: https://huggingface.co/settings/tokens
2. Open VS Code settings
3. Search for "AI Development Monitor"
4. Set your API key in `aiDevelopmentMonitor.huggingFace.apiKey`
5. Choose your preferred model in `aiDevelopmentMonitor.huggingFace.defaultModel`

### Managing Cache

To clear the Hugging Face response cache:

1. Open the AI Monitor Status Menu
2. Select "Clear Hugging Face API Cache"

## Fallback Mechanism

The system implements automatic fallback from Hugging Face to Ollama when:

1. The Hugging Face API key is invalid or missing
2. The selected model is unavailable
3. The API returns errors or rate limits are exceeded
4. Network connectivity to Hugging Face is interrupted

This ensures a smooth experience even when cloud services are unavailable.

## Implementing Custom Models

Advanced users can add custom models to the available models list in VS Code settings:

```json
"aiDevelopmentMonitor.huggingFace.availableModels": [
    "microsoft/codebert-base",
    "your-custom-model-name"
]
```

## Troubleshooting

Common issues and solutions:

1. **Authentication Errors**: Verify your API key in VS Code settings
2. **Model Not Found**: Check that the model name is correct and publicly available
3. **Rate Limiting**: The client will automatically wait and retry, but consider upgrading your Hugging Face plan
4. **Slow Responses**: Larger models can take longer to generate responses; consider using a smaller model
