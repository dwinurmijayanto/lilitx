import chalk from "chalk";
import { CircuitBreaker } from "./circuit-breaker.js";

export class BadMacRecoverySystem {
    constructor() {
        this.errorCount = new Map();
        this.globalErrorCount = 0;
        this.lastGlobalReset = Date.now();
        this.corruptedSessions = new Set();
        this.blacklistedContacts = new Set();
        this.failedDecryptions = new Map();
        this.sessionRestartQueue = new Set();
        this.circuitBreaker = new CircuitBreaker('BadMacRecovery', 5, 60000);
        this.cleanupInterval = null;
        
        this.maxTrackedErrors = 300;
        this.maxFailedDecryptions = 200;
        
        this.config = {
            contactBlockDuration: 300000,
            globalResetInterval: 1800000,
            criticalThreshold: 50,
            sessionCooldown: 60000,
            maxErrorsPerContact: 10,
            maxGlobalErrors: 50,
            sessionCleanupThreshold: 5,
            maxDecryptRetries: 3
        };
        
        this.startAutoCleanup();
    }

    async recordError(contactId) {
        return await this.circuitBreaker.execute(
            async () => {
                const current = this.errorCount.get(contactId) || { count: 0, firstError: Date.now() };
                current.count++;
                current.lastError = Date.now();
                this.errorCount.set(contactId, current);
                
                this.globalErrorCount++;
                
                const decryptCount = this.failedDecryptions.get(contactId) || 0;
                this.failedDecryptions.set(contactId, decryptCount + 1);
                
                const shouldBlock = current.count >= this.config.maxErrorsPerContact;
                const shouldCleanup = current.count >= this.config.sessionCleanupThreshold;
                const shouldRestart = this.globalErrorCount >= this.config.criticalThreshold;
                
                if (shouldBlock) {
                    this.blacklistContact(contactId);
                }
                
                if (shouldCleanup) {
                    this.markSessionCorrupted(contactId);
                }
                
                return { shouldBlock, shouldCleanup, shouldRestart };
            },
            async () => {
                return { shouldBlock: false, shouldCleanup: false, shouldRestart: false };
            }
        );
    }

    canRetryDecrypt(contactId, messageId) {
        const key = `${contactId}:${messageId}`;
        const retries = this.failedDecryptions.get(key) || 0;
        return retries < this.config.maxDecryptRetries;
    }

    recordDecryptAttempt(contactId, messageId) {
        const key = `${contactId}:${messageId}`;
        const current = this.failedDecryptions.get(key) || 0;
        this.failedDecryptions.set(key, current + 1);
    }

    blacklistContact(contactId) {
        this.blacklistedContacts.add(contactId);
        console.log(chalk.red(`[BAD MAC] ⛔ Blacklisted: ${contactId.slice(0, 30)}`));
        
        setTimeout(() => {
            this.blacklistedContacts.delete(contactId);
            this.errorCount.delete(contactId);
            this.failedDecryptions.delete(contactId);
            console.log(chalk.yellow(`[BAD MAC] ✅ Unblocked: ${contactId.slice(0, 30)}`));
        }, this.config.contactBlockDuration);
    }

    markSessionCorrupted(contactId) {
        if (!this.corruptedSessions.has(contactId)) {
            this.corruptedSessions.add(contactId);
            this.sessionRestartQueue.add(contactId);
            console.log(chalk.yellow(`[BAD MAC] 🔧 Marked corrupted: ${contactId.slice(0, 30)}`));
        }
    }

    isBlacklisted(contactId) {
        return this.blacklistedContacts.has(contactId);
    }

    isCorrupted(contactId) {
        return this.corruptedSessions.has(contactId);
    }

    shouldRestartBot() {
        return this.globalErrorCount >= this.config.criticalThreshold;
    }

    getCorruptedSessions() {
        return Array.from(this.corruptedSessions);
    }

    getSessionRestartQueue() {
        const queue = Array.from(this.sessionRestartQueue);
        this.sessionRestartQueue.clear();
        return queue;
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
        const now = Date.now();
        
        if (now - this.lastGlobalReset >= this.config.globalResetInterval) {
            this.globalErrorCount = Math.floor(this.globalErrorCount / 2);
            this.lastGlobalReset = now;
        }
        
        for (const [contactId, data] of this.errorCount.entries()) {
            if (now - data.lastError > this.config.contactBlockDuration * 2) {
                this.errorCount.delete(contactId);
            }
        }
        
        if (this.errorCount.size > this.maxTrackedErrors) {
            const entries = Array.from(this.errorCount.entries());
            entries.sort((a, b) => b[1].lastError - a[1].lastError);
            
            this.errorCount.clear();
            entries.slice(0, this.maxTrackedErrors / 2).forEach(([k, v]) => this.errorCount.set(k, v));
        }
        
        if (this.failedDecryptions.size > this.maxFailedDecryptions) {
            const entries = Array.from(this.failedDecryptions.entries());
            this.failedDecryptions.clear();
            entries.slice(-this.maxFailedDecryptions / 2).forEach(([k, v]) => this.failedDecryptions.set(k, v));
        }
        
        for (const contactId of this.corruptedSessions) {
            const errorData = this.errorCount.get(contactId);
            if (errorData && now - errorData.lastError > this.config.sessionCooldown) {
                this.corruptedSessions.delete(contactId);
            }
        }
    }

    destroy() {
        this.stopAutoCleanup();
        this.reset();
    }

    reset() {
        this.errorCount.clear();
        this.globalErrorCount = 0;
        this.corruptedSessions.clear();
        this.blacklistedContacts.clear();
        this.failedDecryptions.clear();
        this.sessionRestartQueue.clear();
        this.lastGlobalReset = Date.now();
        this.circuitBreaker.reset();
    }

    getStats() {
        return {
            globalErrors: this.globalErrorCount,
            blacklisted: this.blacklistedContacts.size,
            corruptedSessions: this.corruptedSessions.size,
            trackedContacts: this.errorCount.size,
            failedDecryptions: this.failedDecryptions.size,
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }
}