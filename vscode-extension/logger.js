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

// Rate limiting cache
const logCache = new Map();
// Default values that can be overridden by configuration
let LOG_RATE_WINDOW_MS = 2000; // 2 seconds window for duplicate detection
let MAX_DUPLICATE_LOGS = 3; // Allow at most 3 identical logs within the window
const MAX_CACHE_SIZE = 100; // Prevent memory leaks by limiting cache size

/**
 * Check if a log message should be rate limited
 * @param {string} level Log level
 * @param {string} message Message to log
 * @param {string} category Log category
 * @returns {boolean} True if the message should be rate limited
 */
function shouldRateLimit(level, message, category) {
    // Don't rate limit ERROR or WARN levels
    if (level === 'ERROR' || level === 'WARN') {
        return false;
    }
    
    // Create a hash for the message
    const msgHash = `${level}:${category}:${message.substring(0, 100)}`;
    const now = Date.now();
    
    // Clean up old entries to prevent memory leaks
    if (logCache.size > MAX_CACHE_SIZE) {
        const oldestTime = now - LOG_RATE_WINDOW_MS;
        for (const [key, value] of logCache.entries()) {
            if (value.timestamp < oldestTime) {
                logCache.delete(key);
            }
        }
    }
    
    // Check if this message is being repeated too frequently
    if (logCache.has(msgHash)) {
        const cached = logCache.get(msgHash);
        
        // If within rate window and exceeds count, rate limit
        if (now - cached.timestamp < LOG_RATE_WINDOW_MS) {
            cached.count++;
            cached.lastSeen = now;
            
            // If we've seen too many of these messages, rate limit
            if (cached.count > MAX_DUPLICATE_LOGS) {
                // Only log a rate limit warning once per window
                if (!cached.limitWarned) {
                    cached.limitWarned = true;
                    console.log(`[RATE LIMITED] Similar "${level}" log in "${category}" repeated ${cached.count} times`);
                }
                return true;
            }
        } else {
            // Outside window, reset counter
            cached.count = 1;
            cached.timestamp = now;
            cached.limitWarned = false;
        }
        
        logCache.set(msgHash, cached);
    } else {
        // First time seeing this message
        logCache.set(msgHash, {
            count: 1,
            timestamp: now,
            lastSeen: now,
            limitWarned: false
        });
    }
    
    return false;
}

/**
 * Check if a log message should be suppressed based on verbosity settings
 * @param {string} level Log level
 * @param {string} category Log category
 * @returns {boolean} True if the message should be suppressed
 */
function shouldSuppressBasedOnVerbosity(level, category) {
    // If no verbosity setting or not DEBUG/TRACE level, don't suppress
    if (!config.debugVerbosity || (level !== 'DEBUG' && level !== 'TRACE')) {
        return false;
    }
    
    // Categories that generate a lot of logs
    const noisyCategories = ['copilot', 'mcp', 'analysis'];
    
    // Suppress based on verbosity level
    if (config.debugVerbosity === 'minimal' && noisyCategories.includes(category)) {
        return true;
    }
    
    // For normal verbosity, only suppress TRACE level in noisy categories
    if (config.debugVerbosity === 'normal' && level === 'TRACE' && noisyCategories.includes(category)) {
        return true;
    }
    
    return false;
}

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
    
    // Update rate limiting settings if provided
    if (userConfig.rateLimitDuration) {
        LOG_RATE_WINDOW_MS = userConfig.rateLimitDuration;
    }
    
    if (userConfig.maxDuplicateLogs) {
        MAX_DUPLICATE_LOGS = userConfig.maxDuplicateLogs;
    }
    
    // Log initialization with rate limit settings
    info('Logger initialized', 'system');
    debug(`Rate limiting: ${LOG_RATE_WINDOW_MS}ms window, max ${MAX_DUPLICATE_LOGS} duplicates`, 'system');
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
    
    if (shouldRateLimit(level, message, category)) {
        return;
    }
    
    if (shouldSuppressBasedOnVerbosity(level, category)) {
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
