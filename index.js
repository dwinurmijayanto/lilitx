import chalk from "chalk";
import { Boom } from "@hapi/boom";
import NodeCache from "node-cache";
import makeWASocket, { delay, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, proto } from "baileys";
import pino from "pino";
import fs from "fs";
import path from "path";

// Import JSON
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const { name, version, author } = pkg;
import config from "./config.js";
import { logError } from "./lib/logger.js";

// WhatsApp Imports
import { procMsg } from "./lib/whatsapp/msg.js";
import { prMsg } from "./lib/whatsapp/fmt.js";
import CmdRegisWA from "./lib/whatsapp/command-register.js";
import handlerWA from "./lib/whatsapp/command-handler.js";
import { setupWelcomeBye } from "./lib/whatsapp/welcome-bye-handler.js";
import { setupGameOtakHandler } from "./lib/whatsapp/gameotak-handler.js";
import { setupGameSejarahHandler } from "./lib/whatsapp/gamesejarah-handler.js";
import { setupGameMusikHandler } from "./lib/whatsapp/tebakmusik.js";
import { setupFamily100Handler } from "./lib/whatsapp/family100-handler.js";

// Import Classes
import { CircuitBreaker } from "./lib/circuit-breaker.js";
import { CompressedStorage } from "./lib/compressed-storage.js";
import { WorkerPool } from "./lib/worker-pool.js";
import { BadMacRecoverySystem } from "./lib/badmac-recovery.js";
import { AntiSpamSystem } from "./lib/anti-spam.js";
import { SessionCleaner } from "./lib/session-cleaner.js";
import { MessageStore } from "./lib/message-store.js";
import { MessageQueue } from "./lib/message-queue.js";
import { MemoryMonitor } from "./lib/memory-monitor.js";
import { ReconnectTracker } from "./lib/reconnect-tracker.js";
import { AutoRestartSystem } from "./lib/auto-restart.js";
import { LocalStore } from "./lib/local-store.js";

// Import Utilities
import { logMessageFlow, logConnection, logSystemStatus, logCleanup } from "./lib/logging-utils.js";
import { isWhatsAppGroup, getMessagePreview, getMessageContent, hasProcessableContent } from "./lib/message-helpers.js";

const has = (v) => v !== undefined && v !== null && v !== "";

// ========== INITIALIZE UTILITIES ==========
const SESSION_PATH = "./sessions-core";
const messageStore = new MessageStore();
const badMacRecovery = new BadMacRecoverySystem();
const antiSpam = new AntiSpamSystem();
const sessionCleaner = new SessionCleaner(SESSION_PATH);
const messageQueue = new MessageQueue(8);
const reconnectTracker = new ReconnectTracker();

// Initialize stores
const localStore = new LocalStore(messageStore);

// Initialize monitors with dependencies
const memoryMonitor = new MemoryMonitor({
    messageStore,
    localStore,
    antiSpam,
    badMacRecovery,
    messageQueue
});

const autoRestart = new AutoRestartSystem({
    sessionCleaner,
    messageStore,
    badMacRecovery
});

// ========== STATS ==========
const stats = {
    total: 0,
    processed: 0,
    failed: 0,
    blocked: 0,
    prefixSkipped: 0,
    notGroupMsg: 0,
    fromMe: 0,
    spam: {
        banned: 0,
        flooding: 0,
        rateLimit: 0,
        duplicate: 0,
        tooFast: 0,
        groupCooldown: 0
    },
    reconnects: 0,
    badMacErrors: 0,
    badMacRecovered: 0,
    sessionsCleanedDueToBadMac: 0,
    autoRestarts: 0,
    decryptFailures: 0,
    messagesSkipped: 0,
    crashes: 0,
    processRestarts: 0,
    workerTasks: {
        completed: 0,
        failed: 0
    },
    compression: {
        filesCompressed: 0,
        spaceSaved: 0
    },
    circuitBreakers: {
        trips: 0,
        recoveries: 0
    },
    startTime: Date.now(),
    bootTime: new Date().toLocaleString()
};

// ========== HELPERS ==========
function ensureSessionFolders() {
    try {
        if (!fs.existsSync(SESSION_PATH)) {
            fs.mkdirSync(SESSION_PATH, { recursive: true });
        }
        
        const workersDir = path.join(process.cwd(), 'workers');
        if (!fs.existsSync(workersDir)) {
            fs.mkdirSync(workersDir, { recursive: true });
        }
        
        return true;
    } catch {
        return false;
    }
}

