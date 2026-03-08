// ========== BOT BENGONG FIX - IMPROVED & FIXED IMPLEMENTATION ==========
// Enhanced version with bug fixes and improvements

import chalk from "chalk";

// ========== 1. IMPROVED BOT WATCHDOG SYSTEM ==========

class BotWatchdog {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
        this.lastActivity = Date.now();
        this.lastCommandProcessed = Date.now();
        this.checkInterval = null;
        this.warningThreshold = 180000; // 3 minutes
        this.criticalThreshold = 300000; // 5 minutes
        this.consecutiveWarnings = 0;
        this.recoveryAttempts = 0;
        this.maxRecoveryAttempts = 3;
        this.isRecovering = false; // Prevent concurrent recovery
        this.isChecking = false; // Prevent concurrent checks
    }
    
    recordActivity() {
        this.lastActivity = Date.now();
        this.consecutiveWarnings = 0;
    }
    
    recordCommandProcessed() {
        this.lastCommandProcessed = Date.now();
        this.consecutiveWarnings = 0;
        this.recoveryAttempts = 0;
    }
    
    async check() {
        // Prevent concurrent checks
        if (this.isChecking || this.isRecovering) {
            return;
        }
        
        this.isChecking = true;
        
        try {
            const now = Date.now();
            const timeSinceActivity = now - this.lastActivity;
            const timeSinceCommand = now - this.lastCommandProcessed;
            
            // WARNING: No activity for 3 minutes
            if (timeSinceActivity > this.warningThreshold && timeSinceActivity < this.criticalThreshold) {
                this.consecutiveWarnings++;
                
                console.log(chalk.yellow(`\n╔════════════════════════════════════════╗`));
                console.log(chalk.yellow(`║  ⚠️  WATCHDOG WARNING                  ║`));
                console.log(chalk.yellow(`╠════════════════════════════════════════╣`));
                console.log(chalk.white(`║  No activity: ${Math.floor(timeSinceActivity/1000)}s`));
                console.log(chalk.white(`║  Last command: ${Math.floor(timeSinceCommand/1000)}s ago`));
                console.log(chalk.white(`║  Consecutive warnings: ${this.consecutiveWarnings}`));
                console.log(chalk.yellow(`╚════════════════════════════════════════╝\n`));
                
                await this.tryWakeUp();
            }
            
            // CRITICAL: No activity for 5 minutes OR 3 consecutive warnings
            if (timeSinceActivity > this.criticalThreshold || this.consecutiveWarnings >= 3) {
                console.log(chalk.red(`\n╔════════════════════════════════════════╗`));
                console.log(chalk.red(`║  🚨 BOT BENGONG DETECTED!              ║`));
                console.log(chalk.red(`╠════════════════════════════════════════╣`));
                console.log(chalk.white(`║  Last activity: ${Math.floor(timeSinceActivity/1000)}s ago`));
                console.log(chalk.white(`║  Last command: ${Math.floor(timeSinceCommand/1000)}s ago`));
                console.log(chalk.white(`║  Recovery attempts: ${this.recoveryAttempts}/${this.maxRecoveryAttempts}`));
                console.log(chalk.red(`╚════════════════════════════════════════╝\n`));
                
                await this.emergencyRecovery();
            }
        } catch (error) {
            console.log(chalk.red(`[WATCHDOG] Check error: ${error.message}`));
        } finally {
            this.isChecking = false;
        }
    }
    
    async tryWakeUp() {
        try {
            console.log(chalk.cyan(`[WATCHDOG] 🔧 Attempting to wake up bot...`));
            
            // 1. Check WebSocket state safely
            const state = this.whatsapp?.ws?.readyState;
            const stateNames = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };
            console.log(chalk.gray(`[WATCHDOG] WebSocket: ${stateNames[state] || 'UNKNOWN'} (${state})`));
            
            if (state === undefined || state === null) {
                console.log(chalk.red(`[WATCHDOG] ⚠️  WebSocket undefined, skipping recovery...`));
                return;
            }
            
            if (state !== 1) { // Not OPEN
                console.log(chalk.red(`[WATCHDOG] ⚠️  Socket not open, will reconnect...`));
                if (typeof this.whatsapp.end === 'function') {
                    this.whatsapp.end();
                }
                return;
            }
            
            // 2. Clear stuck processing users (safe check)
            if (typeof antiSpam !== 'undefined' && antiSpam) {
                const processingCount = antiSpam.processingUsers?.size || 0;
                if (processingCount > 0) {
                    console.log(chalk.cyan(`[WATCHDOG] 🧹 Clearing ${processingCount} stuck users...`));
                    if (typeof antiSpam.clearStuckUsers === 'function') {
                        antiSpam.clearStuckUsers();
                    }
                }
                
                // 3. Release cleanup lock if stuck
                if (antiSpam.cleanupLock === true) {
                    console.log(chalk.yellow(`[WATCHDOG] 🔓 Releasing stuck cleanup lock...`));
                    antiSpam.cleanupLock = false;
                }
            }
            
            // 4. Check queue status (safe check)
            if (typeof messageQueue !== 'undefined' && messageQueue) {
                const queueSize = typeof messageQueue.getQueueSize === 'function' 
                    ? messageQueue.getQueueSize() 
                    : 0;
                const processing = messageQueue.processing || 0;
                const maxConcurrent = messageQueue.maxConcurrent || 1;
                
                console.log(chalk.gray(`[WATCHDOG] Queue: ${queueSize} pending, ${processing}/${maxConcurrent} processing`));
                
                if (processing >= maxConcurrent) {
                    console.log(chalk.yellow(`[WATCHDOG] ⚠️  All workers busy for extended time`));
                }
                
                // 5. Force queue processing if items waiting but nothing processing
                if (queueSize > 0 && processing === 0) {
                    console.log(chalk.cyan(`[WATCHDOG] 🔄 Force processing ${queueSize} queued items...`));
                    messageQueue.processing = 0;
                    if (typeof messageQueue.process === 'function') {
                        messageQueue.process();
                    }
                }
            }
            
            // 6. Check circuit breakers (safe check)
            this.checkCircuitBreakers();
            
            console.log(chalk.green(`[WATCHDOG] ✅ Wake up attempt completed`));
            
        } catch (error) {
            console.log(chalk.red(`[WATCHDOG] ❌ Wake up failed: ${error.message}`));
        }
    }
    
    checkCircuitBreakers() {
        try {
            const breakers = [];
            
            if (typeof badMacRecovery !== 'undefined' && badMacRecovery?.circuitBreaker) {
                breakers.push(badMacRecovery.circuitBreaker);
            }
            if (typeof antiSpam !== 'undefined' && antiSpam?.circuitBreaker) {
                breakers.push(antiSpam.circuitBreaker);
            }
            if (typeof messageQueue !== 'undefined' && messageQueue?.circuitBreaker) {
                breakers.push(messageQueue.circuitBreaker);
            }
            
            breakers.forEach(cb => {
                if (cb && typeof cb.getStats === 'function') {
                    const stat = cb.getStats();
                    if (stat.state === 'OPEN') {
                        console.log(chalk.yellow(`[WATCHDOG] ⚠️  Circuit breaker ${stat.name} is OPEN`));
                    }
                }
            });
        } catch (error) {
            console.log(chalk.red(`[WATCHDOG] Circuit breaker check failed: ${error.message}`));
        }
    }
    
    async emergencyRecovery() {
        // Prevent concurrent recovery attempts
        if (this.isRecovering) {
            console.log(chalk.yellow(`[RECOVERY] ⏳ Recovery already in progress, skipping...`));
            return;
        }
        
        if (this.recoveryAttempts >= this.maxRecoveryAttempts) {
            console.log(chalk.red(`[WATCHDOG] ❌ Max recovery attempts reached, forcing restart...`));
            setTimeout(() => process.exit(1), 3000);
            return;
        }
        
        this.isRecovering = true;
        this.recoveryAttempts++;
        
        try {
            console.log(chalk.red(`\n╔════════════════════════════════════════╗`));
            console.log(chalk.red(`║  🚨 EMERGENCY RECOVERY INITIATED       ║`));
            console.log(chalk.red(`║     Attempt ${this.recoveryAttempts}/${this.maxRecoveryAttempts}                       ║`));
            console.log(chalk.red(`╚════════════════════════════════════════╝\n`));
            
            // 1. Dump current state (safe)
            this.dumpCurrentState();
            
            // 2. Force clear everything (safe)
            this.forceClearLocks();
            
            // 3. Clear old queue items (safe)
            this.clearStuckQueueItems();
            
            // 4. Reset processing counter (safe)
            if (typeof messageQueue !== 'undefined' && messageQueue) {
                messageQueue.processing = 0;
            }
            
            // 5. Reset circuit breakers (safe)
            this.resetCircuitBreakers();
            
            // 6. Check WebSocket (safe)
            const wsState = this.whatsapp?.ws?.readyState;
            if (wsState !== 1) {
                console.log(chalk.red(`[RECOVERY] ⚠️  WebSocket not open (state: ${wsState}), forcing reconnect...`));
                if (typeof this.whatsapp.end === 'function') {
                    this.whatsapp.end();
                }
                return;
            }
            
            // 7. Force queue processing (safe)
            if (typeof messageQueue !== 'undefined' && messageQueue) {
                const remainingQueue = typeof messageQueue.getQueueSize === 'function'
                    ? messageQueue.getQueueSize()
                    : 0;
                    
                if (remainingQueue > 0) {
                    console.log(chalk.cyan(`[RECOVERY] 🔄 Force processing ${remainingQueue} remaining items...`));
                    if (typeof messageQueue.process === 'function') {
                        messageQueue.process();
                    }
                }
            }
            
            console.log(chalk.green(`\n╔════════════════════════════════════════╗`));
            console.log(chalk.green(`║  ✅ EMERGENCY RECOVERY COMPLETED       ║`));
            console.log(chalk.green(`╚════════════════════════════════════════╝\n`));
            
            // Reset watchdog state
            this.lastActivity = Date.now();
            this.lastCommandProcessed = Date.now();
            this.consecutiveWarnings = 0;
            
        } catch (error) {
            console.log(chalk.red(`[RECOVERY] ❌ Recovery failed: ${error.message}`));
            console.log(chalk.red(`[RECOVERY] 🔄 Forcing restart in 5 seconds...`));
            
            setTimeout(() => {
                process.exit(1);
            }, 5000);
        } finally {
            this.isRecovering = false;
        }
    }
    
    dumpCurrentState() {
        try {
            console.log(chalk.yellow(`[RECOVERY] Current state:`));
            
            if (typeof antiSpam !== 'undefined' && antiSpam) {
                console.log(chalk.gray(`  - Processing users: ${antiSpam.processingUsers?.size || 0}`));
                console.log(chalk.gray(`  - Processing timestamps: ${antiSpam.processingTimestamps?.size || 0}`));
                console.log(chalk.gray(`  - Cleanup lock: ${antiSpam.cleanupLock || false}`));
            }
            
            if (typeof messageQueue !== 'undefined' && messageQueue) {
                const queueSize = typeof messageQueue.getQueueSize === 'function' 
                    ? messageQueue.getQueueSize() 
                    : 0;
                const maxConcurrent = messageQueue.maxConcurrent || 1;
                console.log(chalk.gray(`  - Queue size: ${queueSize}`));
                console.log(chalk.gray(`  - Queue processing: ${messageQueue.processing || 0}/${maxConcurrent}`));
            }
            
            console.log(chalk.gray(`  - WebSocket state: ${this.whatsapp?.ws?.readyState || 'undefined'}`));
        } catch (error) {
            console.log(chalk.red(`[RECOVERY] State dump failed: ${error.message}`));
        }
    }
    
    forceClearLocks() {
        try {
            console.log(chalk.cyan(`[RECOVERY] 🧹 Force clearing all locks and stuck states...`));
            
            if (typeof antiSpam !== 'undefined' && antiSpam) {
                if (antiSpam.processingUsers && typeof antiSpam.processingUsers.clear === 'function') {
                    antiSpam.processingUsers.clear();
                }
                if (antiSpam.processingTimestamps && typeof antiSpam.processingTimestamps.clear === 'function') {
                    antiSpam.processingTimestamps.clear();
                }
                antiSpam.cleanupLock = false;
            }
        } catch (error) {
            console.log(chalk.red(`[RECOVERY] Lock clearing failed: ${error.message}`));
        }
    }
    
    clearStuckQueueItems() {
        try {
            console.log(chalk.cyan(`[RECOVERY] 🗑️  Clearing stuck queue items...`));
            let clearedFromQueue = 0;
            
            if (typeof messageQueue === 'undefined' || !messageQueue || !messageQueue.priorityLevels) {
                console.log(chalk.gray(`  - Queue not available, skipping...`));
                return;
            }
            
            Object.keys(messageQueue.priorityLevels).forEach(priority => {
                if (!Array.isArray(messageQueue.priorityLevels[priority])) {
                    return;
                }
                
                const stuck = messageQueue.priorityLevels[priority].filter(item => {
                    return item && item.timestamp && (Date.now() - item.timestamp > 60000);
                });
                
                stuck.forEach(item => {
                    if (item && typeof item.reject === 'function') {
                        try {
                            item.reject(new Error('Emergency recovery - task cleared'));
                            clearedFromQueue++;
                        } catch (e) {
                            // Ignore rejection errors
                        }
                    }
                });
                
                messageQueue.priorityLevels[priority] = messageQueue.priorityLevels[priority].filter(item => {
                    return item && item.timestamp && (Date.now() - item.timestamp <= 60000);
                });
            });
            
            console.log(chalk.gray(`  - Cleared ${clearedFromQueue} stuck queue items`));
        } catch (error) {
            console.log(chalk.red(`[RECOVERY] Queue clearing failed: ${error.message}`));
        }
    }
    
    resetCircuitBreakers() {
        try {
            console.log(chalk.cyan(`[RECOVERY] 🔄 Resetting circuit breakers...`));
            
            const breakers = [
                { name: 'badMacRecovery', obj: typeof badMacRecovery !== 'undefined' ? badMacRecovery : null },
                { name: 'antiSpam', obj: typeof antiSpam !== 'undefined' ? antiSpam : null },
                { name: 'messageQueue', obj: typeof messageQueue !== 'undefined' ? messageQueue : null },
                { name: 'sessionCleaner', obj: typeof sessionCleaner !== 'undefined' ? sessionCleaner : null }
            ];
            
            breakers.forEach(({ name, obj }) => {
                if (obj && obj.circuitBreaker && obj.circuitBreaker.state !== 'CLOSED') {
                    if (typeof obj.circuitBreaker.reset === 'function') {
                        obj.circuitBreaker.reset();
                        console.log(chalk.gray(`  - Reset ${name} circuit breaker`));
                    }
                }
            });
        } catch (error) {
            console.log(chalk.red(`[RECOVERY] Circuit breaker reset failed: ${error.message}`));
        }
    }
    
    start() {
        if (this.checkInterval) {
            console.log(chalk.yellow(`[WATCHDOG] ⚠️  Watchdog already running`));
            return;
        }
        
        // Check every 30 seconds
        this.checkInterval = setInterval(() => {
            this.check().catch(err => {
                console.log(chalk.red(`[WATCHDOG] Check interval error: ${err.message}`));
            });
        }, 30000);
        
        console.log(chalk.green(`[WATCHDOG] 👁️  Watchdog started (check every 30s)`));
    }
    
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log(chalk.gray(`[WATCHDOG] 🛑 Watchdog stopped`));
        }
    }
    
    getStats() {
        return {
            lastActivity: new Date(this.lastActivity).toLocaleTimeString(),
            lastCommand: new Date(this.lastCommandProcessed).toLocaleTimeString(),
            timeSinceActivity: Math.floor((Date.now() - this.lastActivity) / 1000),
            timeSinceCommand: Math.floor((Date.now() - this.lastCommandProcessed) / 1000),
            consecutiveWarnings: this.consecutiveWarnings,
            recoveryAttempts: this.recoveryAttempts,
            isRecovering: this.isRecovering,
            isChecking: this.isChecking
        };
    }
}

