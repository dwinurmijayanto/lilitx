import chalk from "chalk";
import { CircuitBreaker } from "./circuit-breaker.js";

export class AutoRestartSystem {
    constructor(dependencies = {}) {
        this.crashCount = 0;
        this.lastCrash = 0;
        this.restartAttempts = 0;
        this.maxRestartAttempts = 5;
        this.crashWindow = 300000;
        this.isRestarting = false;
        this.criticalErrors = new Set();
        this.circuitBreaker = new CircuitBreaker('AutoRestart', 3, 120000);
        
        // Dependencies
        this.sessionCleaner = dependencies.sessionCleaner;
        this.messageStore = dependencies.messageStore;
        this.badMacRecovery = dependencies.badMacRecovery;
        
        this.config = {
            maxCrashesInWindow: 3,
            restartDelay: 5000,
            maxRestartDelay: 60000,
            crashCooldown: 300000
        };
    }

    recordCrash(error) {
        const now = Date.now();
        
        if (now - this.lastCrash > this.crashWindow) {
            this.crashCount = 0;
            this.restartAttempts = 0;
        }
        
        this.crashCount++;
        this.lastCrash = now;
        this.criticalErrors.add({
            time: now,
            error: error.message || 'Unknown error',
            stack: error.stack?.substring(0, 200)
        });
        
        console.log(chalk.red(`\n╔═══════════════════════════════════════╗`));
        console.log(chalk.red(`║  ⚠️  CRASH DETECTED (#${this.crashCount})           ║`));
        console.log(chalk.red(`╠═══════════════════════════════════════╣`));
        console.log(chalk.yellow(`║  Error: ${error.message?.substring(0, 30) || 'Unknown'}`));
        console.log(chalk.gray(`║  Time: ${new Date().toLocaleTimeString()}`));
        console.log(chalk.red(`╚═══════════════════════════════════════╝\n`));
    }

    shouldRestart() {
        if (this.isRestarting) return false;
        if (this.restartAttempts >= this.maxRestartAttempts) {
            console.log(chalk.red.bold(`[RESTART] ❌ Max restart attempts (${this.maxRestartAttempts}) reached`));
            return false;
        }
        return true;
    }

    getRestartDelay() {
        const baseDelay = this.config.restartDelay;
        const exponentialDelay = Math.min(
            baseDelay * Math.pow(2, this.restartAttempts),
            this.config.maxRestartDelay
        );
        return exponentialDelay;
    }

    async performRestart(reason = 'crash') {
        if (!this.shouldRestart()) return false;
        
        return await this.circuitBreaker.execute(
            async () => {
                this.isRestarting = true;
                this.restartAttempts++;
                
                const delay = this.getRestartDelay();
                
                console.log(chalk.yellow(`\n╔═══════════════════════════════════════╗`));
                console.log(chalk.yellow(`║  🔄 AUTO-RESTART INITIATED            ║`));
                console.log(chalk.yellow(`╠═══════════════════════════════════════╣`));
                console.log(chalk.white(`║  Reason: ${reason.substring(0, 25)}`));
                console.log(chalk.white(`║  Attempt: ${this.restartAttempts}/${this.maxRestartAttempts}`));
                console.log(chalk.white(`║  Delay: ${delay/1000}s`));
                console.log(chalk.yellow(`╚═══════════════════════════════════════╝\n`));
                
                try {
                    console.log(chalk.cyan("[RESTART] 🧹 Cleaning up..."));
                    
                    if (this.sessionCleaner) {
                        this.sessionCleaner.stopAutoClean();
                    }
                    
                    if (this.messageStore) {
                        this.messageStore.clear();
                    }
                    
                    if (this.badMacRecovery) {
                        const corruptedSessions = this.badMacRecovery.getCorruptedSessions();
                        if (corruptedSessions.length > 0 && this.sessionCleaner) {
                            console.log(chalk.cyan(`[RESTART] 🗑️  Removing ${corruptedSessions.length} corrupted sessions...`));
                            await this.sessionCleaner.cleanupCorruptedSessions(corruptedSessions);
                        }
                    }
                    
                    if (this.sessionCleaner) {
                        await this.sessionCleaner.terminate();
                    }
                    
                    if (this.badMacRecovery) {
                        this.badMacRecovery.reset();
                    }
                    
                    console.log(chalk.green("[RESTART] ✅ Cleanup completed"));
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    console.log(chalk.green("[RESTART] 🚀 Restarting process..."));
                    process.exit(0);
                    
                } catch (err) {
                    console.log(chalk.red(`[RESTART] ❌ Restart failed: ${err.message}`));
                    this.isRestarting = false;
                    
                    setTimeout(() => {
                        console.log(chalk.red("[RESTART] ⚠️  Force exit..."));
                        process.exit(1);
                    }, 3000);
                    
                    return false;
                }
            },
            async () => {
                console.log(chalk.red("[RESTART] Circuit breaker open, force exit"));
                process.exit(1);
            }
        );
    }

    isCriticalError(error) {
        const criticalPatterns = [
            /cannot find module/i,
            /econnrefused/i,
            /enotfound/i,
            /authentication failed/i,
            /connection closed/i,
            /logged out/i,
            /session/i,
            /creds/i
        ];
        
        const errorMsg = error.message?.toLowerCase() || '';
        return criticalPatterns.some(pattern => pattern.test(errorMsg));
    }

    getStats() {
        return {
            crashes: this.crashCount,
            restartAttempts: this.restartAttempts,
            lastCrash: this.lastCrash ? new Date(this.lastCrash).toLocaleString() : 'Never',
            criticalErrors: this.criticalErrors.size,
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }

    reset() {
        this.crashCount = 0;
        this.restartAttempts = 0;
        this.isRestarting = false;
        this.circuitBreaker.reset();
        console.log(chalk.green("[RESTART] ✅ Reset successful"));
    }
}