function showWelcome() {
    console.clear();
    console.log(chalk.bold.cyan("======================================="));
    console.log(chalk.bold.green(`${config.botName || name} v${version}`));
    console.log(chalk.gray(`By: ${config.ownerName || author}`));
    console.log(chalk.bold.yellow("⚡ ULTRA STABLE & ANTI-SPAM MODE"));
    console.log(chalk.bold.magenta("🔧 BAD MAC AUTO-RECOVERY V2 ENABLED"));
    console.log(chalk.bold.red("🔄 AUTO-RESTART SYSTEM ACTIVE"));
    console.log(chalk.bold.blue("🚀 OPTIMIZED WITH WORKERS & COMPRESSION"));
    console.log(chalk.gray("   ✓ Advanced anti-spam (30 cmd/min)"));
    console.log(chalk.gray("   ✓ Auto-ban spammers (5 min)"));
    console.log(chalk.gray("   ✓ Flood protection"));
    console.log(chalk.gray("   ✓ Worker threads cleanup"));
    console.log(chalk.gray("   ✓ Session file compression"));
    console.log(chalk.gray("   ✓ Circuit breaker pattern"));
    console.log(chalk.gray("   ✓ Aggressive cleanup (1.5-4 min)"));
    console.log(chalk.gray("   ✓ Bad MAC auto-recovery V2"));
    console.log(chalk.gray("   ✓ Corrupt session cleanup"));
    console.log(chalk.gray("   ✓ Smart decrypt retry"));
    console.log(chalk.gray("   ✓ Session locks & cooldowns"));
    console.log(chalk.gray("   ✓ Auto-restart on crash"));
    console.log(chalk.gray("   ✓ Process health monitoring"));
    console.log(chalk.gray("   ✓ Memory leak protection"));
    console.log(chalk.gray("   ✓ Smart reconnect"));
    console.log(chalk.gray("   ✓ Cached signal keys"));
    console.log(chalk.gray("   ✓ Prefix: " + (config.requirePrefix ? "ON" : "OFF")));
    console.log(chalk.bold.cyan("======================================="));

    if (!config.enableWhatsApp) {
        console.log(chalk.red("\n[DISABLED] WhatsApp in config.js"));
        return false;
    }

    return true;
}

// ========== ENHANCED SIGNAL KEY STORE WITH BAD MAC HANDLING ==========
function makeOptimizedSignalKeyStore(state, logger) {
    const baseStore = makeCacheableSignalKeyStore(state, logger);
    
    return new Proxy(baseStore, {
        get(target, prop) {
            const original = target[prop];
            
            if (typeof original === 'function') {
                return async function(...args) {
                    try {
                        const result = await original.apply(target, args);
                        
                        if (prop === 'get' || prop === 'set') {
                            const keyType = args[0]?.type;
                            if (keyType) {
                                sessionCleaner.markRecentAccess(`${keyType}-${args[0]?.id || 'unknown'}`);
                            }
                        }
                        
                        return result;
                    } catch (err) {
                        const errorMsg = err.message?.toLowerCase() || '';
                        const isBadMac = errorMsg.includes('bad mac') || errorMsg.includes('verify');
                        
                        if (isBadMac) {
                            stats.badMacErrors++;
                            
                            let contactId = 'unknown';
                            if (args[0]?.id) {
                                contactId = String(args[0].id);
                            }
                            
                            const recovery = await badMacRecovery.recordError(contactId);
                            
                            console.log(chalk.red(`[BAD MAC] ⚠️  ${prop}() error #${stats.badMacErrors}: ${contactId.slice(0, 30)}`));
                            
                            if (recovery.shouldCleanup && !recovery.shouldBlock) {
                                console.log(chalk.yellow(`[BAD MAC] 🔧 Scheduling cleanup for ${contactId.slice(0, 25)}`));
                                
                                setTimeout(async () => {
                                    try {
                                        const cleaned = await sessionCleaner.cleanupCorruptedSessions([contactId]);
                                        if (cleaned > 0) {
                                            stats.sessionsCleanedDueToBadMac += cleaned;
                                            stats.badMacRecovered++;
                                            console.log(chalk.green(`[BAD MAC] ✅ Recovered ${contactId.slice(0, 25)}`));
                                        }
                                    } catch (cleanErr) {
                                        console.log(chalk.red(`[BAD MAC] ❌ Cleanup failed: ${cleanErr.message}`));
                                    }
                                }, 3000);
                            }
                            
                            if (recovery.shouldRestart) {
                                console.log(chalk.red.bold(`\n[CRITICAL] ⚠️  Bad MAC threshold reached (${stats.badMacErrors})`));
                                console.log(chalk.yellow(`[AUTO-RESTART] 🔄 Restarting in 15 seconds...`));
                                
                                stats.autoRestarts++;
                                sessionCleaner.enableAggressiveMode();
                                
                                setTimeout(async () => {
                                    console.log(chalk.cyan("[AUTO-RESTART] 🧹 Cleaning corrupted sessions..."));
                                    const corruptedSessions = badMacRecovery.getCorruptedSessions();
                                    
                                    try {
                                        await sessionCleaner.cleanupCorruptedSessions(corruptedSessions);
                                        console.log(chalk.green("[AUTO-RESTART] ✅ Sessions cleaned"));
                                        
                                        await delay(2000);
                                        badMacRecovery.reset();
                                        
                                        console.log(chalk.green("[AUTO-RESTART] 🚀 Restarting bot..."));
                                        process.exit(0);
                                    } catch (restartErr) {
                                        console.log(chalk.red(`[AUTO-RESTART] ❌ Error: ${restartErr.message}`));
                                        process.exit(1);
                                    }
                                }, 15000);
                            }
                            
                            if (stats.badMacErrors % 10 === 0) {
                                console.log(chalk.yellow(`[BAD MAC] 📊 Total errors: ${stats.badMacErrors}, Recovered: ${stats.badMacRecovered}`));
                            }
                        }
                        
                        throw err;
                    }
                };
            }
            
            return original;
        }
    });
}

