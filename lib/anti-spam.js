import chalk from "chalk";
import { CircuitBreaker } from "./circuit-breaker.js";

export class AntiSpamSystem {
    constructor() {
        this.userLastCommand = new Map();
        this.userCommandCount = new Map();
        this.userWarnings = new Map();
        this.processingUsers = new Map(); // ✅ FIX #1: Diubah dari Set ke Map (untuk timestamp tracking)
        this.processedMessages = new Set();
        this.cleanupLock = false;
        this.globalRateLimit = new Map();
        this.circuitBreaker = new CircuitBreaker('AntiSpam', 10, 30000);
        this.cleanupInterval = null;
        
        this.maxTrackedUsers = 500;
        this.maxProcessedMessages = 500;
        this.maxGlobalRateLimit = 200;
        
        this.config = {
            minCommandInterval: 500,
            maxCommandsPerMinute: 30,
            maxCommandsPer5Min: 100,
            duplicateWindow: 1500,
            warningThreshold: 12,
            groupCooldown: 300,
            floodThreshold: 10,
            floodWindow: 10000,
            processingTimeout: 120000 // ✅ 2 menit untuk akomodasi proses download
        };
        
        this.startAutoCleanup();
    }

    // ✅ FIX #1: isProcessing sekarang cek timestamp dan auto-expire
    isProcessing(userId) {
        const startTime = this.processingUsers.get(userId);
        if (startTime === undefined) return false;
        
        // Auto-expire jika lebih dari processingTimeout (2 menit)
        if (Date.now() - startTime > this.config.processingTimeout) {
            this.processingUsers.delete(userId);
            console.log(chalk.yellow(`[ANTISPAM] ⏰ Auto-expired stuck processing: ${userId.slice(0, 25)}`));
            return false;
        }
        
        return true;
    }

    // ✅ FIX #1: startProcessing menyimpan timestamp
    startProcessing(userId) {
        this.processingUsers.set(userId, Date.now());
    }

    endProcessing(userId) {
        this.processingUsers.delete(userId);
    }

    isProcessed(messageId) {
        return this.processedMessages.has(messageId);
    }

    markProcessed(messageId) {
        this.processedMessages.add(messageId);
        if (this.processedMessages.size > this.maxProcessedMessages) {
            const arr = Array.from(this.processedMessages);
            this.processedMessages.clear();
            arr.slice(-this.maxProcessedMessages / 2).forEach(id => this.processedMessages.add(id));
        }
    }

    isBanned(userId) {
        const warnings = this.userWarnings.get(userId);
        if (!warnings) return false;
        
        const { count, bannedUntil } = warnings;
        
        if (bannedUntil && Date.now() < bannedUntil) {
            return true;
        }
        
        if (bannedUntil && Date.now() >= bannedUntil) {
            this.userWarnings.set(userId, { count: 0, bannedUntil: null });
            return false;
        }
        
        return false;
    }

    addWarning(userId, reason = 'spam') {
        const current = this.userWarnings.get(userId) || { count: 0, bannedUntil: null };
        current.count++;
        
        if (current.count >= this.config.warningThreshold) {
            current.bannedUntil = Date.now() + 300000;
            console.log(chalk.yellow(`[SPAM] User ${userId.slice(0, 20)} banned for 300s (${reason})`));
        }
        
        this.userWarnings.set(userId, current);
        return current;
    }

    isFlooding(userId) {
        const now = Date.now();
        const commands = this.userCommandCount.get(userId) || [];
        const recentCommands = commands.filter(time => now - time < this.config.floodWindow);
        
        if (recentCommands.length >= this.config.floodThreshold) {
            this.addWarning(userId, 'flooding');
            return true;
        }
        
        return false;
    }

    checkRateLimit(userId) {
        const now = Date.now();
        const commands = this.userCommandCount.get(userId) || [];
        const recent = commands.filter(time => now - time < 300000);
        
        const lastMinute = recent.filter(time => now - time < 60000);
        if (lastMinute.length >= this.config.maxCommandsPerMinute) {
            this.addWarning(userId, 'rate_limit_1min');
            return false;
        }
        
        if (recent.length >= this.config.maxCommandsPer5Min) {
            this.addWarning(userId, 'rate_limit_5min');
            return false;
        }
        
        recent.push(now);
        this.userCommandCount.set(userId, recent);
        return true;
    }

