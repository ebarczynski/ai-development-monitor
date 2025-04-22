/**
 * Debug Logger for AI Development Monitor Extension
 * Provides enhanced logging capabilities with multiple log levels and categories.
 */

// Configuration
const LOG_LEVEL = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
    TRACE: 5
};

// Default configuration
let config = {
    enabled: true,
    level: LOG_LEVEL.INFO,
    logToConsole: true,
    logToOutputChannel: true,
    logToFile: false
};

// VS Code output channel
let outputChannel = null;

/**
 * Initialize the logger
 * @param {*} vscode VS Code API
 * @param {*} context Extension context
 * @param {*} userConfig User configuration
 */
function initialize(vscode, context, userConfig = {}) {
    // Update configuration with user settings
    config = { ...config, ...userConfig };
    
    // Create output channel if needed
    if (config.logToOutputChannel) {
        outputChannel = vscode.window.createOutputChannel('AI Development Monitor');
        context.subscriptions.push(outputChannel);
    }
    
    info('Logger initialized', 'system');
}

/**
 * Log a message with specific level and category
 * @param {string} level Log level
 * @param {string} message Message to log
 * @param {string} category Log category
 */
function log(level, message, category = 'general') {
    if (!config.enabled || LOG_LEVEL[level] > config.level) {
        return;
    }
    
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] [${category}] ${message}`;
    
    // Log to console
    if (config.logToConsole) {
        switch (level) {
            case 'ERROR':
                console.error(formattedMessage);
                break;
            case 'WARN':
                console.warn(formattedMessage);
                break;
            case 'INFO':
                console.info(formattedMessage);
                break;
            default:
                console.log(formattedMessage);
                break;
        }
    }
    
    // Log to output channel
    if (config.logToOutputChannel && outputChannel) {
        outputChannel.appendLine(formattedMessage);
    }
}

/**
 * Log an object with JSON formatting
 * @param {string} level Log level
 * @param {string} label Label for the object
 * @param {any} obj Object to log
 * @param {string} category Log category
 */
function logObject(level, label, obj, category = 'general') {
    if (!config.enabled || LOG_LEVEL[level] > config.level) {
        return;
    }
    
    let objString;
    try {
        // Use a replacer function to handle circular references
        const getCircularReplacer = () => {
            const seen = new WeakSet();
            return (key, value) => {
                // Handle special types that cause circular references
                if (key === 'socket' || key === 'parser' || key === '_httpMessage' || key === 'client') {
                    return '[Circular Reference]';
                }
                
                // Generic circular reference detection
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) {
                        return '[Circular Reference]';
                    }
                    seen.add(value);
                }
                return value;
            };
        };
        
        objString = JSON.stringify(obj, getCircularReplacer(), 2);
    } catch (error) {
        objString = `[Unstringifiable object: ${error.message}]`;
    }
    
    log(level, `${label}:\n${objString}`, category);
}

/**
 * Log an error message and optionally an error object
 * @param {string} message Error message
 * @param {Error} error Error object
 * @param {string} category Log category
 */
function error(message, error = null, category = 'general') {
    log('ERROR', message, category);
    if (error) {
        log('ERROR', `Error details: ${error.message}`, category);
        if (error.stack) {
            log('ERROR', `Stack trace: ${error.stack}`, category);
        }
    }
}

/**
 * Log a warning message
 * @param {string} message Warning message
 * @param {string} category Log category
 */
function warn(message, category = 'general') {
    log('WARN', message, category);
}

/**
 * Log an info message
 * @param {string} message Info message
 * @param {string} category Log category
 */
function info(message, category = 'general') {
    log('INFO', message, category);
}

/**
 * Log a debug message
 * @param {string} message Debug message
 * @param {string} category Log category
 */
function debug(message, category = 'general') {
    log('DEBUG', message, category);
}

/**
 * Log a trace message
 * @param {string} message Trace message
 * @param {string} category Log category
 */
function trace(message, category = 'general') {
    log('TRACE', message, category);
}

/**
 * Show the log output panel to the user
 */
function show() {
    if (outputChannel) {
        outputChannel.show();
    }
}

module.exports = {
    LOG_LEVEL,
    initialize,
    error,
    warn,
    info,
    debug,
    trace,
    logObject,
    show
};