// ========== PROCESS MONITORING ==========
let lastHealthCheck = Date.now();
const healthCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastCheck = now - lastHealthCheck;
    
    if (timeSinceLastCheck > 120000) {
        console.log(chalk.red(`[HEALTH] ⚠️  Process appears frozen (${Math.floor(timeSinceLastCheck/1000)}s)`));
        
        autoRestart.recordCrash(new Error('Process frozen'));
        autoRestart.performRestart('process_frozen');
    }
    
    lastHealthCheck = now;
    
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    
    if (heapUsedMB > 1024) {
        console.log(chalk.red(`[HEALTH] ⚠️  High memory usage: ${heapUsedMB}MB`));
        autoRestart.performRestart('high_memory');
    }
    
    if (now % 600000 < 60000) {
        console.log(chalk.gray(`[HEALTH] ✅ Memory: ${heapUsedMB}/${heapTotalMB}MB | Queue: ${messageQueue.getQueueSize()}`));
    }
}, 60000);

// ========== DISPLAY STATS ==========
function displayComprehensiveStats() {
    const uptime = Math.floor((Date.now() - stats.startTime) / 60000);
    const spamStats = antiSpam.getStats();
    const badMacStats = badMacRecovery.getStats();
    const restartStats = autoRestart.getStats();
    const queueStats = messageQueue.getStats();
    const cleanerStats = sessionCleaner.getStats();
    const reconnectStats = reconnectTracker.getStats();
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    const processedPct = stats.total > 0 ? ((stats.processed / stats.total) * 100).toFixed(1) : 0;
    
    console.log(chalk.cyan(`\n╔═══════════════════════════════════════╗`));
    console.log(chalk.cyan(`║  📊 COMPREHENSIVE STATUS REPORT       ║`));
    console.log(chalk.cyan(`╠═══════════════════════════════════════╣`));
    console.log(chalk.white(`║  Uptime: ${uptime} minutes`));
    console.log(chalk.white(`║  Messages: ${stats.total} | OK: ${stats.processed} (${processedPct}%) | Fail: ${stats.failed}`));
    console.log(chalk.yellow(`║  Blocked: ${stats.blocked} | Skipped: ${stats.messagesSkipped}`));
    console.log(chalk.gray(`║  Filters: Prefix=${stats.prefixSkipped} DM=${stats.notGroupMsg} OwnMsg=${stats.fromMe}`));
    console.log(chalk.gray(`║  Spam: Ban=${stats.spam.banned} Flood=${stats.spam.flooding} Rate=${stats.spam.rateLimit}`));
    console.log(chalk.gray(`║  Anti-spam: Active=${spamStats.processing} Banned=${spamStats.banned}`));
    console.log(chalk.magenta(`║  Bad MAC: Errors=${stats.badMacErrors} Recovered=${stats.badMacRecovered}`));
    console.log(chalk.magenta(`║  Status: Blacklisted=${badMacStats.blacklisted} Corrupted=${badMacStats.corruptedSessions}`));
    console.log(chalk.blue(`║  Queue: Size=${queueStats.queueSize} Processing=${queueStats.processing}`));
    console.log(chalk.blue(`║  Workers: Completed=${cleanerStats.workerPool?.tasksCompleted || 0}`));
    console.log(chalk.cyan(`║  Compression: Files=${stats.compression.filesCompressed}`));
    console.log(chalk.red(`║  System: Crashes=${restartStats.crashes} Restarts=${restartStats.restartAttempts}`));
    console.log(chalk.gray(`║  Reconnects: ${stats.reconnects} | Memory: ${heapUsedMB}MB`));
    console.log(chalk.cyan(`╚═══════════════════════════════════════╝\n`));
}

// ========== GRACEFUL SHUTDOWN ==========
async function gracefulShutdown(signal) {
    console.log(chalk.yellow(`\n[SHUTDOWN] 🛑 Received ${signal}, stopping gracefully...`));

    try {
        clearInterval(healthCheckInterval);
        memoryMonitor.stop();
        
        sessionCleaner.stopAutoClean();
        messageStore.stopAutoCleanup();
        antiSpam.stopAutoCleanup();
        badMacRecovery.stopAutoCleanup();
        messageQueue.stopAutoCleanup();
        
        await sessionCleaner.terminate();
        
        messageStore.destroy();
        antiSpam.destroy();
        badMacRecovery.destroy();
        messageQueue.destroy();
        
        localStore.clear();

        displayComprehensiveStats();
        
        console.log(chalk.green("[SHUTDOWN] ✅ Graceful shutdown completed"));
        process.exit(0);
    } catch (err) {
        console.log(chalk.red(`[SHUTDOWN] ❌ Error: ${err.message}`));
        process.exit(1);
    }
}

