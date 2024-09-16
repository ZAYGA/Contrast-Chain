// Logger.js

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import util from 'util';
import { createStream } from 'rotating-file-stream'; // Corrected named import
import { existsSync, mkdirSync } from 'fs';

class Logger {
    /**
     * Creates an instance of Logger.
     * @param {number} idLength - Number of characters to extract as log ID.
     * @param {Object} options - Configuration options.
     * @param {string} [options.logDirectory] - Directory where log files will be stored.
     * @param {string} [options.logFileName] - Base name of the log file.
     * @param {string} [options.rotationInterval] - Log rotation interval (e.g., '1d' for daily).
     * @param {number} [options.maxFiles] - Maximum number of rotated log files to keep.
     * @param {string} [options.compress] - Compression method for rotated files (e.g., 'gzip').
     */
    constructor(idLength = 8, options = {}) {
        this.logCalls = [];
        this.logConfig = {};
        this.idLength = idLength;

        // Project root detection
        this.projectRoot = this.findProjectRoot();

        // Logging options with defaults
        const {
            logDirectory = path.join(this.projectRoot, 'logs'),
            logFileName = 'app.log',
            rotationInterval = '1d',
            maxFiles = 30,
            compress = 'gzip',
        } = options;

        this.logDirectory = logDirectory;
        this.logFileName = logFileName;
        this.rotationInterval = rotationInterval;
        this.maxFiles = maxFiles;
        this.compress = compress;

        // Ensure log directory exists
        this.ensureLogDirectory();

        // Initialize rotating write stream
        this.initializeLogStream();

        // Start scanning files for log calls
        this.scanFiles().catch(error => {
            console.error('Failed to scan files during Logger initialization:', error);
        });

        // Handle process exit to gracefully shutdown logger
        this.handleProcessExit();
    }