// ========== 2. IMPROVED CONNECTION HEALTH MONITOR ==========

class ConnectionHealthMonitor {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
        this.lastPing = Date.now();
        this.lastPong = Date.now();
        this.missedPongs = 0;
        this.checkInterval = null;
        this.pingHistory = [];
        this.maxHistorySize = 10;
        this.isPinging = false; // Prevent concurrent pings
    }
    
    async ping() {
        // Prevent concurrent pings
        if (this.isPinging) {
            return false;
        }
        
        this.isPinging = true;
        
        try {
            this.lastPing = Date.now();
            const start = Date.now();
            
            // Check if whatsapp instance exists
            if (!this.whatsapp || !this.whatsapp.user) {
                throw new Error('WhatsApp instance not available');
            }
            
            // Simple connection check - try to get own JID
            const myJid = this.whatsapp.user.id;
            
            if (!myJid) {
                throw new Error('Not authenticated');
            }
            
            const latency = Date.now() - start;
            this.lastPong = Date.now();
            this.missedPongs = 0;
            
            // Track ping history
            this.pingHistory.push({ time: Date.now(), latency });
            if (this.pingHistory.length > this.maxHistorySize) {
                this.pingHistory.shift();
            }
            
            // Warning for high latency
            if (latency > 5000) {
                console.log(chalk.yellow(`[HEALTH] ⚠️  High latency: ${latency}ms`));
            }
            
            // Log every 10 pings
            if (this.pingHistory.length % 10 === 0) {
                const avgLatency = Math.floor(
                    this.pingHistory.reduce((sum, p) => sum + p.latency, 0) / this.pingHistory.length
                );
                console.log(chalk.gray(`[HEALTH] 💓 Avg latency: ${avgLatency}ms (last 10 pings)`));
            }
            
            return true;
            
        } catch (error) {
            this.missedPongs++;
            console.log(chalk.red(`[HEALTH] ❌ Ping failed (${this.missedPongs}/3): ${error.message}`));
            
            if (this.missedPongs >= 3) {
                console.log(chalk.red(`[HEALTH] 🚨 Connection dead, forcing reconnect...`));
                if (this.whatsapp && typeof this.whatsapp.end === 'function') {
                    this.whatsapp.end();
                }
            }
            
            return false;
        } finally {
            this.isPinging = false;
        }
    }
    
    start() {
        if (this.checkInterval) {
            console.log(chalk.yellow(`[HEALTH] ⚠️  Health monitor already running`));
            return;
        }
        
        // Ping every 60 seconds
        this.checkInterval = setInterval(() => {
            this.ping().catch(err => {
                console.log(chalk.red(`[HEALTH] Ping interval error: ${err.message}`));
            });
        }, 60000);
        
        console.log(chalk.green(`[HEALTH] 💓 Health monitor started (ping every 60s)`));
    }
    
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log(chalk.gray(`[HEALTH] 🛑 Health monitor stopped`));
        }
    }
    
    getStats() {
        const avgLatency = this.pingHistory.length > 0
            ? Math.floor(this.pingHistory.reduce((sum, p) => sum + p.latency, 0) / this.pingHistory.length)
            : 0;
            
        return {
            lastPing: new Date(this.lastPing).toLocaleTimeString(),
            lastPong: new Date(this.lastPong).toLocaleTimeString(),
            missedPongs: this.missedPongs,
            avgLatency: avgLatency,
            pingCount: this.pingHistory.length,
            isPinging: this.isPinging
        };
    }
}

