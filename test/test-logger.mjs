import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import Logger from '../src/logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Logger', function () {
    let logger;
    const testDir = path.join(__dirname, '../src');
    const configPath = path.join(__dirname, '../config/log-config.json');

    before(async function () {
        logger = new Logger();
        await logger.scanFiles(testDir);
    });

    it('should scan files and extract log calls', function () {
        const logCalls = logger.getLogCalls();
        console.log(logCalls);

        assert(Array.isArray(logCalls));
        assert(logCalls.length > 0);
        assert(logCalls[0].hasOwnProperty('id'));
        assert(logCalls[0].hasOwnProperty('file'));
        assert(logCalls[0].hasOwnProperty('type'));
        assert(logCalls[0].hasOwnProperty('content'));
    });

    it('should categorize logs by file', function () {
        const logsByFile = logger.getLogsByFile();
        assert(typeof logsByFile === 'object');
        assert(Object.keys(logsByFile).length > 0);
    });

    it('should activate and deactivate logs', function () {
        const logCalls = logger.getLogCalls();
        const testLogId = logCalls[0].id;

        logger.deactivateLog(testLogId);
        assert.strictEqual(logger.logConfig[testLogId].active, false);

        logger.activateLog(testLogId);
        assert.strictEqual(logger.logConfig[testLogId].active, true);
    });

    it('should export and import log config with detailed info', async function () {
        const logCalls = logger.getLogCalls();
        const testLogId = logCalls[0].id;

        logger.deactivateLog(testLogId);
        await logger.exportLogConfig(configPath);

        // Reset logger
        logger = new Logger();
        await logger.scanFiles(testDir);

        await logger.importLogConfig(configPath);

        assert.strictEqual(logger.logConfig[testLogId].active, false);
        assert.strictEqual(logger.logConfig[testLogId].file, logCalls[0].file);
        assert.strictEqual(logger.logConfig[testLogId].type, logCalls[0].type);
        assert.strictEqual(logger.logConfig[testLogId].content, logCalls[0].content);
    });

    it('should save and load log config file correctly with detailed info', async function () {
        const logCalls = logger.getLogCalls();
        const testLogId1 = logCalls[0].id;
        const testLogId2 = logCalls[1].id;

        // Modify some log states
        logger.deactivateLog(testLogId1);
        logger.deactivateLog(testLogId2);

        // Save the configuration
        await logger.exportLogConfig(configPath);

        // Verify the file was created
        const fileExists = await fs.access(configPath).then(() => true).catch(() => false);
        assert(fileExists, 'Config file should exist');

        // Read the file contents
        const fileContent = await fs.readFile(configPath, 'utf-8');
        const savedConfig = JSON.parse(fileContent);

        // Verify the saved configuration
        assert.strictEqual(savedConfig[testLogId1].active, false, 'First test log should be deactivated');
        assert.strictEqual(savedConfig[testLogId2].active, false, 'Second test log should be deactivated');
        assert.strictEqual(savedConfig[testLogId1].file, logCalls[0].file, 'File info should be saved');
        assert.strictEqual(savedConfig[testLogId1].type, logCalls[0].type, 'Type info should be saved');
        assert.strictEqual(savedConfig[testLogId1].content, logCalls[0].content, 'Content info should be saved');

        // Create a new logger instance
        const newLogger = new Logger();
        await newLogger.scanFiles(testDir);

        // Load the saved configuration
        await newLogger.importLogConfig(configPath);

        // Verify the loaded configuration
        assert.strictEqual(newLogger.logConfig[testLogId1].active, false, 'First test log should still be deactivated after loading');
        assert.strictEqual(newLogger.logConfig[testLogId2].active, false, 'Second test log should still be deactivated after loading');
        assert.strictEqual(newLogger.logConfig[testLogId1].file, logCalls[0].file, 'File info should be loaded correctly');
        assert.strictEqual(newLogger.logConfig[testLogId1].type, logCalls[0].type, 'Type info should be loaded correctly');
        assert.strictEqual(newLogger.logConfig[testLogId1].content, logCalls[0].content, 'Content info should be loaded correctly');

        // Verify other logs are still active
        const otherLogId = logCalls[2].id;
        assert.strictEqual(newLogger.logConfig[otherLogId].active, true, 'Other logs should remain active');

        // Log the location of the config file
        console.log(`Test completed. Log configuration file saved at: ${configPath}`);

        // Log the content of the config file
        console.log('Config file content:');
        console.log(fileContent);
    });
});