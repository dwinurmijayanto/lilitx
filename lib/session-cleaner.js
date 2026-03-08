import chalk from "chalk";
import fs from "fs";
import path from "path";
import { delay } from "baileys";
import { CircuitBreaker } from "./circuit-breaker.js";
import { CompressedStorage } from "./compressed-storage.js";
import { WorkerPool } from "./worker-pool.js";

export class SessionCleaner {
    constructor(sessionDir) {
        this.sessionDir = sessionDir;
        this.criticalFiles = ["creds.json"];
        this.criticalPatterns = [
            /^app-state-sync/,
            /^pre-key-bundle/,
            /^session-\d+-\d+\.json$/
        ];
        this.cleanInterval = null;
        this.isRunning = false;
        this.isPaused = false;
        this.lastCleanup = 0;
        this.recentlyAccessed = new Set();
        this.errorCount = 0;
        this.sessionLocks = new Map();
        this.circuitBreaker = new CircuitBreaker('SessionCleaner', 5, 60000);
        
        this.workerPool = null;
        this.useWorkers = true;
        
        this.compressedStorage = new CompressedStorage(sessionDir);
        this.compressionEnabled = true;
        this.compressionStats = {
            filesCompressed: 0,
            totalSaved: 0
        };
        
        this.maxPreKeyFiles = 50;
        this.maxSenderKeyFiles = 50;
        this.maxSessionFiles = 80;
        this.fileCooldown = 120000;
        this.aggressiveMode = false;
        
        this.initializeWorkers();
    }

    async initializeWorkers() {
        try {
            const workerScript = path.join(process.cwd(), 'workers', 'cleanup-worker.mjs');
            this.workerPool = new WorkerPool(workerScript, 2);
            console.log(chalk.green('[CLEAN] ✅ Worker pool initialized'));
        } catch (error) {
            console.log(chalk.yellow(`[CLEAN] ⚠️  Worker pool initialization failed: ${error.message}`));
            console.log(chalk.yellow('[CLEAN] 📝 Will use main thread for cleanup'));
            this.useWorkers = false;
        }
    }

    isCriticalFile(filename) {
        if (this.criticalFiles.includes(filename)) return true;
        return this.criticalPatterns.some(p => p.test(filename));
    }

    markRecentAccess(filename) {
        this.recentlyAccessed.add(filename);
        setTimeout(() => {
            this.recentlyAccessed.delete(filename);
        }, this.fileCooldown);
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        console.log(chalk.cyan("[CLEAN] 🔄 Resuming..."));
        this.isPaused = false;
        this.isRunning = false;
        
        if (!this.cleanInterval) {
            this.startAutoClean();
            console.log(chalk.green("[CLEAN] ✅ Started auto-clean"));
        } else {
            console.log(chalk.green("[CLEAN] ✅ Resumed (already running)"));
        }
    }

    enableAggressiveMode() {
        this.aggressiveMode = true;
        this.maxPreKeyFiles = 30;
        this.maxSenderKeyFiles = 30;
        this.maxSessionFiles = 50;
        this.fileCooldown = 60000;
        console.log(chalk.yellow('[CLEAN] 🔥 Aggressive mode enabled'));
    }

    disableAggressiveMode() {
        this.aggressiveMode = false;
        this.maxPreKeyFiles = 50;
        this.maxSenderKeyFiles = 50;
        this.maxSessionFiles = 80;
        this.fileCooldown = 120000;
        console.log(chalk.green('[CLEAN] ✅ Normal mode restored'));
    }