// ========== 3. IMPROVED AntiSpamSystem METHODS ==========

/*
ADD these methods to your existing AntiSpamSystem class:

// Add to constructor:
constructor() {
    // ... existing code ...
    this.processingTimeout = 30000; // 30 seconds
    this.processingTimestamps = new Map();
    this.autoReleaseTimers = new Map(); // Track timers
}

// Improved startProcessing with auto-cleanup:
startProcessing(userId) {
    this.processingUsers.add(userId);
    this.processingTimestamps.set(userId, Date.now());
    
    // Clear existing timer if any
    if (this.autoReleaseTimers.has(userId)) {
        clearTimeout(this.autoReleaseTimers.get(userId));
    }
    
    // Auto-release after timeout
    const timer = setTimeout(() => {
        if (this.processingUsers.has(userId)) {
            const startTime = this.processingTimestamps.get(userId);
            if (startTime && Date.now() - startTime >= this.processingTimeout) {
                console.log(chalk.yellow(`[SPAM] ⚠️  Auto-releasing stuck user: ${userId.substring(0, 30)}`));
                this.endProcessing(userId);
            }
        }
    }, this.processingTimeout);
    
    this.autoReleaseTimers.set(userId, timer);
}

// Improved endProcessing with timer cleanup:
endProcessing(userId) {
    this.processingUsers.delete(userId);
    this.processingTimestamps.delete(userId);
    
    // Clear auto-release timer
    if (this.autoReleaseTimers.has(userId)) {
        clearTimeout(this.autoReleaseTimers.get(userId));
        this.autoReleaseTimers.delete(userId);
    }
}

// Improved clearStuckUsers:
clearStuckUsers() {
    const now = Date.now();
    let cleared = 0;
    
    for (const [userId, timestamp] of this.processingTimestamps.entries()) {
        if (now - timestamp > this.processingTimeout) {
            this.processingUsers.delete(userId);
            this.processingTimestamps.delete(userId);
            
            // Clear timer
            if (this.autoReleaseTimers.has(userId)) {
                clearTimeout(this.autoReleaseTimers.get(userId));
                this.autoReleaseTimers.delete(userId);
            }
            
            cleared++;
            console.log(chalk.gray(`[SPAM] 🧹 Cleared stuck user: ${userId.substring(0, 30)}`));
        }
    }
    
    if (cleared > 0) {
        console.log(chalk.yellow(`[SPAM] 🧹 Total cleared: ${cleared} stuck users`));
    }
    
    return cleared;
}
*/

