import chalk from "chalk";
import fs from "fs";
import path from "path";

// ========== CONFIGURATION ==========
const DEBUG_CONFIG = {
    enableConsoleLog: true,
    enableFileLog: true,
    logFilePath: './logs/debug.log',
    maxLogFileSize: 10 * 1024 * 1024, // 10MB
    logToFileInterval: 5000, // Write to file every 5 seconds
    showTimestamp: true,
    showMessageCounter: true,
    detailedLogging: true,
    coloredOutput: true,
};

// ========== STATE TRACKING ==========
let messageCounter = 0;
let eventCounter = 0;
let errorCounter = 0;
let successCounter = 0;
let skipCounter = 0;
let queueCounter = 0;

const logBuffer = [];
const statsHistory = [];

// ========== LOG LEVELS ==========
const LOG_LEVELS = {
    DEBUG: { color: chalk.gray, prefix: '🔍' },
    INFO: { color: chalk.cyan, prefix: 'ℹ️' },
    SUCCESS: { color: chalk.green, prefix: '✅' },
    WARNING: { color: chalk.yellow, prefix: '⚠️' },
    ERROR: { color: chalk.red, prefix: '❌' },
    CRITICAL: { color: chalk.bgRed.white, prefix: '🚨' },
};

// ========== ENSURE LOG DIRECTORY ==========
function ensureLogDirectory() {
    try {
        const logDir = path.dirname(DEBUG_CONFIG.logFilePath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        return true;
    } catch (error) {
        console.error(chalk.red(`[DEBUG-HELPER] Failed to create log directory: ${error.message}`));
        return false;
    }
}

// ========== FORMAT TIMESTAMP ==========
function getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('id-ID', { 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });
}

// ========== WRITE TO FILE ==========
function writeToFile(message) {
    if (!DEBUG_CONFIG.enableFileLog) return;
    
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        // Check file size
        if (fs.existsSync(DEBUG_CONFIG.logFilePath)) {
            const stats = fs.statSync(DEBUG_CONFIG.logFilePath);
            if (stats.size > DEBUG_CONFIG.maxLogFileSize) {
                // Rotate log file
                const backupPath = DEBUG_CONFIG.logFilePath + '.old';
                fs.renameSync(DEBUG_CONFIG.logFilePath, backupPath);
            }
        }
        
        fs.appendFileSync(DEBUG_CONFIG.logFilePath, logEntry);
    } catch (error) {
        console.error(chalk.red(`[DEBUG-HELPER] Failed to write to log file: ${error.message}`));
    }
}

// ========== BUFFERED LOG WRITER ==========
setInterval(() => {
    if (logBuffer.length > 0 && DEBUG_CONFIG.enableFileLog) {
        const entries = logBuffer.splice(0, logBuffer.length);
        entries.forEach(entry => writeToFile(entry));
    }
}, DEBUG_CONFIG.logToFileInterval);