    async cleanupCorruptedSessions(contactIds) {
        if (contactIds.length === 0) return 0;
        
        let cleaned = 0;
        
        try {
            const files = await fs.promises.readdir(this.sessionDir);
            
            for (const contactId of contactIds) {
                if (this.sessionLocks.get(contactId)) {
                    console.log(chalk.gray(`[CLEAN] Skip locked: ${contactId.slice(0, 25)}`));
                    continue;
                }
                
                this.sessionLocks.set(contactId, true);
                
                const phoneMatch = contactId.match(/(\d+)@/);
                if (!phoneMatch) {
                    this.sessionLocks.delete(contactId);
                    continue;
                }
                
                const phone = phoneMatch[1];
                
                for (const file of files) {
                    if (file.includes(phone) && (file.startsWith('session-') || file.startsWith('sender-key-'))) {
                        try {
                            const filePath = path.join(this.sessionDir, file);
                            await fs.promises.unlink(filePath);
                            
                            const compressedPath = filePath + '.gz';
                            if (fs.existsSync(compressedPath)) {
                                await fs.promises.unlink(compressedPath);
                            }
                            
                            cleaned++;
                            console.log(chalk.yellow(`[CLEAN] 🗑️  Removed: ${file.slice(0, 40)}`));
                            await delay(100);
                        } catch (err) {
                            console.log(chalk.red(`[CLEAN] ❌ Failed to remove: ${file.slice(0, 40)}`));
                        }
                    }
                }
                
                setTimeout(() => {
                    this.sessionLocks.delete(contactId);
                }, 30000);
            }
            
            if (cleaned > 0) {
                console.log(chalk.green(`[BAD MAC] ✅ Cleaned ${cleaned} corrupted files`));
            }
            
        } catch (err) {
            console.log(chalk.red(`[BAD MAC] ❌ Cleanup error: ${err.message}`));
        }
        
        return cleaned;
    }

    async safeDelete(filePath, filename) {
        try {
            if (this.isCriticalFile(filename)) return false;
            if (this.recentlyAccessed.has(filename)) return false;

            const stats = await fs.promises.stat(filePath);
            const now = Date.now();
            
            const accessTime = stats.atime.getTime();
            const modifyTime = stats.mtime.getTime();
            
            const cooldown = this.aggressiveMode ? 60000 : this.fileCooldown;
            
            if (now - accessTime < cooldown) return false;
            if (now - modifyTime < cooldown) return false;
            
            const createTime = stats.birthtime?.getTime() || modifyTime;
            if (now - createTime < 180000) return false;
            
            await fs.promises.unlink(filePath);
            
            const compressedPath = filePath + '.gz';
            if (fs.existsSync(compressedPath)) {
                await fs.promises.unlink(compressedPath);
            }
            
            return true;
        } catch {
            return false;
        }
    }

    async compressOldFiles() {
        if (!this.compressionEnabled) return 0;
        
        try {
            const files = await fs.promises.readdir(this.sessionDir);
            let compressed = 0;
            
            for (const file of files) {
                if (this.isCriticalFile(file) || file.endsWith('.gz')) continue;
                
                const filePath = path.join(this.sessionDir, file);
                
                try {
                    const stats = await fs.promises.stat(filePath);
                    const ageInHours = (Date.now() - stats.mtime.getTime()) / 3600000;
                    
                    if (ageInHours > 1 && stats.size > 1024) {
                        const success = await this.compressedStorage.compress(filePath);
                        if (success) {
                            compressed++;
                            this.compressionStats.filesCompressed++;
                            
                            const ratio = await this.compressedStorage.getCompressionRatio(filePath);
                            console.log(chalk.gray(`[COMPRESS] 📦 ${file.slice(0, 30)} (${ratio}% saved)`));
                        }
                    }
                } catch (err) {
                    // Skip
                }
                
                if (compressed >= 10) break;
            }
            
            return compressed;
        } catch (err) {
            console.log(chalk.red(`[COMPRESS] ❌ Error: ${err.message}`));
            return 0;
        }
    }

    async cleanAsyncWithWorkers() {
        if (!this.useWorkers || !this.workerPool) {
            return await this.cleanAsyncMainThread();
        }
        
        return await this.circuitBreaker.execute(
            async () => {
                const files = await fs.promises.readdir(this.sessionDir);
                let totalRemoved = 0;
                
                const fileGroups = {
                    preKey: { pattern: '^pre-key-', max: this.maxPreKeyFiles },
                    senderKey: { pattern: '^sender-key-', max: this.maxSenderKeyFiles },
                    session: { pattern: '^session-', max: this.maxSessionFiles }
                };
                
                const tasks = Object.entries(fileGroups).map(([type, config]) => {
                    return this.workerPool.execute({
                        type: 'cleanup',
                        data: {
                            sessionDir: this.sessionDir,
                            maxFiles: config.max,
                            filePattern: config.pattern
                        }
                    });
                });
                
                const results = await Promise.allSettled(tasks);
                
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value) {
                        totalRemoved += result.value.removed || 0;
                    }
                });
                
