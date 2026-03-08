import chalk from "chalk";

export class MemoryMonitor {
    constructor(dependencies = {}) {
        this.monitorInterval = null;
        this.heapLimit = 1024;
        this.warningThreshold = 0.8;
        this.lastGC = Date.now();
        
        // Dependencies untuk cleanup
        this.messageStore = dependencies.messageStore;
        this.localStore = dependencies.localStore;
        this.antiSpam = dependencies.antiSpam;
        this.badMacRecovery = dependencies.badMacRecovery;
        this.messageQueue = dependencies.messageQueue;
    }

    start() {
        if (this.monitorInterval) return;
        
        this.monitorInterval = setInterval(() => {
            this.check();
        }, 60000);
        
        console.log(chalk.cyan('[MEMORY] 📊 Monitor started'));
    }

    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    check() {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const externalMB = Math.round(memUsage.external / 1024 / 1024);
        
        const usagePercent = heapUsedMB / this.heapLimit;
        
        if (usagePercent > this.warningThreshold) {
            console.log(chalk.yellow(`[MEMORY] ⚠️  High usage: ${heapUsedMB}MB (${(usagePercent * 100).toFixed(1)}%)`));
            
            this.forceCleanup();
            
            if (global.gc && Date.now() - this.lastGC > 120000) {
                console.log(chalk.cyan('[MEMORY] 🧹 Triggering GC...'));
                global.gc();
                this.lastGC = Date.now();
                
                const afterGC = process.memoryUsage();
                const afterMB = Math.round(afterGC.heapUsed / 1024 / 1024);
                console.log(chalk.green(`[MEMORY] ✅ GC done: ${heapUsedMB}MB → ${afterMB}MB`));
            }
        }
        
        if (Date.now() % 600000 < 60000) {
            console.log(chalk.gray(`[MEMORY] Heap: ${heapUsedMB}/${heapTotalMB}MB | External: ${externalMB}MB`));
        }
    }

    forceCleanup() {
        console.log(chalk.cyan('[MEMORY] 🧹 Force cleanup...'));
        
        if (this.messageStore) this.messageStore.cleanup();
        if (this.localStore) this.localStore.cleanup();
        if (this.antiSpam) this.antiSpam.cleanup();
        if (this.badMacRecovery) this.badMacRecovery.cleanup();
        if (this.messageQueue) this.messageQueue.cleanupOldTasks();
        
        console.log(chalk.green('[MEMORY] ✅ Cleanup done'));
    }

    getStats() {
        const memUsage = process.memoryUsage();
        return {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024)
        };
    }
}