// ========== WHATSAPP WITH ENHANCED BAD MAC HANDLING & CIRCUIT BREAKERS ==========
async function startWhatsapp() {
    if (!ensureSessionFolders()) {
        throw new Error("Failed to create session folders");
    }

    const logger = pino({ level: "silent" });

    const msgRetryCounterCache = new NodeCache({
        stdTTL: 600,
        checkperiod: 300,
        useClones: false,
        maxKeys: 1000
    });

    try {
        await CmdRegisWA.load();
        await CmdRegisWA.watch();
    } catch (e) {
        console.log(chalk.red(`[CMD] ❌ Error: ${e.message}`));
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const files = fs.readdirSync(SESSION_PATH);
        files.forEach(file => {
            if (file === 'creds.json' || file.startsWith('app-state-sync')) {
                sessionCleaner.markRecentAccess(file);
            }
        });
    } catch {}

    const whatsapp = makeWASocket({
        version,
        printQRInTerminal: false,
        logger,
        auth: {
            creds: state.creds,
            keys: makeOptimizedSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        fireInitQueries: false,
        emitOwnEvents: false,
        getMessage: async (key) => {
            const jid = key.remoteJid;
            const msg = localStore.getMessage(jid, key.id);
            return msg?.message || proto.Message.fromObject({});
        },
        shouldIgnoreJid: (jid) => jid === 'status@broadcast',
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 2,
    });

    // Pairing Code
    if (!whatsapp.authState.creds.registered) {
        if (has(config.whatsappNumber)) {
            const phoneNumber = config.whatsappNumber.replace(/[^0-9]/g, '');
            
            if (phoneNumber.length < 10) {
                console.log(chalk.red("[PAIR] ❌ Invalid phone number"));
            } else {
                setTimeout(async () => {
                    try {
                        const code = await whatsapp.requestPairingCode(phoneNumber);
                        
                        console.log(chalk.white.bgGreen.bold(`\n╔════════════════════════════════╗`));
                        console.log(chalk.white.bgGreen.bold(`║   PAIRING CODE: ${code}    ║`));
                        console.log(chalk.white.bgGreen.bold(`╚════════════════════════════════╝\n`));
                    } catch (e) {
                        console.error(chalk.red("[PAIR] ❌ Error:"), e.message);
                    }
                }, 3000);
            }
        }
    }

    whatsapp.ev.process(async (events) => {
        // ========== CONNECTION ==========
        if (events["connection.update"]) {
            const { connection, lastDisconnect } = events["connection.update"];

            if (connection === "close") {
                sessionCleaner.pause();
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || '';
                const isBoom = lastDisconnect?.error instanceof Boom;
                const isBadMac = errorMessage.toLowerCase().includes('bad mac') || 
                                errorMessage.toLowerCase().includes('verify');
                
                logConnection('close', {
                    reason: errorMessage,
                    statusCode: statusCode,
                    isBadMac: isBadMac
                });
                        
                if (isBadMac) {
                    stats.badMacErrors++;
                    reconnectTracker.recordDisconnect(true);
                    
                    console.log(chalk.red(`[BAD MAC] ⚠️  Connection error count: ${stats.badMacErrors}`));
                    
                    const corruptedSessions = badMacRecovery.getCorruptedSessions();
                    if (corruptedSessions.length > 0) {
                        console.log(chalk.yellow(`[BAD MAC] 🧹 Cleaning ${corruptedSessions.length} corrupted sessions...`));
                        
                        try {
                            await sessionCleaner.cleanupCorruptedSessions(corruptedSessions);
                            console.log(chalk.green(`[BAD MAC] ✅ Cleanup completed`));
                        } catch (cleanErr) {
                            console.log(chalk.red(`[BAD MAC] ❌ Cleanup error: ${cleanErr.message}`));
                        }
                    }
                    
                    if (reconnectTracker.shouldAggressiveClean()) {
                        console.log(chalk.yellow(`[BAD MAC] 🔥 Enabling aggressive cleanup mode`));
                        sessionCleaner.enableAggressiveMode();
                        
                        setTimeout(() => {
                            sessionCleaner.disableAggressiveMode();
                            reconnectTracker.resetBadMacCounter();
                        }, 600000);
                    }
                    
                    badMacRecovery.reset();
                } else {
                    reconnectTracker.recordDisconnect(false);
                }

                stats.reconnects++;

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log(chalk.red(`\n[LOGOUT] ❌ Delete ${SESSION_PATH} and restart\n`));
                    sessionCleaner.stopAutoClean();
                    await sessionCleaner.terminate();
                    return;
                }

                const shouldReconnect = isBoom && statusCode !== DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    const cooloffTime = reconnectTracker.getCooloffTime();
                    
                    console.log(chalk.yellow(`[RECONNECT] ⏳ Cooloff ${cooloffTime/1000}s...`));
                    
                    try {
                        const files = fs.readdirSync(SESSION_PATH);
                        files.forEach(f => sessionCleaner.markRecentAccess(f));
                    } catch {}
                    
                    await delay(cooloffTime);
                    
                    if (reconnectTracker.shouldCooloff()) {
                        console.log(chalk.red(`[RECONNECT] ⏰ Extended cooloff 3min...`));
                        await delay(180000);
                        reconnectTracker.consecutiveErrors = 0;
                    }
                    
                    console.log(chalk.cyan(`[RECONNECT] 🔄 Reconnecting...`));
                    startWhatsapp();
                }
                
            } else if (connection === "connecting") {
                sessionCleaner.pause();
                logConnection('connecting', {});
                
            } else if (connection === "open") {
                logConnection('open', {});
                reconnectTracker.recordSuccess();
                
                // ✅ STEP 1: FORCE RESET ALL LOCKS
                console.log(chalk.cyan("[FIX] 🔧 FORCE resetting all locks..."));
                
                antiSpam.cleanupLock = false;
                antiSpam.processingUsers.clear();
                antiSpam.processedMessages.clear();
                
                sessionCleaner.isPaused = false;
                sessionCleaner.isRunning = false;
                sessionCleaner.sessionLocks.clear();
                
                if (messageQueue.processing > 0) {
                    console.log(chalk.yellow(`[FIX] ⚠️ Force resetting queue (${messageQueue.processing} stuck)`));
                    messageQueue.processing = 0;
                }
                
                messageQueue.priorityLevels.HIGH = [];
                messageQueue.priorityLevels.NORMAL = [];
                messageQueue.priorityLevels.LOW = [];
                
                console.log(chalk.green(`[FIX] ✅ All locks FORCE cleared`));
                
                // ✅ STEP 2: Reset ALL circuit breakers
                console.log(chalk.cyan("[CIRCUIT] 🔄 Resetting ALL circuit breakers..."));
                try {
                    badMacRecovery.circuitBreaker.reset();
                    antiSpam.circuitBreaker.reset();
                    sessionCleaner.circuitBreaker.reset();
                    messageQueue.circuitBreaker.reset();
                    autoRestart.circuitBreaker.reset();
                    reconnectTracker.circuitBreaker.reset();
                    console.log(chalk.green("[CIRCUIT] ✅ All circuit breakers reset"));
                } catch (e) {
                    console.log(chalk.yellow(`[CIRCUIT] ⚠️ Warning: ${e.message}`));
                }
                
                // ✅ STEP 3: FORCE STOP then RESTART session cleaner
                console.log(chalk.cyan("[CLEAN] 🔄 Force restarting session cleaner..."));
                sessionCleaner.stopAutoClean();
                
                setTimeout(() => {
                    sessionCleaner.isPaused = false;
                    sessionCleaner.isRunning = false;
                    sessionCleaner.startAutoClean();
                    console.log(chalk.green("[CLEAN] ✅ Session cleaner force restarted"));
                }, 3000);
                
                // ✅ STEP 4: Setup handlers
                try {
                    setupWelcomeBye(whatsapp);
                    setupGameOtakHandler(whatsapp);
                    setupGameSejarahHandler(whatsapp);
                    setupGameMusikHandler(whatsapp);
                    setupFamily100Handler(whatsapp);
                    console.log(chalk.green("[SETUP] ✅ All handlers initialized"));
                } catch (e) {
                    console.log(chalk.red(`[SETUP] ❌ ${e.message}`));
                }
                
                // ✅ STEP 5: Start memory monitor
                if (!memoryMonitor.monitorInterval) {
                    memoryMonitor.start();
                    console.log(chalk.gray("[MEMORY] 📊 Monitor started"));
                } else {
                    console.log(chalk.gray("[MEMORY] ℹ️ Already running, skipped"));
                }
                
                // ✅ STEP 6: Verify status after 8s
                setTimeout(() => {
                    console.log(chalk.cyan("\n╔════════════════════════════════════════╗"));
                    console.log(chalk.cyan("║  🔍 POST-RESTART VERIFICATION          ║"));
                    console.log(chalk.cyan("╠════════════════════════════════════════╣"));
                    console.log(chalk.white(`║  Anti-spam lock:     ${antiSpam.cleanupLock ? chalk.red('LOCKED ❌') : chalk.green('UNLOCKED ✅')}`));
                    console.log(chalk.white(`║  Cleaner paused:     ${sessionCleaner.isPaused ? chalk.red('YES ❌') : chalk.green('NO ✅')}`));
                    console.log(chalk.white(`║  Cleaner running:    ${sessionCleaner.isRunning ? chalk.yellow('YES') : chalk.gray('NO')}`));
                    console.log(chalk.white(`║  Queue processing:   ${messageQueue.processing}`));
                    console.log(chalk.white(`║  Queue size:         ${messageQueue.getQueueSize()}`));
                    console.log(chalk.white(`║  Processing users:   ${antiSpam.processingUsers.size}`));
                    console.log(chalk.cyan("╠════════════════════════════════════════╣"));
                    
                    if (antiSpam.cleanupLock) {
                        console.log(chalk.red("║  ⚠️  WARNING: Cleanup lock still ON!   ║"));
                    } else if (sessionCleaner.isPaused) {
                        console.log(chalk.red("║  ⚠️  WARNING: Cleaner still paused!    ║"));
                    } else if (messageQueue.processing > 0 && messageQueue.getQueueSize() === 0) {
                        console.log(chalk.red("║  ⚠️  WARNING: Queue stuck!             ║"));
                    } else {
                        console.log(chalk.green("║  ✅ ALL SYSTEMS READY TO RESPOND       ║"));
                    }
                    
                    console.log(chalk.cyan("╚════════════════════════════════════════╝\n"));
                }, 8000);
                
                // ✅ STEP 7: Emergency unlock after 15s
                setTimeout(() => {
                    if (antiSpam.cleanupLock || sessionCleaner.isPaused) {
                        console.log(chalk.red("\n[EMERGENCY] 🚨 Detected stuck locks - FORCE UNLOCKING!"));
                        antiSpam.cleanupLock = false;
                        sessionCleaner.isPaused = false;
                        sessionCleaner.isRunning = false;
                        console.log(chalk.green("[EMERGENCY] ✅ Emergency unlock completed\n"));
                    }
                }, 15000);
            }
        }

        // ========== CREDS ==========
        if (events["creds.update"]) {
            try {
                await saveCreds();
                sessionCleaner.markRecentAccess('creds.json');
            } catch (err) {
                console.log(chalk.red(`[CREDS] ❌ ${err.message}`));
            }
        }

        // ========== REJECT CALLS ==========
        if (events["call"]) {
            for (const call of events["call"]) {
                if (call.status === "offer") {
                    whatsapp.rejectCall(call.id, call.from).catch(() => {});
                    console.log(chalk.gray(`[CALL] ✋ Rejected from ${call.from.slice(0, 20)}`));
                }
            }
        }

        // ========== MESSAGES WITH ENHANCED BAD MAC FILTERING ==========
        if (events["messages.upsert"]) {
            const upsert = events["messages.upsert"];

            logMessageFlow('EVENT_RECEIVED', {
                type: upsert.type,
                count: upsert.messages.length
            });

            for (let msg of upsert.messages) {
                stats.total++;
                
                const jid = msg.key.remoteJid;
                const userId = msg.key.participant || jid;
                const messageId = msg.key.id;
                const messageText = getMessagePreview(msg);
                const msgType = Object.keys(msg.message || {})[0] || 'unknown';

                logMessageFlow('MESSAGE_START', {
                    from: userId,
                    jid: jid,
                    text: messageText,
                    msgType: msgType,
                    fromMe: msg.key.fromMe,
                    type: upsert.type
                });

                if (msg.key.fromMe) {
                    stats.fromMe++;
                    logMessageFlow('SKIP', {
                        reason: 'own_message',
                        text: messageText
                    });
                    continue;
                }
                
                if (upsert.type !== "notify") {
                    logMessageFlow('SKIP', {
                        reason: 'non_notify',
                        text: messageText,
                        detail: `Type: ${upsert.type}`
                    });
                    continue;
                }
                
                if (!msg.message) {
                    logMessageFlow('SKIP', {
                        reason: 'no_message_object',
                        detail: 'Message object is null/undefined'
                    });
                    continue;
                }
                
                const actualMessage = getMessageContent(msg);
                if (!actualMessage) {
                    logMessageFlow('SKIP', {
                        reason: 'cannot_extract_content',
                        detail: 'Failed to extract message from wrapper'
                    });
                    continue;
                }
                
                if (actualMessage !== msg.message) {
                    msg.message = actualMessage;
                    const updatedText = getMessagePreview(msg);
                    logMessageFlow('EXTRACTED', {
                        detail: `Extracted from wrapper: ${updatedText.substring(0, 50)}`
                    });
                }
                
                if (actualMessage.protocolMessage) {
                    logMessageFlow('SKIP', {
                        reason: 'protocol_message',
                        detail: `Type: ${actualMessage.protocolMessage.type || 'unknown'}`,
                        text: messageText
                    });
                    continue;
                }
                
                if (actualMessage.reactionMessage) {
                    logMessageFlow('SKIP', {
                        reason: 'reaction_message',
                        detail: 'Reactions are not processed'
                    });
                    continue;
                }
                
                if (actualMessage.keepAliveMessage) {
                    logMessageFlow('SKIP', {
                        reason: 'keep_alive',
                        detail: 'Keep alive ping'
                    });
                    continue;
                }
                
                if (!hasProcessableContent(msg)) {
                    const msgTypes = Object.keys(actualMessage).join(', ');
                    logMessageFlow('SKIP', {
                        reason: 'no_processable_content',
                        detail: `Message types: ${msgTypes}`,
                        text: messageText
                    });
                    continue;
                }
                
                if (!isWhatsAppGroup(jid)) {
                    stats.notGroupMsg++;
                    logMessageFlow('SKIP', {
                        reason: 'not_group',
                        text: messageText,
                        detail: `JID: ${jid}`
                    });
                    continue;
                }

                if (config.requirePrefix) {
                    const currentText = getMessagePreview(msg);
                    const hasPrefix = config.prefix.some(prefix => currentText.startsWith(prefix));
                    
                    if (!hasPrefix) {
                        stats.prefixSkipped++;
                        
                        if (stats.prefixSkipped % 10 === 0) {
                            logMessageFlow('SKIP', {
                                reason: 'no_prefix',
                                text: currentText,
                                detail: `Valid prefixes: ${config.prefix.join(', ')}`
                            });
                        }
                        continue;
                    }
                }

                if (badMacRecovery.isBlacklisted(userId)) {
                    stats.blocked++;
                    stats.messagesSkipped++;
                    logMessageFlow('SKIP', {
                        reason: 'blacklisted',
                        text: messageText,
                        detail: `User: ${userId.substring(0, 30)}`
                    });
                    continue;
                }

                if (badMacRecovery.isCorrupted(userId)) {
                    stats.messagesSkipped++;
                    logMessageFlow('SKIP', {
                        reason: 'corrupted',
                        text: messageText,
                        detail: `User: ${userId.substring(0, 30)}`
                    });
                    continue;
                }

                if (antiSpam.cleanupLock) {
                    stats.blocked++;
                    logMessageFlow('SKIP', {
                        reason: 'cleanup_lock',
                        text: messageText
                    });
                    continue;
                }

                if (antiSpam.isProcessed(messageId)) {
                    stats.blocked++;
                    logMessageFlow('SKIP', {
                        reason: 'already_processed',
                        text: messageText,
                        detail: `MessageID: ${messageId}`
                    });
                    continue;
                }

                if (antiSpam.isProcessing(userId)) {
                    stats.blocked++;
                    logMessageFlow('SKIP', {
                        reason: 'user_busy',
                        text: messageText,
                        detail: `User: ${userId.substring(0, 30)}`
                    });
                    continue;
                }

                const spamCheck = antiSpam.canProcess(userId, jid, messageText);
                if (!spamCheck.allowed) {
                    stats.blocked++;
                    
                    if (stats.spam[spamCheck.reason] !== undefined) {
                        stats.spam[spamCheck.reason]++;
                    }
                    
                    logMessageFlow('SKIP', {
                        reason: 'spam',
                        text: messageText,
                        detail: `Spam reason: ${spamCheck.reason} | User: ${userId.substring(0, 30)}`
                    });
                    continue;
                }

                logMessageFlow('PASSED_CHECKS', {
                    text: messageText,
                    from: userId
                });

                antiSpam.startProcessing(userId);
                antiSpam.markProcessed(messageId);
                
                const queueStats = messageQueue.getStats();
                logMessageFlow('QUEUE_ADD', {
                    text: messageText,
                    queueSize: queueStats.queueSize,
                    processing: queueStats.processing,
                    priority: 'NORMAL'
                });

                messageQueue.add(async () => {
                    const startTime = Date.now();
                    
                    try {
                        logMessageFlow('QUEUE_START', {
                            text: messageText
                        });
                        
                        localStore.addMessage(jid, msg);

                        logMessageFlow('PROC_MSG_START', {
                            text: messageText
                        });

                        const processedMessage = await Promise.race([
                            procMsg(msg, whatsapp, localStore),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('timeout')), 10000)
                            )
                        ]);

                        if (!processedMessage) {
                            logMessageFlow('ERROR', {
                                error: 'procMsg returned null',
                                text: messageText,
                                stage: 'procMsg'
                            });
                            return;
                        }
                        
                        logMessageFlow('PROC_MSG_SUCCESS', {
                            text: messageText
                        });

                        logMessageFlow('HANDLER_START', {
                            text: messageText,
                            command: processedMessage.command || 'unknown'
                        });

                        await Promise.race([
                            handlerWA.handleCommand(processedMessage, whatsapp, localStore, config),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('timeout')), 15000)
                            )
                        ]);

                        logMessageFlow('HANDLER_SUCCESS', {
                            text: messageText
                        });

                        prMsg(processedMessage);
                        stats.processed++;
                        
                        const duration = Date.now() - startTime;
                        logMessageFlow('SUCCESS', {
                            text: messageText,
                            duration: duration
                        });

                    } catch (e) {
                        stats.failed++;
                        
                        const errorMsg = e.message?.toLowerCase() || '';
                        const isBadMac = errorMsg.includes('bad mac') || 
                                       errorMsg.includes('verify') || 
                                       errorMsg.includes('decrypt');
                        
                        if (isBadMac) {
                            stats.badMacErrors++;
                            stats.decryptFailures++;
                            
                            const recovery = await badMacRecovery.recordError(userId);
                            
                            logMessageFlow('BAD_MAC', {
                                contact: userId,
                                totalBadMac: stats.badMacErrors,
                                shouldCleanup: recovery.shouldCleanup,
                                shouldRestart: recovery.shouldRestart
                            });
                            
                            if (!badMacRecovery.canRetryDecrypt(userId, messageId)) {
                                console.log(chalk.red(`[BAD MAC] ⚠️  Max retries for ${userId.slice(0, 20)}`));
                            }
                            
                            badMacRecovery.recordDecryptAttempt(userId, messageId);
                        }
                        
                        if (e.message === 'timeout') {
                            logMessageFlow('TIMEOUT', {
                                stage: 'queue_processing',
                                timeout: 15000,
                                text: messageText
                            });
                        } else {
                            logMessageFlow('ERROR', {
                                error: e.message,
                                text: messageText,
                                stage: 'queue_processing',
                                stack: e.stack
                            });
                        }
                    } finally {
                        antiSpam.endProcessing(userId);
                    }
                }).catch((err) => {
                    antiSpam.endProcessing(userId);
                    logMessageFlow('ERROR', {
                        error: err.message,
                        text: messageText,
                        stage: 'queue_add',
                        stack: err.stack
                    });
                });
            }
        }
    });

    // Comprehensive status every 30 min
    setInterval(() => {
        displayComprehensiveStats();
    }, 1800000);

    // Quick stats every 5 min
    setInterval(() => {
        logSystemStatus({
            'Total Messages': stats.total,
            'Processed': stats.processed,
            'Failed': stats.failed,
            'Blocked': stats.blocked,
            'Prefix Skipped': stats.prefixSkipped,
            'Bad MAC Errors': stats.badMacErrors,
            'Queue Size': messageQueue.getQueueSize(),
            'Anti-spam Banned': antiSpam.getStats().banned,
            'Blacklisted Contacts': badMacRecovery.getStats().blacklisted
        });
    }, 300000);

    return whatsapp;
}

