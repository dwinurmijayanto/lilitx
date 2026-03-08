import chalk from "chalk";

export class CircuitBreaker {
    constructor(name, threshold = 5, timeout = 60000, resetTimeout = 300000) {
        this.name = name;
        this.failureCount = 0;
        this.successCount = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.resetTimeout = resetTimeout;
        this.state = 'CLOSED';
        this.nextAttempt = Date.now();
        this.lastStateChange = Date.now();
        this.lastError = null;
    }
    
    async execute(fn, fallback = null) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                console.log(chalk.yellow(`[CB:${this.name}] ⚡ OPEN - Using fallback`));
                if (fallback) return await fallback();
                throw new Error(`Circuit breaker ${this.name} is OPEN`);
            }
            console.log(chalk.cyan(`[CB:${this.name}] 🔄 Attempting HALF_OPEN`));
            this.state = 'HALF_OPEN';
            this.lastStateChange = Date.now();
        }
        
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            if (fallback && this.state === 'OPEN') {
                console.log(chalk.yellow(`[CB:${this.name}] Using fallback after failure`));
                return await fallback();
            }
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        this.successCount++;
        
        if (this.state === 'HALF_OPEN') {
            console.log(chalk.green(`[CB:${this.name}] ✅ Recovered - CLOSED`));
            this.state = 'CLOSED';
            this.lastStateChange = Date.now();
        }
    }
    
    onFailure(error) {
        this.failureCount++;
        this.lastError = error.message;
        
        if (this.state === 'HALF_OPEN') {
            console.log(chalk.red(`[CB:${this.name}] ❌ Failed recovery - OPEN again`));
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            this.lastStateChange = Date.now();
            return;
        }
        
        if (this.failureCount >= this.threshold) {
            console.log(chalk.red(`[CB:${this.name}] ⚠️  Threshold reached (${this.failureCount}/${this.threshold}) - OPEN`));
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            this.lastStateChange = Date.now();
        }
    }
    
    reset() {
        this.failureCount = 0;
        this.successCount = 0;
        this.state = 'CLOSED';
        this.lastError = null;
        console.log(chalk.green(`[CB:${this.name}] 🔄 Manual reset`));
    }
    
    getStats() {
        return {
            name: this.name,
            state: this.state,
            failures: this.failureCount,
            successes: this.successCount,
            lastError: this.lastError,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toLocaleString() : 'N/A'
        };
    }
}