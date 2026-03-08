import chalk from "chalk";
import fs from "fs";
import zlib from "zlib";
import { promisify } from "util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export class CompressedStorage {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.compressionLevel = 6;
        this.cache = new Map();
        this.maxCacheSize = 50;
    }
    
    getCachePath(filepath) {
        return filepath + '.gz';
    }
    
    async save(filepath, data) {
        try {
            const jsonData = typeof data === 'string' ? data : JSON.stringify(data);
            const compressed = await gzip(Buffer.from(jsonData), { level: this.compressionLevel });
            
            const cachePath = this.getCachePath(filepath);
            await fs.promises.writeFile(cachePath, compressed);
            
            this.cache.set(filepath, { data, timestamp: Date.now() });
            this.cleanCache();
            
            return true;
        } catch (error) {
            console.log(chalk.red(`[COMPRESS] ❌ Save error: ${error.message}`));
            return false;
        }
    }
    
    async load(filepath) {
        try {
            if (this.cache.has(filepath)) {
                const cached = this.cache.get(filepath);
                if (Date.now() - cached.timestamp < 300000) {
                    return cached.data;
                }
            }
            
            const cachePath = this.getCachePath(filepath);
            
            if (fs.existsSync(cachePath)) {
                const compressed = await fs.promises.readFile(cachePath);
                const decompressed = await gunzip(compressed);
                const data = JSON.parse(decompressed.toString());
                
                this.cache.set(filepath, { data, timestamp: Date.now() });
                this.cleanCache();
                
                return data;
            }
            
            if (fs.existsSync(filepath)) {
                const content = await fs.promises.readFile(filepath, 'utf8');
                const data = JSON.parse(content);
                
                setImmediate(() => this.save(filepath, data));
                
                return data;
            }
            
            return null;
        } catch (error) {
            console.log(chalk.red(`[COMPRESS] ❌ Load error: ${error.message}`));
            return null;
        }
    }
    
    async compress(filepath) {
        try {
            if (!fs.existsSync(filepath)) return false;
            
            const content = await fs.promises.readFile(filepath, 'utf8');
            const compressed = await gzip(Buffer.from(content), { level: this.compressionLevel });
            
            const cachePath = this.getCachePath(filepath);
            await fs.promises.writeFile(cachePath, compressed);
            
            await fs.promises.unlink(filepath);
            
            return true;
        } catch (error) {
            console.log(chalk.red(`[COMPRESS] ❌ Compress error: ${error.message}`));
            return false;
        }
    }
    
    async decompress(filepath) {
        try {
            const cachePath = this.getCachePath(filepath);
            if (!fs.existsSync(cachePath)) return false;
            
            const compressed = await fs.promises.readFile(cachePath);
            const decompressed = await gunzip(compressed);
            
            await fs.promises.writeFile(filepath, decompressed);
            
            return true;
        } catch (error) {
            console.log(chalk.red(`[COMPRESS] ❌ Decompress error: ${error.message}`));
            return false;
        }
    }
    
    cleanCache() {
        if (this.cache.size > this.maxCacheSize) {
            const entries = Array.from(this.cache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const toRemove = entries.slice(0, this.cache.size - this.maxCacheSize);
            toRemove.forEach(([key]) => this.cache.delete(key));
        }
    }
    
    async getCompressionRatio(filepath) {
        try {
            const originalSize = (await fs.promises.stat(filepath)).size;
            const cachePath = this.getCachePath(filepath);
            const compressedSize = (await fs.promises.stat(cachePath)).size;
            
            return ((1 - compressedSize / originalSize) * 100).toFixed(2);
        } catch {
            return 0;
        }
    }
    
    getStats() {
        return {
            cacheSize: this.cache.size,
            maxCacheSize: this.maxCacheSize
        };
    }
}