import fsPromises from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

class Logger {
    constructor(idLength = 8) {
        this.logCalls = [];
        this.logConfig = {};
        this.projectRoot = this.findProjectRoot();
        this.idLength = idLength; // Configurable ID length
    }

    /**
     * Finds the project root by locating the nearest package.json
     * Starts searching from the current working directory upwards
     */
    findProjectRoot() {
        let currentDir = process.cwd();
        while (currentDir !== path.parse(currentDir).root) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            if (existsSync(packageJsonPath)) { // Use existsSync from 'fs'
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }
        console.warn("Could not find project root. Using current working directory.");
        return process.cwd();
    }

    /**
     * Recursively scans files in the given directory for log calls
     * @param {string} directory - The directory to scan
     */
    async scanFiles(directory = this.projectRoot) {
        try {
            const entries = await fsPromises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    await this.scanFiles(fullPath); // Recursive scan
                } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
                    const content = await fsPromises.readFile(fullPath, 'utf-8');
                    const relativePath = path.relative(this.projectRoot, fullPath);
                    this.extractLogCalls(content, relativePath);
                }
            }
            this.initializeLogConfig();
        } catch (error) {
            console.error(`Error scanning files in directory ${directory}:`, error);
            throw error;
        }
    }

    /**
     * Extracts log calls from the file content by scanning each line
     * @param {string} content - The content of the file
     * @param {string} fileName - The name of the file
     */
    extractLogCalls(content, fileName) {
        const lines = content.split('\n');
        // Updated regex to handle single quotes, double quotes, and backticks
        const logPattern = /this\.logger\.(log|info|warn|error|debug|trace)\(\s*[`'"]([\s\S]{8})([\s\S]*?)['"`]\s*\)/g;

        lines.forEach((line, index) => {
            let match;
            while ((match = logPattern.exec(line)) !== null) {
                const type = match[1];
                const id = match[2];
                const messageContent = match[3]; // Preserved without trimming
                const fullMessage = id + messageContent; // Combine ID and message
                this.logCalls.push({
                    id,
                    file: fileName,
                    line: index + 1,
                    type,
                    content: fullMessage
                });
            }
        });
    }

    /**
     * Initializes the log configuration with default active logs
     */
    initializeLogConfig() {
        this.logCalls.forEach(log => {
            if (!this.logConfig[log.id]) { // Avoid overwriting existing config
                this.logConfig[log.id] = {
                    active: true,
                    file: log.file,
                    line: log.line,
                    type: log.type,
                    content: log.content
                };
            }
        });
    }

    /**
     * Retrieves all log calls
     * @returns {Array} - Array of log call objects
     */
    getLogCalls() {
        return this.logCalls;
    }

    /**
     * Groups log calls by their respective files
     * @returns {Object} - An object with file names as keys and arrays of log calls as values
     */
    getLogsByFile() {
        return this.logCalls.reduce((acc, log) => {
            if (!acc[log.file]) {
                acc[log.file] = [];
            }
            acc[log.file].push(log);
            return acc;
        }, {});
    }

    /**
     * Activates a specific log by its ID
     * @param {string} id - The unique ID of the log
     */
    activateLog(id) {
        if (this.logConfig[id]) {
            this.logConfig[id] = { ...this.logConfig[id], active: true };
        } else {
            console.warn(`Log ID ${id} not found.`);
        }
    }

    /**
     * Deactivates a specific log by its ID
     * @param {string} id - The unique ID of the log
     */
    deactivateLog(id) {
        if (this.logConfig[id]) {
            this.logConfig[id] = { ...this.logConfig[id], active: false };
        } else {
            console.warn(`Log ID ${id} not found.`);
        }
    }

    /**
     * Exports the current log configuration to a JSON file
     * @param {string} filePath - The path to the export file
     */
    async exportLogConfig(filePath) {
        try {
            const resolvedPath = path.isAbsolute(filePath)
                ? filePath
                : path.resolve(this.projectRoot, filePath);
            await fsPromises.writeFile(resolvedPath, JSON.stringify(this.logConfig, null, 2), 'utf-8');
            console.log(`Log configuration exported to ${resolvedPath}`);
        } catch (error) {
            console.error(`Failed to export log configuration to ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Imports a log configuration from a JSON file
     * @param {string} filePath - The path to the import file
     */
    async importLogConfig(filePath) {
        try {
            // Resolve the file path relative to project root
            const resolvedPath = path.isAbsolute(filePath)
                ? filePath
                : path.resolve(this.projectRoot, filePath);

            console.warn("Attempting to read config from:", resolvedPath);

            // Check if the file exists
            if (!existsSync(resolvedPath)) { // Use existsSync from 'fs'
                throw new Error(`Config file not found at ${resolvedPath}`);
            }

            // Read and parse the config file
            const configContent = await fsPromises.readFile(resolvedPath, 'utf-8');

            try {
                const importedConfig = JSON.parse(configContent);
                // Merge imported config with existing config
                this.logConfig = { ...this.logConfig, ...importedConfig };
            } catch (error) {
                throw new Error(`Invalid JSON in config file: ${error.message}`);
            }

        } catch (error) {
            console.error("Error importing log config:", error.message);
            throw error; // Re-throw the error for the caller to handle
        }
    }

    /**
     * Logs data based on the type and configuration
     * @param {string} type - The type of log (e.g., info, error)
     * @param {string} message - The message to log
     */
    log(type, message) {
        if (typeof message !== 'string') {
            console.error('Logger expects a string message.' + message);
            return;
        }

        const { id, content } = this.extractIdAndContent(message);
        if (!id) {
            console.error('Log message must be at least 8 characters long to extract ID.');
            return;
        }

        if (!this.logConfig[id]) {
            // Initialize config for new ID
            this.logConfig[id] = {
                active: true,
                type,
                content
            };
        }

        if (this.logConfig[id].active) {
            // To avoid logging the ID as part of the message, log only the content excluding the ID
            const messageWithoutId = content.substring(this.idLength);

            // Validate 'type' before calling
            if (typeof console[type] === 'function') {
                console[type](content);
            } else {
                console.error(`Invalid log type "${type}". Falling back to console.log. Message: ${messageWithoutId}`);
                console.log(content);
            }
        } else {
            console.log(`Log ${id} is not active. Type: ${type}, Content: ${content.substring(this.idLength)}`);
        }
    }


    /**
     * Extracts the first X characters as ID and retains the entire message as content
     * @param {string} message - The log message
     * @returns {Object} - An object containing the ID and the content
     */
    extractIdAndContent(message) {
        if (message.length < this.idLength) {
            return { id: null, content: message };
        }
        const id = message.substring(0, this.idLength);
        const content = message; // Entire message is preserved
        return { id, content };
    }

    // Convenience methods for different log types
    debug(message) { this.log('debug', message); }
    info(message) { this.log('info', message); }
    warn(message) { this.log('warn', message); }
    error(message) { this.log('error', message); }
    trace(message) { this.log('trace', message); }
}

export default Logger;
export { Logger };