// ========== 4. GLOBAL INSTANCES ==========

let botWatchdog = null;
let connectionHealth = null;

// ========== 5. INTEGRATION IN startWhatsapp() ==========

/*
async function startWhatsapp() {
    // ... existing code until makeWASocket ...
    
    const whatsapp = makeWASocket({
        // ... your existing config ...
    });
    
    // ✨ Initialize monitoring systems with error handling
    try {
        botWatchdog = new BotWatchdog(whatsapp);
        botWatchdog.start();
        
        connectionHealth = new ConnectionHealthMonitor(whatsapp);
        connectionHealth.start();
        
        console.log(chalk.green(`[INIT] ✅ Watchdog and health monitor initialized`));
    } catch (error) {
        console.log(chalk.red(`[INIT] ❌ Failed to start monitoring: ${error.message}`));
    }
    
    whatsapp.ev.process(async (events) => {
        // ✨ Record activity on ANY event (safe)
        try {
            if (botWatchdog) {
                botWatchdog.recordActivity();
            }
        } catch (error) {
            // Ignore - don't let this crash message processing
        }
        
        // ... rest of your existing event handlers ...
        
        if (events["messages.upsert"]) {
            // ... in your message processing ...
            
            try {
                // ... your message processing code ...
                
                await handlerWA.handleCommand(processedMessage, whatsapp, localStore, config);
                
                prMsg(processedMessage);
                stats.processed++;
                
                // ✨ Record successful command (safe)
                try {
                    if (botWatchdog) {
                        botWatchdog.recordCommandProcessed();
                    }
                } catch (error) {
                    // Ignore
                }
                
            } catch (e) {
                // ... error handling ...
            } finally {
                // ✨ CRITICAL: Always release user
                try {
                    if (typeof antiSpam !== 'undefined' && antiSpam) {
                        antiSpam.endProcessing(userId);
                    }
                } catch (error) {
                    console.log(chalk.red(`[ERROR] Failed to release user: ${error.message}`));
                }
            }
        }
    });
    
    return whatsapp;
}
*/

