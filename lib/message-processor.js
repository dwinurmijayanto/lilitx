import { logMessageFlow } from "./logging-utils.js";
import { isWhatsAppGroup, getMessagePreview, getMessageContent, hasProcessableContent } from "./message-helpers.js";
import { procMsg } from "./whatsapp/msg.js";
import { prMsg } from "./whatsapp/fmt.js";
import handlerWA from "./whatsapp/command-handler.js";

export async function processMessage(msg, whatsapp, localStore, config, dependencies) {
    const { 
        stats, 
        antiSpam, 
        badMacRecovery, 
        messageQueue 
    } = dependencies;
    
    stats.total++;
    
    const jid = msg.key.remoteJid;
    const userId = msg.key.participant || jid;
    const messageId = msg.key.id;
    const messageText = getMessagePreview(msg);
    const msgType = Object.keys(msg.message || {})[0] || 'unknown';

    logMessageFlow('MESSAGE_START', {
        from: userId,
        jid: jid,
        text: messageText,
        msgType: msgType,
        fromMe: msg.key.fromMe,
        type: 'notify'
    });

    // Own message check
    if (msg.key.fromMe) {
        stats.fromMe++;
        logMessageFlow('SKIP', {
            reason: 'own_message',
            text: messageText
        });
        return;
    }
    
    // Message object check
    if (!msg.message) {
        logMessageFlow('SKIP', {
            reason: 'no_message_object',
            detail: 'Message object is null/undefined'
        });
        return;
    }
    
    // Extract message content
    const actualMessage = getMessageContent(msg);
    if (!actualMessage) {
        logMessageFlow('SKIP', {
            reason: 'cannot_extract_content',
            detail: 'Failed to extract message from wrapper'
        });
        return;
    }
    
    // Update message if extracted
    if (actualMessage !== msg.message) {
        msg.message = actualMessage;
        const updatedText = getMessagePreview(msg);
        logMessageFlow('EXTRACTED', {
            detail: `Extracted from wrapper: ${updatedText.substring(0, 50)}`
        });
    }
    
    // Protocol message check
    if (actualMessage.protocolMessage) {
        logMessageFlow('SKIP', {
            reason: 'protocol_message',
            detail: `Type: ${actualMessage.protocolMessage.type || 'unknown'}`,
            text: messageText
        });
        return;
    }
    
    // Reaction message check
    if (actualMessage.reactionMessage) {
        logMessageFlow('SKIP', {
            reason: 'reaction_message',
            detail: 'Reactions are not processed'
        });
        return;
    }
    
    // Keep alive check
    if (actualMessage.keepAliveMessage) {
        logMessageFlow('SKIP', {
            reason: 'keep_alive',
            detail: 'Keep alive ping'
        });
        return;
    }
    
    // Processable content check
    if (!hasProcessableContent(msg)) {
        const msgTypes = Object.keys(actualMessage).join(', ');
        logMessageFlow('SKIP', {
            reason: 'no_processable_content',
            detail: `Message types: ${msgTypes}`,
            text: messageText
        });
        return;
    }
    
    // Group message check
    if (!isWhatsAppGroup(jid)) {
        stats.notGroupMsg++;
        logMessageFlow('SKIP', {
            reason: 'not_group',
            text: messageText,
            detail: `JID: ${jid}`
        });
        return;
    }

    // Prefix check
    if (config.requirePrefix) {
        const currentText = getMessagePreview(msg);
        const hasPrefix = config.prefix.some(prefix => currentText.startsWith(prefix));
        
        if (!hasPrefix) {
            stats.prefixSkipped++;
            
            if (stats.prefixSkipped % 10 === 0) {
                logMessageFlow('SKIP', {
                    reason: 'no_prefix',
                    text: currentText,
                    detail: `Valid prefixes: ${config.prefix.join(', ')}`
                });
            }
            return;
        }
    }

    // Bad MAC blacklist check
    if (badMacRecovery.isBlacklisted(userId)) {
        stats.blocked++;
        stats.messagesSkipped++;
        logMessageFlow('SKIP', {
            reason: 'blacklisted',
            text: messageText,
            detail: `User: ${userId.substring(0, 30)}`
        });
        return;
    }

    // Bad MAC corrupted check
    if (badMacRecovery.isCorrupted(userId)) {
        stats.messagesSkipped++;
        logMessageFlow('SKIP', {
            reason: 'corrupted',
            text: messageText,
            detail: `User: ${userId.substring(0, 30)}`
        });
        return;
    }

    // Cleanup lock check
    if (antiSpam.cleanupLock) {
        stats.blocked++;
        logMessageFlow('SKIP', {
            reason: 'cleanup_lock',
            text: messageText
        });
        return;
    }

    // Already processed check
    if (antiSpam.isProcessed(messageId)) {
        stats.blocked++;
        logMessageFlow('SKIP', {
            reason: 'already_processed',
            text: messageText,
            detail: `MessageID: ${messageId}`
        });
        return;
    }

    // User processing check
    if (antiSpam.isProcessing(userId)) {
        stats.blocked++;
        logMessageFlow('SKIP', {
            reason: 'user_busy',
            text: messageText,
            detail: `User: ${userId.substring(0, 30)}`
        });
        return;
    }

    // Spam check
    const spamCheck = antiSpam.canProcess(userId, jid, messageText);
    if (!spamCheck.allowed) {
        stats.blocked++;
        
        if (stats.spam[spamCheck.reason] !== undefined) {
            stats.spam[spamCheck.reason]++;
        }
        
        logMessageFlow('SKIP', {
            reason: 'spam',
            text: messageText,
            detail: `Spam reason: ${spamCheck.reason} | User: ${userId.substring(0, 30)}`
        });
        return;
    }

    logMessageFlow('PASSED_CHECKS', {
        text: messageText,
        from: userId
    });

    antiSpam.startProcessing(userId);
    antiSpam.markProcessed(messageId);
    
    const queueStats = messageQueue.getStats();
    logMessageFlow('QUEUE_ADD', {
        text: messageText,
        queueSize: queueStats.queueSize,
        processing: queueStats.processing,
        priority: 'NORMAL'
    });

    messageQueue.add(async () => {
        const startTime = Date.now();
        
        try {
            logMessageFlow('QUEUE_START', {
                text: messageText
            });
            
            localStore.addMessage(jid, msg);

            logMessageFlow('PROC_MSG_START', {
                text: messageText
            });

            const processedMessage = await Promise.race([
                procMsg(msg, whatsapp, localStore),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 10000)
                )
            ]);

            if (!processedMessage) {
                logMessageFlow('ERROR', {
                    error: 'procMsg returned null',
                    text: messageText,
                    stage: 'procMsg'
                });
                return;
            }
            
            logMessageFlow('PROC_MSG_SUCCESS', {
                text: messageText
            });

            logMessageFlow('HANDLER_START', {
                text: messageText,
                command: processedMessage.command || 'unknown'
            });

            await Promise.race([
                handlerWA.handleCommand(processedMessage, whatsapp, localStore, config),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), 15000)
                )
            ]);

            logMessageFlow('HANDLER_SUCCESS', {
                text: messageText
            });

            prMsg(processedMessage);
            stats.processed++;
            
            const duration = Date.now() - startTime;
            logMessageFlow('SUCCESS', {
                text: messageText,
                duration: duration
            });

        } catch (e) {
            stats.failed++;
            
            const errorMsg = e.message?.toLowerCase() || '';
            const isBadMac = errorMsg.includes('bad mac') || 
                           errorMsg.includes('verify') || 
                           errorMsg.includes('decrypt');
            
            if (isBadMac) {
                stats.badMacErrors++;
                stats.decryptFailures++;
                
                const recovery = await badMacRecovery.recordError(userId);
                
                logMessageFlow('BAD_MAC', {
                    contact: userId,
                    totalBadMac: stats.badMacErrors,
                    shouldCleanup: recovery.shouldCleanup,
                    shouldRestart: recovery.shouldRestart
                });
                
                if (!badMacRecovery.canRetryDecrypt(userId, messageId)) {
                    console.log(chalk.red(`[BAD MAC] ⚠️  Max retries for ${userId.slice(0, 20)}`));
                }
                
                badMacRecovery.recordDecryptAttempt(userId, messageId);
            }
            
            if (e.message === 'timeout') {
                logMessageFlow('TIMEOUT', {
                    stage: 'queue_processing',
                    timeout: 15000,
                    text: messageText
                });
            } else {
                logMessageFlow('ERROR', {
                    error: e.message,
                    text: messageText,
                    stage: 'queue_processing',
                    stack: e.stack
                });
            }
        } finally {
            antiSpam.endProcessing(userId);
        }
    }).catch((err) => {
        antiSpam.endProcessing(userId);
        logMessageFlow('ERROR', {
            error: err.message,
            text: messageText,
            stage: 'queue_add',
            stack: err.stack
        });
    });
}