    /**
     * Finds the project root by locating the nearest package.json
     * Starts searching from the current working directory upwards
     * @returns {string} - Path to the project root
     */
    findProjectRoot() {
        let currentDir = process.cwd();
        while (currentDir !== path.parse(currentDir).root) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            if (existsSync(packageJsonPath)) {
                return currentDir;
            }
            currentDir = path.dirname(currentDir);
        }
        console.warn("Could not find project root. Using current working directory.");
        return process.cwd();
    }

    /**
     * Ensures that the log directory exists; if not, creates it.
     */
    ensureLogDirectory() {
        if (!existsSync(this.logDirectory)) {
            try {
                mkdirSync(this.logDirectory, { recursive: true });
                console.log(`Created log directory at ${this.logDirectory}`);
            } catch (error) {
                console.error(`Failed to create log directory at ${this.logDirectory}:`, error);
                throw error;
            }
        }
    }

    /**
     * Initializes the rotating write stream for logging
     */
    initializeLogStream() {
        try {
            this.logStream = createStream(this.logFileName, {
                interval: this.rotationInterval, // e.g., '1d' for daily rotation
                path: this.logDirectory,
                maxFiles: this.maxFiles,
                compress: this.compress, // 'gzip' to compress rotated files
                // size: '10M', // Optional: Rotate based on size
                // initialRotation: true, // Optional: Rotate on startup
            });

            this.logStream.on('error', (err) => {
                console.error(`Error writing to log file ${this.logFileName}:`, err);
            });

            console.log(`Logging to file: ${path.join(this.logDirectory, this.logFileName)}`);
        } catch (error) {
            console.error(`Failed to initialize log stream:`, error);
            throw error;
        }
    }

    /**
     * Closes the write stream gracefully
     */
    closeLogStream() {
        if (this.logStream) {
            this.logStream.end(() => {
                console.log(`Closed log stream for ${this.logFileName}`);
            });
        }
    }

    /**
     * Handles process exit signals to ensure graceful shutdown of log streams
     */
    handleProcessExit() {
        const shutdown = () => {
            this.shutdown();
            process.exit();
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        process.on('exit', () => {
            this.shutdown();
        });
    }

    /**
     * Formats the log message
     * @param {string} type - Log type (e.g., info, error)
     * @param {string} message - Log message
     * @returns {string} - Formatted log string
     */
    formatLog(type, message) {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    }

    /**
     * Formats the log message
     * @param {string} type - Log type (e.g., info, error)
     * @param {string} message - Log message
     * @returns {string} - Formatted log string
     */
    formatStructuredJson(type, message) {
        const timestamp = new Date().toISOString();
        const logObject = {
            timestamp,
            type: type.toUpperCase(),
            message,
        };
        return JSON.stringify(logObject) + '\n';
    }
    /**
     * Writes a log message to the rotating log file
     * @param {string} type - Log type
     * @param {string} message - Log message
     */
    writeToFile(type, message) {
        if (this.logStream && !this.logStream.destroyed) {
            const formattedMessage = this.formatLog(type, message);
            this.logStream.write(formattedMessage);
        } else {
            console.warn(`Log stream is not writable. Message not logged to file: ${message}`);
        }
    }

    /**
     * Call this method when your application is shutting down to ensure logs are flushed
     */
    shutdown() {
        this.closeLogStream();
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
                    // Skip node_modules and hidden directories for efficiency
                    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
                        continue;
                    }
                    await this.scanFiles(fullPath); // Recursive scan
                } else if (entry.isFile() && this.isLoggableFile(entry.name)) {
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
     * Determines if a file is loggable based on its extension
     * @param {string} fileName - The name of the file
     * @returns {boolean} - True if the file should be scanned for log calls
     */
    isLoggableFile(fileName) {
        const loggableExtensions = ['.js', '.mjs', '.cjs', '.ts'];
        return loggableExtensions.some(ext => fileName.endsWith(ext));
    }

    /**
     * Extracts log calls from the file content by scanning each line
     * @param {string} content - The content of the file
     * @param {string} fileName - The name of the file
     */
    extractLogCalls(content, fileName) {
        const lines = content.split('\n');
        // Regex to match logger method calls with different quote types
        const logPattern = /this\.logger\.(log|info|warn|error|debug|trace)\(\s*[`'"]([\s\S]{8})([\s\S]*?)['"`]\s*\)/g;

        lines.forEach((line, index) => {
            let match;
            while ((match = logPattern.exec(line)) !== null) {
                const type = match[1];
                const id = match[2];
                const messageContent = match[3]; // Preserved without trimming
                const fullMessage = id + messageContent; // Combine ID and message

                // Validate 'type' before adding to logCalls
                if (['log', 'info', 'warn', 'error', 'debug', 'trace'].includes(type)) {
                    this.logCalls.push({
                        id,
                        file: fileName,
                        line: index + 1,
                        type,
                        content: fullMessage
                    });
                } else {
                    console.warn(`Invalid log type "${type}" found in ${fileName} at line ${index + 1}.`);
                }
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
            if (!existsSync(resolvedPath)) {
                throw new Error(`Config file not found at ${resolvedPath}`);
            }

            // Read and parse the config file
            const configContent = await fsPromises.readFile(resolvedPath, 'utf-8');

            try {
                const importedConfig = JSON.parse(configContent);
                // Merge imported config with existing config
                this.logConfig = { ...this.logConfig, ...importedConfig };
                console.log(`Log configuration imported from ${resolvedPath}`);
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
     * @param {string} message - The message to log (first X characters as ID)
     * @param {...any} args - Optional additional data objects to log
     */
    dolog(type, message, ...args) {
        if (typeof message !== 'string') {
            console.error('Logger expects the second argument to be a string message.');
            return;
        }

        const { id, content } = this.extractIdAndContent(message);
        if (!id) {
            console.error(`Log message must be at least ${this.idLength} characters long to extract ID.`);
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
            let fullMessage = content.substring(this.idLength).trim(); // Exclude ID from console output

            if (args.length > 0) {
                // Serialize each additional argument
                const serializedArgs = args.map(arg => {
                    if (typeof arg === 'object') {
                        return util.inspect(arg, { depth: null, colors: false });
                    }
                    return String(arg);
                }).join(' ');
                fullMessage += ' ' + serializedArgs;
            }

            // Log to console
            if (typeof console[type] === 'function') {
                console[type](fullMessage);
            } else {
                console.error(`Invalid log type "${type}". Falling back to console.log. Message: ${fullMessage}`);
                console.log(fullMessage);
            }

            // Additionally, write to file
            this.writeToFile(type, fullMessage);
        } else {
            // Log is inactive
            console.warn(`Log ID ${id} is inactive. Message not logged: ${content}`);
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
    debug(message, ...args) { this.dolog('debug', message, ...args); }
    info(message, ...args) { this.dolog('info', message, ...args); }
    warn(message, ...args) { this.dolog('warn', message, ...args); }
    error(message, ...args) { this.dolog('error', message, ...args); }
    trace(message, ...args) { this.dolog('trace', message, ...args); }
    log(message, ...args) { this.dolog('log', message, ...args); }
}

export default Logger;
export { Logger };