    isDuplicate(userId, text) {
        const key = `${userId}:${text}`;
        const last = this.userLastCommand.get(key);
        const now = Date.now();
        
        if (last && now - last < this.config.duplicateWindow) {
            return true;
        }
        
        this.userLastCommand.set(key, now);
        
        if (this.userLastCommand.size > 500) {
            const entries = Array.from(this.userLastCommand.entries());
            this.userLastCommand.clear();
            entries.slice(-250).forEach(([k, v]) => this.userLastCommand.set(k, v));
        }
        
        return false;
    }

    checkMinInterval(userId) {
        const commands = this.userCommandCount.get(userId) || [];
        if (commands.length === 0) return true;
        
        const lastCommand = commands[commands.length - 1];
        const now = Date.now();
        
        return now - lastCommand >= this.config.minCommandInterval;
    }

    checkGroupCooldown(groupJid) {
        const now = Date.now();
        const lastMessage = this.globalRateLimit.get(groupJid);
        
        if (lastMessage && now - lastMessage < this.config.groupCooldown) {
            return false;
        }
        
        this.globalRateLimit.set(groupJid, now);
        return true;
    }

    canProcess(userId, groupJid, messageText) {
        if (this.isBanned(userId)) {
            return { allowed: false, reason: 'banned' };
        }
        
        if (this.isFlooding(userId)) {
            return { allowed: false, reason: 'flooding' };
        }
        
        if (!this.checkMinInterval(userId)) {
            return { allowed: false, reason: 'too_fast' };
        }
        
        if (!this.checkRateLimit(userId)) {
            return { allowed: false, reason: 'rate_limit' };
        }
        
        if (this.isDuplicate(userId, messageText)) {
            return { allowed: false, reason: 'duplicate' };
        }
        
        if (!this.checkGroupCooldown(groupJid)) {
            return { allowed: false, reason: 'group_cooldown' };
        }
        
        return { allowed: true };
    }