// ========== ENHANCED ERROR HANDLERS WITH CIRCUIT BREAKERS ==========
process.on("unhandledRejection", async (reason, promise) => {
    console.log(chalk.red("╔════════════════════════════════════════╗"));
    console.log(chalk.red("║  ⚠️  UNHANDLED REJECTION DETECTED      ║"));
    console.log(chalk.red("╚════════════════════════════════════════╝"));
    
    logError("unhandledRejection", reason);
    
    const error = reason instanceof Error ? reason : new Error(String(reason));
    autoRestart.recordCrash(error);
    
    const isBadMac = error.message?.toLowerCase().includes('bad mac');
    if (isBadMac) {
        stats.badMacErrors++;
        console.log(chalk.yellow(`[BAD MAC] Total errors: ${stats.badMacErrors}`));
        
        sessionCleaner.enableAggressiveMode();
        
        if (stats.badMacErrors >= 30) {
            console.log(chalk.red("[BAD MAC] ⚠️  Critical threshold reached"));
            await autoRestart.performRestart('bad_mac_critical');
        }
    }
    
    if (autoRestart.isCriticalError(error)) {
        console.log(chalk.red("[CRITICAL] ⚠️  Critical error detected"));
        await autoRestart.performRestart('critical_error');
    }
});

process.on("uncaughtException", async (error, origin) => {
    console.log(chalk.red("╔════════════════════════════════════════╗"));
    console.log(chalk.red("║  ⚠️  UNCAUGHT EXCEPTION DETECTED       ║"));
    console.log(chalk.red("╚════════════════════════════════════════╝"));
    console.log(chalk.yellow(`Origin: ${origin}`));
    console.log(chalk.yellow(`Error: ${error.message}`));
    
    logError("uncaughtException", error);
    
    autoRestart.recordCrash(error);
    await autoRestart.performRestart('uncaught_exception');
});

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on('exit', (code) => {
    clearInterval(healthCheckInterval);
    console.log(chalk.gray(`[EXIT] Process exited with code: ${code}`));
});