// ========== BASE LOG FUNCTION ==========
function baseLog(level, message, data = {}) {
    const timestamp = DEBUG_CONFIG.showTimestamp ? getTimestamp() : '';
    const counter = DEBUG_CONFIG.showMessageCounter ? `[#${messageCounter}]` : '';
    const levelInfo = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    
    let formattedMessage = `${levelInfo.prefix} ${counter}${timestamp ? `[${timestamp}]` : ''} ${message}`;
    
    // Add data if available
    if (DEBUG_CONFIG.detailedLogging && Object.keys(data).length > 0) {
        formattedMessage += '\n' + formatData(data);
    }
    
    // Console output
    if (DEBUG_CONFIG.enableConsoleLog) {
        if (DEBUG_CONFIG.coloredOutput) {
            console.log(levelInfo.color(formattedMessage));
        } else {
            console.log(formattedMessage);
        }
    }
    
    // Buffer for file output
    if (DEBUG_CONFIG.enableFileLog) {
        logBuffer.push(formattedMessage.replace(/\x1B\[[0-9;]*m/g, '')); // Remove color codes
    }
}

// ========== FORMAT DATA OBJECT ==========
function formatData(data, indent = 2) {
    const indentStr = ' '.repeat(indent);
    let result = '';
    
    for (const [key, value] of Object.entries(data)) {
        if (value === null || value === undefined) {
            result += `${indentStr}${key}: ${value}\n`;
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            result += `${indentStr}${key}:\n${formatData(value, indent + 2)}`;
        } else if (Array.isArray(value)) {
            result += `${indentStr}${key}: [${value.join(', ')}]\n`;
        } else if (typeof value === 'string' && value.length > 100) {
            result += `${indentStr}${key}: "${value.substring(0, 100)}..."\n`;
        } else {
            result += `${indentStr}${key}: ${value}\n`;
        }
    }
    
    return result;
}

// ========== MAIN LOG FUNCTIONS ==========

export function logMessageFlow(stage, data = {}) {
    const timestamp = getTimestamp();
    
    switch(stage) {
        case 'EVENT_RECEIVED':
            eventCounter++;
            console.log(chalk.bgMagenta.white(
                `\n========== EVENT #${eventCounter} RECEIVED [${timestamp}] ==========`
            ));
            console.log(chalk.yellow(`  Type: ${data.type || 'unknown'}`));
            console.log(chalk.yellow(`  Message Count: ${data.count || 0}`));
            console.log(chalk.gray(`  Stats: Total=${data.statsTotal || 0}, Processed=${data.statsProcessed || 0}`));
            console.log(chalk.magenta(`========================================\n`));
            
            logBuffer.push(`EVENT_RECEIVED | Type: ${data.type}, Count: ${data.count}`);
            break;
            
        case 'MESSAGE_START':
            messageCounter++;
            console.log(chalk.bgCyan.black(
                `[${messageCounter}][${timestamp}] → PROCESSING MESSAGE`
            ));
            console.log(chalk.cyan(`  From: ${data.from?.substring(0, 30) || 'unknown'}`));
            console.log(chalk.cyan(`  JID: ${data.jid?.substring(0, 40) || 'unknown'}`));
            console.log(chalk.cyan(`  Text: "${data.text?.substring(0, 50) || 'no text'}"`));
            console.log(chalk.cyan(`  Type: ${data.msgType || 'unknown'}`));
            
            logBuffer.push(`MESSAGE_START | #${messageCounter} | From: ${data.from} | Text: ${data.text?.substring(0, 50)}`);
            break;
            
        case 'SKIP':
            skipCounter++;
            const skipReasons = {
                'own_message': { icon: '👤', color: chalk.gray },
                'non_notify': { icon: '🔕', color: chalk.gray },
                'no_content': { icon: '📭', color: chalk.gray },
                'not_group': { icon: '💬', color: chalk.yellow },
                'no_prefix': { icon: '❌', color: chalk.gray },
                'blacklisted': { icon: '🚫', color: chalk.red },
                'corrupted': { icon: '💥', color: chalk.red },
                'cleanup_lock': { icon: '🔒', color: chalk.yellow },
                'already_processed': { icon: '♻️', color: chalk.gray },
                'user_busy': { icon: '⏳', color: chalk.yellow },
                'spam': { icon: '🚨', color: chalk.red },
            };
            
            const skipInfo = skipReasons[data.reason] || { icon: '⏭️', color: chalk.gray };
            
            skipInfo.color(
                `[${messageCounter}][${timestamp}] ${skipInfo.icon} SKIP: ${data.reason.toUpperCase()}`
            );
            if (data.text) {
                console.log(skipInfo.color(`  Text: "${data.text.substring(0, 40)}"`));
            }
            if (data.detail) {
                console.log(skipInfo.color(`  Detail: ${data.detail}`));
            }
            
            logBuffer.push(`SKIP | #${messageCounter} | Reason: ${data.reason} | Text: ${data.text?.substring(0, 30)}`);
            break;
            
        case 'PASSED_CHECKS':
            console.log(chalk.bgGreen.black(
                `[${messageCounter}][${timestamp}] ✓ PASSED ALL CHECKS`
            ));
            console.log(chalk.green(`  Text: "${data.text?.substring(0, 50) || 'no text'}"`));
            console.log(chalk.green(`  From: ${data.from?.substring(0, 30) || 'unknown'}`));
            
            logBuffer.push(`PASSED_CHECKS | #${messageCounter} | Text: ${data.text?.substring(0, 50)}`);
            break;
            
        case 'QUEUE_ADD':
            queueCounter++;
            console.log(chalk.bgYellow.black(
                `[${messageCounter}][${timestamp}] ⚡ ADDED TO QUEUE`
            ));
            console.log(chalk.yellow(`  Queue Size: ${data.queueSize || 0}`));
            console.log(chalk.yellow(`  Processing: ${data.processing || 0}`));
            console.log(chalk.yellow(`  Priority: ${data.priority || 'NORMAL'}`));
            console.log(chalk.yellow(`  Text: "${data.text?.substring(0, 40) || 'no text'}"`));
            
            logBuffer.push(`QUEUE_ADD | #${messageCounter} | Queue: ${data.queueSize}, Text: ${data.text?.substring(0, 30)}`);
            break;
            
        case 'QUEUE_START':
            console.log(chalk.bgBlue.white(
                `[${messageCounter}][${timestamp}] 🔄 QUEUE PROCESSING STARTED`
            ));
            console.log(chalk.blue(`  Text: "${data.text?.substring(0, 40) || 'no text'}"`));
            
            logBuffer.push(`QUEUE_START | #${messageCounter}`);
            break;
            
        case 'PROC_MSG_START':
            console.log(chalk.cyan(
                `[${messageCounter}][${timestamp}] 📝 procMsg() started`
            ));
            break;
            
        case 'PROC_MSG_SUCCESS':
            console.log(chalk.green(
                `[${messageCounter}][${timestamp}] ✅ procMsg() success`
            ));
            break;
            
        case 'HANDLER_START':
            console.log(chalk.cyan(
                `[${messageCounter}][${timestamp}] 🎯 handleCommand() started`
            ));
            console.log(chalk.cyan(`  Command: ${data.command || 'unknown'}`));
            break;
            
        case 'HANDLER_SUCCESS':
            console.log(chalk.green(
                `[${messageCounter}][${timestamp}] ✅ handleCommand() success`
            ));
            break;
            
        case 'SUCCESS':
            successCounter++;
            console.log(chalk.bgGreen.white(
                `[${messageCounter}][${timestamp}] ✅ COMPLETE SUCCESS`
            ));
            console.log(chalk.green(`  Text: "${data.text?.substring(0, 40) || 'no text'}"`));
            console.log(chalk.green(`  Duration: ${data.duration || 'unknown'}ms`));
            console.log(chalk.green(`  Success Rate: ${successCounter}/${messageCounter} (${((successCounter/messageCounter)*100).toFixed(1)}%)`));
            
            logBuffer.push(`SUCCESS | #${messageCounter} | Text: ${data.text?.substring(0, 30)}`);
            break;
            
        case 'ERROR':
            errorCounter++;
            console.log(chalk.bgRed.white(
                `[${messageCounter}][${timestamp}] ❌ ERROR OCCURRED`
            ));
            console.log(chalk.red(`  Error: ${data.error?.substring(0, 100) || 'unknown error'}`));
            console.log(chalk.red(`  Text: "${data.text?.substring(0, 40) || 'no text'}"`));
            console.log(chalk.red(`  Stage: ${data.stage || 'unknown'}`));
            if (data.stack) {
                console.log(chalk.red(`  Stack: ${data.stack.substring(0, 200)}`));
            }
            
            logBuffer.push(`ERROR | #${messageCounter} | Error: ${data.error} | Stage: ${data.stage}`);
            break;
            
        case 'TIMEOUT':
            console.log(chalk.bgRed.yellow(
                `[${messageCounter}][${timestamp}] ⏱️ TIMEOUT`
            ));
            console.log(chalk.yellow(`  Stage: ${data.stage || 'unknown'}`));
            console.log(chalk.yellow(`  Timeout: ${data.timeout || 'unknown'}ms`));
            
            logBuffer.push(`TIMEOUT | #${messageCounter} | Stage: ${data.stage}`);
            break;
            
        case 'BAD_MAC':
            console.log(chalk.bgRed.white(
                `[${messageCounter}][${timestamp}] 💥 BAD MAC ERROR`
            ));
            console.log(chalk.red(`  Contact: ${data.contact?.substring(0, 30) || 'unknown'}`));
            console.log(chalk.red(`  Total Bad MAC: ${data.totalBadMac || 0}`));
            console.log(chalk.red(`  Should Cleanup: ${data.shouldCleanup || false}`));
            console.log(chalk.red(`  Should Restart: ${data.shouldRestart || false}`));
            
            logBuffer.push(`BAD_MAC | #${messageCounter} | Contact: ${data.contact} | Total: ${data.totalBadMac}`);
            break;
            
        default:
            baseLog('INFO', `Unknown stage: ${stage}`, data);
    }
}

// ========== SYSTEM STATUS ==========
export function logSystemStatus(customData = {}) {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rss = Math.round(memUsage.rss / 1024 / 1024);
    
    const successRate = messageCounter > 0 ? ((successCounter / messageCounter) * 100).toFixed(1) : 0;
    const skipRate = messageCounter > 0 ? ((skipCounter / messageCounter) * 100).toFixed(1) : 0;
    const errorRate = messageCounter > 0 ? ((errorCounter / messageCounter) * 100).toFixed(1) : 0;
    
    console.log(chalk.cyan(`
╔════════════════════════════════════════════════════════╗
║  🔍 SYSTEM STATUS - ${getTimestamp()}              ║
╠════════════════════════════════════════════════════════╣
║  📊 COUNTERS:
║    • Events Received: ${eventCounter}
║    • Messages Processed: ${messageCounter}
║    • Queue Additions: ${queueCounter}
║    • Successes: ${successCounter} (${successRate}%)
║    • Skips: ${skipCounter} (${skipRate}%)
║    • Errors: ${errorCounter} (${errorRate}%)
║
║  💾 MEMORY:
║    • Heap Used: ${heapUsedMB} MB / ${heapTotalMB} MB
║    • RSS: ${rss} MB
║
║  ⏱️  PERFORMANCE:
║    • Uptime: ${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s
║    • Avg Processing: ${messageCounter > 0 ? (uptime / messageCounter).toFixed(2) : 0}s per msg
║
║  🎯 CUSTOM DATA:
${formatCustomData(customData)}
╚════════════════════════════════════════════════════════╝
    `));
    
    // Save stats history
    statsHistory.push({
        timestamp: Date.now(),
        messageCounter,
        successCounter,
        errorCounter,
        skipCounter,
        heapUsedMB,
        uptime
    });
    
    // Keep only last 100 records
    if (statsHistory.length > 100) {
        statsHistory.shift();
    }
}

function formatCustomData(data) {
    if (Object.keys(data).length === 0) return '    (none)';
    
    return Object.entries(data)
        .map(([key, value]) => `    • ${key}: ${value}`)
        .join('\n');
}

// ========== CONNECTION EVENTS ==========
export function logConnection(event, data = {}) {
    const eventTypes = {
        'connecting': { icon: '🔌', color: chalk.yellow },
        'open': { icon: '✅', color: chalk.green },
        'close': { icon: '❌', color: chalk.red },
        'reconnecting': { icon: '🔄', color: chalk.cyan },
    };
    
    const eventInfo = eventTypes[event] || { icon: '❓', color: chalk.gray };
    
    console.log(eventInfo.color(
        `\n${eventInfo.icon} CONNECTION EVENT: ${event.toUpperCase()}`
    ));
    
    if (data.reason) {
        console.log(eventInfo.color(`  Reason: ${data.reason}`));
    }
    if (data.statusCode) {
        console.log(eventInfo.color(`  Status Code: ${data.statusCode}`));
    }
    if (data.reconnectDelay) {
        console.log(eventInfo.color(`  Reconnect in: ${data.reconnectDelay}ms`));
    }
    
    logBuffer.push(`CONNECTION | Event: ${event} | ${JSON.stringify(data)}`);
}

// ========== CLEANUP EVENTS ==========
export function logCleanup(stage, data = {}) {
    switch(stage) {
        case 'START':
            console.log(chalk.bgYellow.black(`\n🧹 CLEANUP STARTED [${getTimestamp()}]`));
            break;
        case 'PROGRESS':
            console.log(chalk.yellow(`  🗑️  Removing: ${data.file || 'unknown'}`));
            break;
        case 'COMPLETE':
            console.log(chalk.bgGreen.black(`✅ CLEANUP COMPLETE [${getTimestamp()}]`));
            console.log(chalk.green(`  Removed: ${data.removed || 0} files`));
            break;
        case 'ERROR':
            console.log(chalk.bgRed.white(`❌ CLEANUP ERROR [${getTimestamp()}]`));
            console.log(chalk.red(`  Error: ${data.error}`));
            break;
    }
    
    logBuffer.push(`CLEANUP | Stage: ${stage} | ${JSON.stringify(data)}`);
}

// ========== AUTO STATUS LOGGER ==========
let statusInterval = null;

export function startAutoStatusLog(intervalMs = 60000) {
    if (statusInterval) {
        clearInterval(statusInterval);
    }
    
    statusInterval = setInterval(() => {
        if (messageCounter > 0 || eventCounter > 0) {
            logSystemStatus();
        }
    }, intervalMs);
    
    console.log(chalk.green(`✅ Auto status logging enabled (every ${intervalMs/1000}s)`));
}

export function stopAutoStatusLog() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
        console.log(chalk.yellow(`⏹️  Auto status logging stopped`));
    }
}