    startAutoCleanup() {
        if (this.cleanupInterval) return;
        
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 180000);
    }

    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    cleanup() {
        if (this.cleanupLock) return; // ✅ Guard agar cleanup tidak tumpang tindih
        this.cleanupLock = true;
        
        try {
            const now = Date.now();
            
            // ✅ Bersihkan processingUsers yang stuck
            let stuckCount = 0;
            for (const [userId, startTime] of this.processingUsers.entries()) {
                if (now - startTime > this.config.processingTimeout) {
                    this.processingUsers.delete(userId);
                    stuckCount++;
                }
            }
            if (stuckCount > 0) {
                console.log(chalk.yellow(`[ANTISPAM] 🧹 Cleared ${stuckCount} stuck processing user(s)`));
            }
            
            // Bersihkan userWarnings yang sudah kadaluarsa
            for (const [userId, data] of this.userWarnings.entries()) {
                if (data.bannedUntil === null || now - data.bannedUntil > 3600000) {
                    this.userWarnings.delete(userId);
                }
            }
            
            // Bersihkan userCommandCount yang tidak aktif
            for (const [userId, times] of this.userCommandCount.entries()) {
                const recent = times.filter(time => now - time < 300000);
                if (recent.length === 0) {
                    this.userCommandCount.delete(userId);
                } else {
                    this.userCommandCount.set(userId, recent);
                }
            }
            
            // Bersihkan userLastCommand yang sudah kadaluarsa
            for (const [key, time] of this.userLastCommand.entries()) {
                if (now - time > 300000) {
                    this.userLastCommand.delete(key);
                }
            }
            
            // Bersihkan globalRateLimit yang sudah kadaluarsa
            for (const [jid, time] of this.globalRateLimit.entries()) {
                if (now - time > 60000) {
                    this.globalRateLimit.delete(jid);
                }
            }
            
            // Trim processedMessages jika overflow
            if (this.processedMessages.size > this.maxProcessedMessages) {
                const arr = Array.from(this.processedMessages);
                this.processedMessages.clear();
                arr.slice(-this.maxProcessedMessages / 2).forEach(id => this.processedMessages.add(id));
            }
            
            // Trim userCommandCount jika overflow
            if (this.userCommandCount.size > this.maxTrackedUsers) {
                const entries = Array.from(this.userCommandCount.entries());
                this.userCommandCount.clear();
                entries.slice(-this.maxTrackedUsers / 2).forEach(([k, v]) => this.userCommandCount.set(k, v));
            }
            
            // Trim globalRateLimit jika overflow
            if (this.globalRateLimit.size > this.maxGlobalRateLimit) {
                const entries = Array.from(this.globalRateLimit.entries());
                this.globalRateLimit.clear();
                entries.slice(-this.maxGlobalRateLimit / 2).forEach(([k, v]) => this.globalRateLimit.set(k, v));
            }
            
        } finally {
            // ✅ Selalu unlock di finally, tidak peduli error apapun
            this.cleanupLock = false;
        }
    }

    // ✅ IMPROVE #1: destroy() sekarang log & force-clear processingUsers yang masih aktif
    destroy() {
        this.stopAutoCleanup();

        // Cek apakah ada proses yang masih berjalan saat destroy dipanggil
        if (this.processingUsers.size > 0) {
            const now = Date.now();
            const activeUsers = [];
            const stuckUsers = [];

            for (const [userId, startTime] of this.processingUsers.entries()) {
                const elapsedSec = Math.floor((now - startTime) / 1000);
                const isStuck = now - startTime > this.config.processingTimeout;

                if (isStuck) {
                    stuckUsers.push(`${userId.slice(0, 20)} (${elapsedSec}s - STUCK)`);
                } else {
                    activeUsers.push(`${userId.slice(0, 20)} (${elapsedSec}s)`);
                }
            }

            // Log proses yang masih aktif (belum timeout) — kemungkinan sedang download
            if (activeUsers.length > 0) {
                console.log(chalk.yellow(
                    `[ANTISPAM] ⚠️  Destroying with ${activeUsers.length} ACTIVE processing user(s):`
                ));
                activeUsers.forEach(u => console.log(chalk.yellow(`             → ${u}`)));
            }

            // Log proses yang sudah stuck melewati batas timeout
            if (stuckUsers.length > 0) {
                console.log(chalk.red(
                    `[ANTISPAM] ⚠️  Destroying with ${stuckUsers.length} STUCK processing user(s):`
                ));
                stuckUsers.forEach(u => console.log(chalk.red(`             → ${u}`)));
            }

            // Force clear semua — tidak ada yang bisa dilanjutkan setelah destroy
            this.processingUsers.clear();
            console.log(chalk.green(`[ANTISPAM] ✅ Force-cleared all processing users on destroy`));

        } else {
            // Tidak ada yang processing saat destroy — kondisi bersih
            console.log(chalk.green(`[ANTISPAM] ✅ No active processing users on destroy`));
        }

        this.userLastCommand.clear();
        this.userCommandCount.clear();
        this.userWarnings.clear();
        this.processedMessages.clear();
        this.globalRateLimit.clear();
    }

    getStats() {
        const now = Date.now();
        // Hitung processing aktif (tidak termasuk yang sudah timeout)
        let activeProcessing = 0;
        for (const [, startTime] of this.processingUsers.entries()) {
            if (now - startTime <= this.config.processingTimeout) {
                activeProcessing++;
            }
        }
        
        return {
            processing: activeProcessing,
            processingTotal: this.processingUsers.size, // termasuk yang akan expire
            tracked: this.userCommandCount.size,
            banned: Array.from(this.userWarnings.values()).filter(w => w.bannedUntil && Date.now() < w.bannedUntil).length,
            warnings: this.userWarnings.size,
            processedMessages: this.processedMessages.size,
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }
}