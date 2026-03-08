export class LocalStore {
    constructor(messageStore) {
        this.messages = {};
        this.groupMetadata = {};
        this.metadataCache = new Map();
        this.maxMessagesPerJid = 10;
        this.maxMetadataAge = 600000;
        this.metadataTimestamps = new Map();
        this.messageStore = messageStore;
    }


    addMessage(jid, msg) {
        if (!this.messages[jid]) this.messages[jid] = [];
        this.messages[jid].push(msg);
        
        if (this.messages[jid].length > this.maxMessagesPerJid) {
            this.messages[jid] = this.messages[jid].slice(-this.maxMessagesPerJid);
        }
        
        if (this.messageStore) {
            this.messageStore.add(msg.key?.id, msg);
        }
    }

    getMessage(jid, id) {
        return this.messages[jid]?.find(m => m.key.id === id);
    }

    getGroupMetadata(jid) {
        if (this.metadataCache.has(jid)) {
            const cached = this.metadataCache.get(jid);
            const timestamp = this.metadataTimestamps.get(jid) || 0;
            
            if (Date.now() - timestamp < this.maxMetadataAge) {
                return cached.data;
            }
        }
        return this.groupMetadata[jid] || null;
    }

    setGroupMetadata(jid, metadata) {
        this.groupMetadata[jid] = metadata;
        this.metadataCache.set(jid, {
            data: metadata,
            time: Date.now()
        });
        this.metadataTimestamps.set(jid, Date.now());
        
        this.cleanupMetadata();
    }

    cleanupMetadata() {
        const now = Date.now();
        let removed = 0;
        
        for (const [jid, timestamp] of this.metadataTimestamps.entries()) {
            if (now - timestamp > this.maxMetadataAge * 2) {
                this.metadataCache.delete(jid);
                this.metadataTimestamps.delete(jid);
                delete this.groupMetadata[jid];
                removed++;
            }
        }
    }

    cleanupMessages() {
        let totalRemoved = 0;
        
        for (const jid in this.messages) {
            const before = this.messages[jid].length;
            this.messages[jid] = this.messages[jid].slice(-this.maxMessagesPerJid);
            totalRemoved += before - this.messages[jid].length;
            
            if (this.messages[jid].length === 0) {
                delete this.messages[jid];
            }
        }
    }

    cleanup() {
        this.cleanupMessages();
        this.cleanupMetadata();
    }

    clear() {
        this.messages = {};
        this.groupMetadata = {};
        this.metadataCache.clear();
        this.metadataTimestamps.clear();
    }
}