// ========== 6. IMPROVED PERIODIC MAINTENANCE ==========

function startPeriodicMaintenance() {
    const maintenanceInterval = setInterval(() => {
        try {
            // Clear stuck users (safe)
            if (typeof antiSpam !== 'undefined' && antiSpam && typeof antiSpam.clearStuckUsers === 'function') {
                antiSpam.clearStuckUsers();
            }
            
            // Force process queue if needed (safe)
            if (typeof messageQueue !== 'undefined' && messageQueue) {
                const queueSize = typeof messageQueue.getQueueSize === 'function' 
                    ? messageQueue.getQueueSize() 
                    : 0;
                const processing = messageQueue.processing || 0;
                
                if (queueSize > 0 && processing === 0) {
                    console.log(chalk.yellow(`[MAINTENANCE] 🔧 Queue has ${queueSize} items but nothing processing, forcing...`));
                    messageQueue.processing = 0;
                    if (typeof messageQueue.process === 'function') {
                        messageQueue.process();
                    }
                }
            }
            
            // Log status occasionally
            if (Math.random() < 0.2) { // 20% chance
                console.log(chalk.gray(`[MAINTENANCE] Status check OK`));
            }
            
        } catch (error) {
            console.log(chalk.red(`[MAINTENANCE] ❌ Error: ${error.message}`));
        }
    }, 60000); // Every minute
    
    return maintenanceInterval;
}

