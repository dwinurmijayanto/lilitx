export function isWhatsAppGroup(jid) {
    return jid?.endsWith('@g.us');
}

export function getMessagePreview(msg) {
    try {
        const m = getMessageContent(msg);
        if (!m) return "[?]";
        
        if (m.conversation) return m.conversation;
        if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
        
        if (m.imageMessage) return m.imageMessage.caption || "[Image]";
        if (m.videoMessage) return m.videoMessage.caption || "[Video]";
        if (m.audioMessage) return "[Audio]";
        if (m.documentMessage) return m.documentMessage.caption || "[Document]";
        
        if (m.stickerMessage) return "[Sticker]";
        if (m.contactMessage) return "[Contact]";
        if (m.locationMessage) return "[Location]";
        if (m.liveLocationMessage) return "[Live Location]";
        if (m.contactsArrayMessage) return "[Contacts]";
        if (m.templateMessage) return "[Template]";
        if (m.buttonsMessage) return m.buttonsMessage.contentText || "[Buttons]";
        if (m.listMessage) return m.listMessage.description || "[List]";
        if (m.pollCreationMessage) return m.pollCreationMessage.name || "[Poll]";
        
        return "[Media]";
    } catch {
        return "[?]";
    }
}

export function getMessageContent(msg) {
    try {
        let message = msg.message;
        
        if (message?.ephemeralMessage?.message) {
            message = message.ephemeralMessage.message;
        }
        
        if (message?.viewOnceMessage?.message) {
            message = message.viewOnceMessage.message;
        }
        
        if (message?.viewOnceMessageV2?.message) {
            message = message.viewOnceMessageV2.message;
        }
        
        if (message?.editedMessage?.message?.protocolMessage?.editedMessage) {
            message = message.editedMessage.message.protocolMessage.editedMessage;
        }
        
        return message;
    } catch {
        return null;
    }
}

export function hasProcessableContent(msg) {
    try {
        const m = getMessageContent(msg);
        if (!m) return false;
        
        if (m.protocolMessage) return false;
        if (m.reactionMessage) return false;
        if (m.keepAliveMessage) return false;
        if (m.pollCreationMessage) return true;
        
        const processableTypes = [
            'conversation',
            'extendedTextMessage',
            'imageMessage',
            'videoMessage',
            'audioMessage',
            'documentMessage',
            'stickerMessage',
            'contactMessage',
            'locationMessage',
            'liveLocationMessage',
            'contactsArrayMessage',
            'templateMessage',
            'buttonsMessage',
            'listMessage',
            'buttonsResponseMessage',
            'listResponseMessage'
        ];
        
        return processableTypes.some(type => m[type]);
    } catch {
        return false;
    }
}