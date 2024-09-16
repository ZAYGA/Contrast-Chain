// test/createDefaultLogConfig.test.mjs

import { expect } from 'chai';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import Logger from '../src/logger.mjs'; // Adjust the path if necessary

// Mocha's describe and it are globally available when running tests with Mocha

describe('Create and Update Default Log Configuration', function () {
    // Increase timeout for asynchronous operations if needed
    this.timeout(20000);

    let logger;
    let srcDir;
    let configDir;
    const configFileName = 'defaultLogConfig.json';
    let configFilePath;
    const mockDirName = 'test-mocks';
    let mockDirPath;

    // Sample log calls to be used in test files
    const sampleLogCalls = [
        { type: 'info', id: 'INFO0001', message: 'Application has started.' },
        { type: 'error', id: 'EROR0001', message: 'An unexpected error occurred.' },
    ];

    // Helper function to create sample source files with log calls
    async function createSampleFile(filePath, logCalls) {
        const contentLines = logCalls.map(
            (log) => `this.logger.${log.type}('${log.id}${log.message}');`
        );
        const content = contentLines.join('\n');
        await fs.writeFile(filePath, content, 'utf-8');
    }

    before(async function () {
        // Define the source and config directories based on the current project structure
        srcDir = path.resolve('src');
        configDir = path.resolve('config');
        configFilePath = path.join(configDir, configFileName);

        // Initialize the Logger with custom options pointing to the config directory
        logger = new Logger(8, {
            logDirectory: configDir, // Pointing to config directory for log files
            logFileName: 'application.log',
            rotationInterval: '1d', // Rotate daily
            maxFiles: 7,
            compress: 'gzip',
        });

        // Perform initial scan of the mock source directory
        await logger.scanFiles(srcDir);
    });

    // Note: The after hook does NOT delete the config directory or the config file
    // to ensure that defaultLogConfig.json persists across test runs
    after(async function () {
        // Shutdown the logger to ensure all logs are flushed
        await logger.shutdown();

        // Clean up mock files created during the test
        // Optionally, you can remove mockDirPath and its contents if desired
        // But as per user request, we leave config files intact
        try {
            await fs.rm(mockDirPath, { recursive: true, force: true });
        } catch (err) {
            console.error(`Error cleaning up mock directory: ${err.message}`);
        }
    });

    it('should create or update defaultLogConfig.json with extracted log calls', async function () {
        // Export the current log configuration to defaultLogConfig.json
        await logger.exportLogConfig(configFilePath);

        // Verify that the config file exists
        try {
            await fs.access(configFilePath);
        } catch {
            throw new Error(`Configuration file was not created at ${configFilePath}`);
        }

        // Read and parse the configuration file
        const configContent = await fs.readFile(configFilePath, 'utf-8');

        // Rescan the source directory to detect new log calls
        await logger.scanFiles(srcDir);

        // Export the updated log configuration to the same config file
        await logger.exportLogConfig(configFilePath);

        // Read and parse the updated configuration file
        const updatedConfigContent = await fs.readFile(configFilePath, 'utf-8');
        const updatedConfig = JSON.parse(updatedConfigContent);

    });
});
