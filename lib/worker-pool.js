import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { CircuitBreaker } from "./circuit-breaker.js";

export class WorkerPool {
    constructor(workerScript, poolSize = 2) {
        this.workerScript = workerScript;
        this.poolSize = poolSize;
        this.workers = [];
        this.queue = [];
        this.circuitBreaker = new CircuitBreaker('WorkerPool', 3, 30000);
        this.stats = {
            tasksCompleted: 0,
            tasksFailed: 0,
            tasksQueued: 0
        };
        
        this.initialize();
    }
    
    initialize() {
        if (!fs.existsSync(this.workerScript)) {
            console.log(chalk.yellow(`[WORKER] ⚠️  Script not found: ${this.workerScript}`));
            console.log(chalk.yellow(`[WORKER] 📝 Creating worker script...`));
            this.createWorkerScript();
        }
        
        for (let i = 0; i < this.poolSize; i++) {
            this.createWorker(i);
        }
        
        console.log(chalk.green(`[WORKER] ✅ Pool initialized with ${this.poolSize} workers`));
    }
    
    createWorkerScript() {
        const workerCode = `
// ✅ ESM WORKER
import { parentPort } from 'worker_threads';
import { promises as fs } from 'fs';
import path from 'path';

parentPort.on('message', async (task) => {
    try {
        const { type, data } = task;
        
        if (type === 'cleanup') {
            const result = await performCleanup(data);
            parentPort.postMessage({ success: true, result });
        } else if (type === 'compress') {
            const result = await performCompression(data);
            parentPort.postMessage({ success: true, result });
        } else {
            parentPort.postMessage({ success: false, error: 'Unknown task type' });
        }
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});

async function performCleanup(data) {
    const { sessionDir, maxFiles, filePattern } = data;
    let removed = 0;
    
    const files = await fs.readdir(sessionDir);
    const matching = files.filter(f => new RegExp(filePattern).test(f));
    
    if (matching.length <= maxFiles) {
        return { removed: 0, total: matching.length };
    }
    
    const filesWithStats = await Promise.all(
        matching.map(async (file) => {
            try {
                const filePath = path.join(sessionDir, file);
                const stats = await fs.stat(filePath);
                return { file, filePath, mtime: stats.mtime.getTime() };
            } catch {
                return null;
            }
        })
    );
    
    const valid = filesWithStats.filter(f => f !== null);
    valid.sort((a, b) => a.mtime - b.mtime);
    
    const toDelete = valid.slice(0, valid.length - maxFiles);
    
    for (const { filePath } of toDelete) {
        try {
            await fs.unlink(filePath);
            removed++;
        } catch {
            // Ignore errors
        }
    }
    
    return { removed, total: matching.length };
}

async function performCompression(data) {
    const { files } = data;
    let compressed = 0;
    
    // Compression logic here
    
    return { compressed };
}
`;
        
        const dir = path.dirname(this.workerScript);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const workerPath = this.workerScript.replace('.js', '.mjs');
        fs.writeFileSync(workerPath, workerCode);
        this.workerScript = workerPath;
        console.log(chalk.green(`[WORKER] ✅ Worker script created (ESM)`));
    }
    
    createWorker(id) {
        try {
            const worker = new Worker(this.workerScript);
            worker.id = id;
            worker.isAvailable = true;
            worker.tasksCompleted = 0;
            
            worker.on('message', (result) => {
                worker.isAvailable = true;
                worker.tasksCompleted++;
                this.processQueue();
            });
            
            worker.on('error', (error) => {
                console.log(chalk.red(`[WORKER:${id}] ❌ Error: ${error.message}`));
                worker.isAvailable = true;
                this.stats.tasksFailed++;
                this.processQueue();
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.log(chalk.yellow(`[WORKER:${id}] ⚠️  Exited with code ${code}, restarting...`));
                    setTimeout(() => {
                        this.workers = this.workers.filter(w => w.id !== id);
                        this.createWorker(id);
                    }, 1000);
                }
            });
            
            this.workers.push(worker);
        } catch (error) {
            console.log(chalk.red(`[WORKER] ❌ Failed to create worker: ${error.message}`));
        }
    }
    
    async execute(task) {
        return await this.circuitBreaker.execute(
            async () => {
                return new Promise((resolve, reject) => {
                    this.stats.tasksQueued++;
                    this.queue.push({ task, resolve, reject, timestamp: Date.now() });
                    this.processQueue();
                });
            },
            async () => {
                console.log(chalk.yellow(`[WORKER] Using main thread fallback`));
                return { success: false, fallback: true };
            }
        );
    }
    
    processQueue() {
        if (this.queue.length === 0) return;
        
        const available = this.workers.find(w => w.isAvailable);
        if (!available) return;
        
        const item = this.queue.shift();
        if (!item) return;
        
        const { task, resolve, reject, timestamp } = item;
        
        if (Date.now() - timestamp > 30000) {
            reject(new Error('Task timeout in queue'));
            this.stats.tasksFailed++;
            this.processQueue();
            return;
        }
        
        available.isAvailable = false;
        available.postMessage(task);
        
        const timeout = setTimeout(() => {
            reject(new Error('Worker task timeout'));
            available.isAvailable = true;
            this.stats.tasksFailed++;
            this.processQueue();
        }, 20000);
        
        available.once('message', (result) => {
            clearTimeout(timeout);
            if (result.success) {
                this.stats.tasksCompleted++;
                resolve(result.result);
            } else {
                this.stats.tasksFailed++;
                reject(new Error(result.error || 'Worker task failed'));
            }
        });
    }
    
    getQueueSize() {
        return this.queue.length;
    }
    
    getStats() {
        return {
            poolSize: this.poolSize,
            activeWorkers: this.workers.filter(w => !w.isAvailable).length,
            queueSize: this.queue.length,
            tasksCompleted: this.stats.tasksCompleted,
            tasksFailed: this.stats.tasksFailed,
            tasksQueued: this.stats.tasksQueued,
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }
    
    async terminate() {
        console.log(chalk.yellow(`[WORKER] 🛑 Terminating worker pool...`));
        
        for (const worker of this.workers) {
            await worker.terminate();
        }
        
        this.workers = [];
        console.log(chalk.green(`[WORKER] ✅ Worker pool terminated`));
    }
}