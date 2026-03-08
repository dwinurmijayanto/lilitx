import chalk from "chalk";
import { CircuitBreaker } from "./circuit-breaker.js";

export class MessageQueue {
    constructor(maxConcurrent = 8) {
        this.queue = [];
        this.processing = 0;
        this.maxConcurrent = maxConcurrent;
        this.priorityLevels = {
            HIGH: [],
            NORMAL: [],
            LOW: []
        };
        this.circuitBreaker = new CircuitBreaker('MessageQueue', 10, 30000);
        this.stats = {
            processed: 0,
            failed: 0,
            timeout: 0
        };
        this.cleanupInterval = null;
        
        this.maxQueueSize = 100;
        this.taskTimeout = 30000;
        
        this.startAutoCleanup();
    }

    async add(task, priority = 'NORMAL') {
        return await this.circuitBreaker.execute(
            async () => {
                return new Promise((resolve, reject) => {
                    const item = { task, resolve, reject, timestamp: Date.now() };
                    
                    if (this.priorityLevels[priority]) {
                        this.priorityLevels[priority].push(item);
                    } else {
                        this.priorityLevels.NORMAL.push(item);
                    }
                    
                    this.process();
                });
            },
            async () => {
                console.log(chalk.yellow('[QUEUE] Using immediate execution fallback'));
                return await task();
            }
        );
    }

    async process() {
        if (this.processing >= this.maxConcurrent) return;
        
        let item = this.priorityLevels.HIGH.shift() || 
                   this.priorityLevels.NORMAL.shift() || 
                   this.priorityLevels.LOW.shift();
                   
        if (!item) return;

        if (Date.now() - item.timestamp > this.taskTimeout) {
            item.reject(new Error('Task timeout in queue'));
            this.stats.timeout++;
            this.process();
            return;
        }

        this.processing++;
        const { task, resolve, reject } = item;

        try {
            const result = await Promise.race([
                task(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 150000))
            ]);
            resolve(result);
            this.stats.processed++;
        } catch (error) {
            reject(error);
            this.stats.failed++;
        } finally {
            this.processing--;
            setImmediate(() => this.process());
        }
    }

    startAutoCleanup() {
        if (this.cleanupInterval) return;
        
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldTasks();
        }, 60000);
    }

    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    cleanupOldTasks() {
        const now = Date.now();
        let removed = 0;
        
        Object.keys(this.priorityLevels).forEach(priority => {
            const before = this.priorityLevels[priority].length;
            
            this.priorityLevels[priority] = this.priorityLevels[priority].filter(item => {
                if (now - item.timestamp > this.taskTimeout) {
                    item.reject(new Error('Task expired'));
                    return false;
                }
                return true;
            });
            
            removed += before - this.priorityLevels[priority].length;
        });
        
        if (removed > 0) {
            this.stats.timeout += removed;
        }
        
        const totalSize = this.getQueueSize();
        if (totalSize > this.maxQueueSize) {
            console.log(chalk.yellow(`[QUEUE] ⚠️  Queue overflow (${totalSize}), dropping LOW priority tasks`));
            
            const toDrop = totalSize - this.maxQueueSize;
            const dropped = this.priorityLevels.LOW.splice(0, toDrop);
            
            dropped.forEach(item => {
                item.reject(new Error('Queue overflow'));
            });
            
            this.stats.failed += dropped.length;
        }
    }

    destroy() {
        this.stopAutoCleanup();
        
        Object.keys(this.priorityLevels).forEach(priority => {
            this.priorityLevels[priority].forEach(item => {
                item.reject(new Error('Queue destroyed'));
            });
            this.priorityLevels[priority] = [];
        });
    }

    getQueueSize() {
        return this.priorityLevels.HIGH.length + 
               this.priorityLevels.NORMAL.length + 
               this.priorityLevels.LOW.length;
    }

    getStats() {
        return {
            queueSize: this.getQueueSize(),
            processing: this.processing,
            maxConcurrent: this.maxConcurrent,
            stats: this.stats,
            circuitBreaker: this.circuitBreaker.getStats()
        };
    }
}