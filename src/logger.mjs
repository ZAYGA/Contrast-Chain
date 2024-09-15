import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

class Logger {
    constructor() {
        this.logCalls = [];
        this.logConfig = {};
    }

    async scanFiles(directory) {
        const files = await fs.readdir(directory);
        for (const file of files) {
            if (file.endsWith('.mjs')) {
                const filePath = path.join(directory, file);
                const content = await fs.readFile(filePath, 'utf-8');
                this.extractLogCalls(content, file);
            }
        }
        this.initializeLogConfig();
    }

    extractLogCalls(content, fileName) {
        const logPattern = /(?:console|this\.logger)\.(log|info|warn|error|debug|trace)\((.*?)\)/g;
        let match;
        while ((match = logPattern.exec(content)) !== null) {
            const id = this.generateLogId(fileName, match[1], match[2]);
            this.logCalls.push({
                id,
                file: fileName,
                type: match[1],
                content: match[2].trim()
            });
        }
    }

    generateLogId(fileName, type, content) {
        const data = `${fileName}-${type}-${content}`;
        return crypto.createHash('md5').update(data).digest('hex');
    }

    initializeLogConfig() {
        this.logCalls.forEach(log => {
            this.logConfig[log.id] = {
                active: true,
                file: log.file,
                type: log.type,
                content: log.content
            };
        });
    }

    getLogCalls() {
        return this.logCalls;
    }

    getLogsByFile() {
        return this.logCalls.reduce((acc, log) => {
            if (!acc[log.file]) {
                acc[log.file] = [];
            }
            acc[log.file].push(log);
            return acc;
        }, {});
    }

    activateLog(id) {
        if (this.logConfig.hasOwnProperty(id)) {
            this.logConfig[id].active = true;
        }
    }

    deactivateLog(id) {
        if (this.logConfig.hasOwnProperty(id)) {
            this.logConfig[id].active = false;
        }
    }

    async exportLogConfig(filePath) {
        await fs.writeFile(filePath, JSON.stringify(this.logConfig, null, 2));
    }

    async importLogConfig(filePath) {
        const configContent = await fs.readFile(filePath, 'utf-8');
        this.logConfig = JSON.parse(configContent);
    }
}

export default Logger;