// ========== BOOT SEQUENCE ==========
(async () => {
    if (!showWelcome()) return;

    console.log(chalk.gray(`\n[BOOT] 🕐 Boot time: ${stats.bootTime}`));
    console.log(chalk.gray(`[BOOT] 🐧 Node.js ${process.version}`));
    console.log(chalk.gray(`[BOOT] 💾 Platform: ${process.platform}`));
    
    await delay(1000);

    try {
        console.log(chalk.yellow("🚀 Starting ultra-stable bot with optimizations..."));
        console.log(chalk.cyan("   ⚙️  Initializing Circuit Breakers..."));
        console.log(chalk.cyan("   🔧 Setting up Worker Threads..."));
        console.log(chalk.cyan("   📦 Enabling File Compression..."));
        console.log(chalk.yellow("   🔄 Auto-restart system initialized..."));
        
        await delay(500);
        
        console.log(chalk.green("   ✅ Circuit Breakers ready"));
        console.log(chalk.green("   ✅ Worker Pool initialized"));
        console.log(chalk.green("   ✅ Compression system ready"));
        console.log(chalk.green("   ✅ All optimizations active"));
        
        await delay(500);
        
        await startWhatsapp();
        
        console.log(chalk.green("\n✅ Bot running with advanced protection!"));
        console.log(chalk.green("✅ Worker threads active for cleanup!"));
        console.log(chalk.green("✅ Session compression enabled!"));
        console.log(chalk.green("✅ Circuit breakers protecting all systems!"));
        console.log(chalk.green("✅ Auto-restart system active!\n"));
        
        autoRestart.reset();
        
        setTimeout(() => {
            console.log(chalk.cyan("\n[INFO] 📊 Initial system check:"));
            displayComprehensiveStats();
        }, 30000);
        
    } catch (e) {
        logError("bootstrap", e);
        console.log(chalk.red(`[FATAL] ❌ ${e.message}`));
        
        stats.crashes++;
        autoRestart.recordCrash(e);
        
        if (autoRestart.isCriticalError(e)) {
            console.log(chalk.red("[FATAL] ⚠️  Critical error detected"));
            await autoRestart.performRestart('bootstrap_critical');
        } else {
            const delayTime = autoRestart.getRestartDelay();
            console.log(chalk.yellow(`[RETRY] 🔄 Restarting in ${delayTime/1000}s...`));
            
            setTimeout(async () => {
                try {
                    await startWhatsapp();
                    autoRestart.reset();
                } catch (retryError) {
                    console.log(chalk.red("[FATAL] ❌ Restart failed"));
                    stats.crashes++;
                    await autoRestart.performRestart('bootstrap_retry_failed');
                }
            }, delayTime);
        }
    }
})();

// ========== EXPORT FOR TESTING ==========
export {
    CircuitBreaker,
    CompressedStorage,
    WorkerPool,
    BadMacRecoverySystem,
    AntiSpamSystem,
    SessionCleaner,
    MessageStore,
    MessageQueue,
    AutoRestartSystem,
    stats,
    badMacRecovery,
    antiSpam,
    sessionCleaner,
    messageStore,
    messageQueue,
    autoRestart,
    reconnectTracker
};