// ========== STATS EXPORT ==========
export function getStats() {
    return {
        messageCounter,
        eventCounter,
        successCounter,
        errorCounter,
        skipCounter,
        queueCounter,
        successRate: messageCounter > 0 ? ((successCounter / messageCounter) * 100).toFixed(2) : 0,
        errorRate: messageCounter > 0 ? ((errorCounter / messageCounter) * 100).toFixed(2) : 0,
        skipRate: messageCounter > 0 ? ((skipCounter / messageCounter) * 100).toFixed(2) : 0,
        statsHistory: [...statsHistory]
    };
}

export function resetStats() {
    messageCounter = 0;
    eventCounter = 0;
    successCounter = 0;
    errorCounter = 0;
    skipCounter = 0;
    queueCounter = 0;
    statsHistory.length = 0;
    console.log(chalk.green(`✅ Stats reset successfully`));
}

// ========== EXPORT CONFIG CONTROL ==========
export function setDebugConfig(config) {
    Object.assign(DEBUG_CONFIG, config);
    console.log(chalk.green(`✅ Debug config updated`));
}

export function getDebugConfig() {
    return { ...DEBUG_CONFIG };
}

// ========== INITIALIZE ==========
ensureLogDirectory();
console.log(chalk.green(`✅ Debug Helper initialized`));
console.log(chalk.gray(`   Log file: ${DEBUG_CONFIG.logFilePath}`));
console.log(chalk.gray(`   Console logging: ${DEBUG_CONFIG.enableConsoleLog}`));
console.log(chalk.gray(`   File logging: ${DEBUG_CONFIG.enableFileLog}`));

// Start auto status logging
startAutoStatusLog(60000); // Every 1 minute

// Export all functions
export default {
    logMessageFlow,
    logSystemStatus,
    logConnection,
    logCleanup,
    startAutoStatusLog,
    stopAutoStatusLog,
    getStats,
    resetStats,
    setDebugConfig,
    getDebugConfig,
};