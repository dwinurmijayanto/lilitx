let messageCounter = 0;

export function getTimestamp() {
    return new Date().toISOString();
}

export function logMessageFlow(event, data = {}) {
    messageCounter++;
    const timestamp = getTimestamp();
    
    switch(event) {
        case 'EVENT_RECEIVED':
            console.log(`[${timestamp}] EVENT_RECEIVED | Type: ${data.type}, Count: ${data.count}`);
            break;
            
        case 'MESSAGE_START':
            console.log(`[${timestamp}] MESSAGE_START | #${messageCounter} | From: ${data.from} | Text: ${data.text}`);
            break;
            
        case 'SKIP':
            console.log(`[${timestamp}] SKIP | #${messageCounter} | Reason: ${data.reason} | Text: ${data.text}${data.detail ? ' | ' + data.detail : ''}`);
            break;
            
        case 'EXTRACTED':
            console.log(`[${timestamp}] EXTRACTED | #${messageCounter} | ${data.detail}`);
            break;
            
        case 'PASSED_CHECKS':
            console.log(`[${timestamp}] PASSED_CHECKS | #${messageCounter} | From: ${data.from} | Text: ${data.text}`);
            break;
            
        case 'QUEUE_ADD':
            console.log(`[${timestamp}] QUEUE_ADD | #${messageCounter} | Queue: ${data.queueSize}, Processing: ${data.processing} | Text: ${data.text}`);
            break;
            
        case 'QUEUE_START':
            console.log(`[${timestamp}] QUEUE_START | #${messageCounter} | Text: ${data.text}`);
            break;
            
        case 'PROC_MSG_START':
            console.log(`[${timestamp}] PROC_MSG_START | #${messageCounter} | Text: ${data.text}`);
            break;
            
        case 'PROC_MSG_SUCCESS':
            console.log(`[${timestamp}] PROC_MSG_SUCCESS | #${messageCounter} | Text: ${data.text}`);
            break;
            
        case 'HANDLER_START':
            console.log(`[${timestamp}] HANDLER_START | #${messageCounter} | Command: ${data.command} | Text: ${data.text}`);
            break;
            
        case 'HANDLER_SUCCESS':
            console.log(`[${timestamp}] HANDLER_SUCCESS | #${messageCounter} | Text: ${data.text}`);
            break;
            
        case 'SUCCESS':
            console.log(`[${timestamp}] SUCCESS | #${messageCounter} | Duration: ${data.duration}ms | Text: ${data.text}`);
            break;
            
        case 'ERROR':
            console.log(`[${timestamp}] ERROR | #${messageCounter} | Stage: ${data.stage} | Error: ${data.error} | Text: ${data.text}`);
            break;
            
        case 'TIMEOUT':
            console.log(`[${timestamp}] TIMEOUT | #${messageCounter} | Stage: ${data.stage} | Timeout: ${data.timeout}ms | Text: ${data.text}`);
            break;
            
        case 'BAD_MAC':
            console.log(`[${timestamp}] BAD_MAC | #${messageCounter} | Contact: ${data.contact} | Total: ${data.totalBadMac} | Cleanup: ${data.shouldCleanup} | Restart: ${data.shouldRestart}`);
            break;
    }
}

export function logConnection(event, data = {}) {
    const timestamp = getTimestamp();
    
    switch(event) {
        case 'connecting':
            console.log(`[${timestamp}] CONNECTION | Event: connecting | {}`);
            break;
            
        case 'open':
            console.log(`[${timestamp}] CONNECTION | Event: open | {}`);
            break;
            
        case 'close':
            console.log(`[${timestamp}] CONNECTION | Event: close | ${JSON.stringify(data)}`);
            break;
    }
}

export function logSystemStatus(stats) {
    const timestamp = getTimestamp();
    console.log(`[${timestamp}] SYSTEM_STATUS | ${JSON.stringify(stats)}`);
}

export function logCleanup(event, data = {}) {
    const timestamp = getTimestamp();
    console.log(`[${timestamp}] CLEANUP | Event: ${event} | ${JSON.stringify(data)}`);
}