                return { removed: totalRemoved };
            },
            async () => {
                console.log(chalk.yellow('[CLEAN] Using main thread fallback'));
                return await this.cleanAsyncMainThread();
            }
        );
    }

    async cleanAsyncMainThread() {
        if (this.isRunning || this.isPaused) return { removed: 0 };
        
        const now = Date.now();
        const minInterval = this.aggressiveMode ? 60000 : 90000;
        if (now - this.lastCleanup < minInterval) return { removed: 0 };

        this.isRunning = true;
        this.lastCleanup = now;

        try {
            if (!fs.existsSync(this.sessionDir)) {
                this.isRunning = false;
                return { removed: 0 };
            }

            const files = await fs.promises.readdir(this.sessionDir);
            let removed = 0;

            const groups = {
                preKey: [],
                senderKey: [],
                session: []
            };

            for (const file of files) {
                if (this.isCriticalFile(file)) continue;
                if (this.recentlyAccessed.has(file)) continue;
                if (file.endsWith('.gz')) continue;
                
                if (file.startsWith('pre-key-')) {
                    groups.preKey.push(file);
                } else if (file.startsWith('sender-key-')) {
                    groups.senderKey.push(file);
                } else if (file.startsWith('session-')) {
                    groups.session.push(file);
                }
            }

            const cleanGroup = async (fileList, maxFiles) => {
                if (fileList.length <= maxFiles) return 0;

                const filesWithTime = await Promise.all(
                    fileList.map(async (file) => {
                        try {
                            const filePath = path.join(this.sessionDir, file);
                            const stats = await fs.promises.stat(filePath);
                            return { 
                                file, 
                                filePath, 
                                mtime: stats.mtime.getTime(),
                                atime: stats.atime.getTime()
                            };
                        } catch {
                            return null;
                        }
                    })
                );

                const valid = filesWithTime.filter(f => f !== null);
                if (valid.length <= maxFiles) return 0;

                valid.sort((a, b) => a.mtime - b.mtime);
                const toDelete = valid.slice(0, valid.length - maxFiles);

                let deleted = 0;
                for (const { filePath, file } of toDelete) {
                    if (await this.safeDelete(filePath, file)) {
                        deleted++;
                    }
                }

                return deleted;
            };

            const p = await cleanGroup(groups.preKey, this.maxPreKeyFiles);
            await delay(200);
            
            const sk = await cleanGroup(groups.senderKey, this.maxSenderKeyFiles);
            await delay(200);
            
            const s = await cleanGroup(groups.session, this.maxSessionFiles);

            removed = p + sk + s;
            
            this.isRunning = false;
            
            return { removed };

        } catch (err) {
            this.errorCount++;
            this.isRunning = false;
            return { removed: 0 };
        }
    }

    async cleanAsync() {
        const cleanupResult = await this.cleanAsyncWithWorkers();
        
        if (this.compressionEnabled && Math.random() < 0.3) {
            const compressed = await this.compressOldFiles();
            if (compressed > 0) {
                console.log(chalk.cyan(`[COMPRESS] 📦 Compressed ${compressed} files`));
            }
        }
        
        return cleanupResult;
    }

    startAutoClean() {
        if (this.cleanInterval) return;

        const runCleanup = async () => {
            if (this.isPaused) {
                const nextInterval = 60000;
                this.cleanInterval = setTimeout(runCleanup, nextInterval);
                return;
            }

            const result = await this.cleanAsync();
            
            const baseInterval = this.aggressiveMode ? 90000 : 120000;
            const randomDelay = Math.random() * 120000;
            const nextInterval = baseInterval + randomDelay;
            this.cleanInterval = setTimeout(runCleanup, nextInterval);
        };

        const initialDelay = this.aggressiveMode ? 120000 : 180000;
        this.cleanInterval = setTimeout(runCleanup, initialDelay);
    }

    stopAutoClean() {
        if (this.cleanInterval) {
            clearTimeout(this.cleanInterval);
            this.cleanInterval = null;
        }
    }

    async terminate() {
        this.stopAutoClean();
        
        if (this.workerPool) {
            await this.workerPool.terminate();
        }
    }

    getStats() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            aggressiveMode: this.aggressiveMode,
            errorCount: this.errorCount,
            lockedSessions: this.sessionLocks.size,
            recentlyAccessed: this.recentlyAccessed.size,
            compressionStats: this.compressionStats,
            workerPool: this.workerPool?.getStats(),
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }
}