import { CircuitBreaker } from "./circuit-breaker.js";

export class ReconnectTracker {
    constructor() {
        this.lastDisconnect = 0;
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 5;
        this.lastBadMacDisconnect = 0;
        this.badMacDisconnects = 0;
        this.circuitBreaker = new CircuitBreaker('Reconnect', 3, 60000);
    }

    getCooloffTime() {
        const baseDelay = 5000;
        const delay = Math.min(baseDelay * Math.pow(2, this.consecutiveErrors), 60000);
        return delay;
    }

    recordDisconnect(isBadMac = false) {
        this.lastDisconnect = Date.now();
        this.consecutiveErrors++;
        
        if (isBadMac) {
            this.badMacDisconnects++;
            this.lastBadMacDisconnect = Date.now();
        }
    }

    recordSuccess() {
        this.consecutiveErrors = 0;
    }

    shouldCooloff() {
        return this.consecutiveErrors >= this.maxConsecutiveErrors;
    }

    shouldAggressiveClean() {
        return this.badMacDisconnects >= 3;
    }

    resetBadMacCounter() {
        this.badMacDisconnects = 0;
    }

    getStats() {
        return {
            consecutiveErrors: this.consecutiveErrors,
            badMacDisconnects: this.badMacDisconnects,
            lastDisconnect: this.lastDisconnect ? new Date(this.lastDisconnect).toLocaleString() : 'Never'
        };
    }
}