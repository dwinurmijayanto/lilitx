export class MessageStore {
    constructor() {
        this.messages = new Map();
        this.messageHashes = new Set();
        this.maxMessages = 500;
        this.maxAge = 300000;
        this.messageTimestamps = new Map();
        this.cleanupInterval = null;
        
        this.startAutoCleanup();
    }

    generateHash(messageData) {
        const key = messageData.key;
        return `${key.remoteJid}:${key.id}:${key.participant || ''}`;
    }

    add(messageId, messageData) {
        if (!messageId) return false;
        
        const hash = this.generateHash(messageData);
        if (this.messageHashes.has(hash)) {
            return false;
        }
        
        this.messages.set(messageId, messageData);
        this.messageHashes.add(hash);
        this.messageTimestamps.set(messageId, Date.now());
        
        if (this.messages.size > this.maxMessages) {
            this.cleanup();
        }
        
        return true;
    }

    get(messageId) {
        return this.messages.get(messageId);
    }

    cleanup() {
        const now = Date.now();
        let removed = 0;
        
        for (const [messageId, timestamp] of this.messageTimestamps.entries()) {
            if (now - timestamp > this.maxAge) {
                const messageData = this.messages.get(messageId);
                
                if (messageData) {
                    const hash = this.generateHash(messageData);
                    this.messageHashes.delete(hash);
                }
                
                this.messages.delete(messageId);
                this.messageTimestamps.delete(messageId);
                removed++;
            }
        }
        
        if (this.messages.size > this.maxMessages) {
            const entries = Array.from(this.messageTimestamps.entries());
            entries.sort((a, b) => a[1] - b[1]);
            
            const toRemove = entries.slice(0, this.messages.size - this.maxMessages);
            
            for (const [messageId] of toRemove) {
                const messageData = this.messages.get(messageId);
                
                if (messageData) {
                    const hash = this.generateHash(messageData);
                    this.messageHashes.delete(hash);
                }
                
                this.messages.delete(messageId);
                this.messageTimestamps.delete(messageId);
                removed++;
            }
        }
    }

    startAutoCleanup() {
        if (this.cleanupInterval) return;
        
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 120000);
    }

    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    clear() {
        this.messages.clear();
        this.messageHashes.clear();
        this.messageTimestamps.clear();
    }

    destroy() {
        this.stopAutoCleanup();
        this.clear();
    }

    getStats() {
        return {
            messages: this.messages.size,
            hashes: this.messageHashes.size,
            timestamps: this.messageTimestamps.size
        };
    }
}