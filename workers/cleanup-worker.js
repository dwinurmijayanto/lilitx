
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

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
    
    const files = await fs.promises.readdir(sessionDir);
    const matching = files.filter(f => new RegExp(filePattern).test(f));
    
    if (matching.length <= maxFiles) {
        return { removed: 0, total: matching.length };
    }
    
    const filesWithStats = await Promise.all(
        matching.map(async (file) => {
            try {
                const filePath = path.join(sessionDir, file);
                const stats = await fs.promises.stat(filePath);
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
            await fs.promises.unlink(filePath);
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