// ========== 7. IMPROVED GRACEFUL SHUTDOWN ==========

async function gracefulShutdown(signal) {
    console.log(chalk.yellow(`\n[SHUTDOWN] 🛑 Received ${signal}...`));

    try {
        // Stop monitoring systems (safe)
        if (botWatchdog) {
            try {
                botWatchdog.stop();
            } catch (error) {
                console.log(chalk.red(`[SHUTDOWN] Failed to stop watchdog: ${error.message}`));
            }
        }
        
        if (connectionHealth) {
            try {
                connectionHealth.stop();
            } catch (error) {
                console.log(chalk.red(`[SHUTDOWN] Failed to stop health monitor: ${error.message}`));
            }
        }
        
        // ... rest of your existing shutdown code ...
        
    } catch (err) {
        console.log(chalk.red(`[SHUTDOWN] ❌ Error: ${err.message}`));
        process.exit(1);
    }
}

// ========== 8. SAFE DEBUG COMMANDS ==========

/*
Add these in your message processing for debugging (remove in production):

if (messageText === '.debug-status') {
    try {
        const status = {
            watchdog: botWatchdog?.getStats() || 'not initialized',
            health: connectionHealth?.getStats() || 'not initialized',
            processingUsers: antiSpam?.processingUsers?.size || 0,
            processingTimestamps: antiSpam?.processingTimestamps?.size || 0,
            queueSize: typeof messageQueue?.getQueueSize === 'function' ? messageQueue.getQueueSize() : 0,
            queueProcessing: messageQueue?.processing || 0,
            cleanupLock: antiSpam?.cleanupLock || false,
            wsState: whatsapp?.ws?.readyState || 'undefined'
        };
        
        await whatsapp.sendMessage(jid, { 
            text: `🔍 Debug Status:\n\n${JSON.stringify(status, null, 2)}` 
        });
    } catch (error) {
        await whatsapp.sendMessage(jid, { text: `❌ Error: ${error.message}` });
    }
}

if (messageText === '.force-wakeup') {
    try {
        if (botWatchdog) {
            await botWatchdog.tryWakeUp();
            await whatsapp.sendMessage(jid, { text: '🔧 Wake up attempted!' });
        } else {
            await whatsapp.sendMessage(jid, { text: '❌ Watchdog not initialized' });
        }
    } catch (error) {
        await whatsapp.sendMessage(jid, { text: `❌ Error: ${error.message}` });
    }
}

if (messageText === '.clear-stuck') {
    try {
        const cleared = antiSpam?.clearStuckUsers ? antiSpam.clearStuckUsers() : 0;
        await whatsapp.sendMessage(jid, { text: `🧹 Cleared ${cleared} stuck users` });
    } catch (error) {
        await whatsapp.sendMessage(jid, { text: `❌ Error: ${error.message}` });
    }
}

if (messageText === '.force-recovery') {
    try {
        if (botWatchdog) {
            await botWatchdog.emergencyRecovery();
            await whatsapp.sendMessage(jid, { text: '🚨 Emergency recovery executed!' });
        } else {
            await whatsapp.sendMessage(jid, { text: '❌ Watchdog not initialized' });
        }
    } catch (error) {
        await whatsapp.sendMessage(jid, { text: `❌ Error: ${error.message}` });
    }
}
*/

// ========== 9. EXPORT ==========

export {
    BotWatchdog,
    ConnectionHealthMonitor,
    botWatchdog,
    connectionHealth,
    startPeriodicMaintenance,
    gracefulShutdown
};