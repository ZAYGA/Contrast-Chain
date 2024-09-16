// test/logger.test.mjs

import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import os from 'os';
import Logger from '../src/logger.mjs'; // Adjust the path as necessary

// Mocha's describe and it are globally available when running tests with Mocha

// Helper function to create sample source files with log calls
async function createSampleFile(filePath, logCalls) {
    const contentLines = logCalls.map(
        (log) => `this.logger.${log.type}('${log.id}${log.message}');`
    );
    const content = contentLines.join('\n');
    await fs.writeFile(filePath, content, 'utf-8');
}

describe('Logger', function () {
    // Increase timeout for asynchronous operations
    this.timeout(10000);

    let logger;
    let tempDir;
    let srcDir;
    let logsDir;
    let configPath;

    // Sample log calls to be used in test files
    const sampleLogCallsFile1 = [
        { type: 'info', id: 'INFO0001', message: 'Application started successfully.' },
        { type: 'error', id: 'EROR0001', message: 'Failed to connect to database.' },
        { type: 'debug', id: 'DBUG0001', message: 'Debugging authentication module.' },
    ];

    const sampleLogCallsFile2 = [
        { type: 'warn', id: 'WARN0001', message: 'Disk space running low.' },
        { type: 'trace', id: 'TRAC0001', message: 'Tracing API request flow.' },
        { type: 'info', id: 'INFO0002', message: 'User logged in successfully.' },
    ];

    before(async function () {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));
        srcDir = path.join(tempDir, 'src');
        logsDir = path.join(tempDir, 'logs');
        configPath = path.join(tempDir, 'log-config.json');

        // Create src and logs directories
        await fs.mkdir(srcDir, { recursive: true });
        await fs.mkdir(logsDir, { recursive: true });

        // Create sample source files with log calls
        const file1Path = path.join(srcDir, 'app1.js');
        const file2Path = path.join(srcDir, 'app2.js');

        await createSampleFile(file1Path, sampleLogCallsFile1);
        await createSampleFile(file2Path, sampleLogCallsFile2);

        // Initialize the Logger with custom options pointing to temporary directories
        logger = new Logger(8, {
            logDirectory: logsDir,
            logFileName: 'test-app.log',
            rotationInterval: '1m', // Rotate every minute for testing purposes
            maxFiles: 5,
            compress: 'gzip',
        });

        // Perform initial scan of the sample source directory
        await logger.scanFiles(srcDir);
    });

    after(async function () {
        // Shutdown the logger to ensure all logs are flushed
        logger.shutdown();

        // Remove the temporary directory and all its contents
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('File Scanning and Log Extraction', function () {
        it('should scan files and extract log calls', function () {
            const logCalls = logger.getLogCalls();

            // Expected total log calls from both files
            const expectedTotalLogs = sampleLogCallsFile1.length + sampleLogCallsFile2.length;

            assert(Array.isArray(logCalls), 'logCalls should be an array');
            assert.strictEqual(logCalls.length, expectedTotalLogs, `Should extract ${expectedTotalLogs} log calls`);

            // Check structure of the first log call
            const firstLog = logCalls[0];
            assert.ok(firstLog.id, 'Log call should have an id');
            assert.ok(firstLog.file, 'Log call should have a file property');
            assert.ok(firstLog.type, 'Log call should have a type');
            assert.ok(firstLog.content, 'Log call should have content');
        });

        it('should categorize logs by file', function () {
            const logsByFile = logger.getLogsByFile();

            // Expecting two files
            assert.strictEqual(Object.keys(logsByFile).length, 2, 'Should categorize logs into two files');

            // Check that each file has the correct number of logs
            const file1 = path.relative(logger.projectRoot, path.join(srcDir, 'app1.js'));
            const file2 = path.relative(logger.projectRoot, path.join(srcDir, 'app2.js'));

            assert.ok(logsByFile[file1], `Logs for ${file1} should exist`);
            assert.strictEqual(logsByFile[file1].length, sampleLogCallsFile1.length, `Should have ${sampleLogCallsFile1.length} logs for ${file1}`);

            assert.ok(logsByFile[file2], `Logs for ${file2} should exist`);
            assert.strictEqual(logsByFile[file2].length, sampleLogCallsFile2.length, `Should have ${sampleLogCallsFile2.length} logs for ${file2}`);
        });
    });

    describe('Activation and Deactivation of Logs', function () {
        it('should deactivate a log and prevent it from being active', function () {
            const logCalls = logger.getLogCalls();
            const testLogId = logCalls[0].id;

            logger.deactivateLog(testLogId);
            assert.strictEqual(logger.logConfig[testLogId].active, false, 'Log should be deactivated');

            logger.activateLog(testLogId);
            assert.strictEqual(logger.logConfig[testLogId].active, true, 'Log should be reactivated');
        });

        it('should handle activating/deactivating non-existent log IDs gracefully', function () {
            const nonExistentLogId = 'NONEXIST';

            // Capture console warnings
            let warning = '';
            const originalWarn = console.warn;
            console.warn = (msg) => { warning = msg; };

            logger.deactivateLog(nonExistentLogId);
            assert.strictEqual(warning, `Log ID ${nonExistentLogId} not found.`, 'Should warn about non-existent log ID');

            warning = '';
            logger.activateLog(nonExistentLogId);
            assert.strictEqual(warning, `Log ID ${nonExistentLogId} not found.`, 'Should warn about non-existent log ID');

            // Restore console.warn
            console.warn = originalWarn;
        });
    });

    describe('Exporting and Importing Log Configurations', function () {
        it('should export log configuration to a JSON file', async function () {
            const logCalls = logger.getLogCalls();
            const testLogId = logCalls[0].id;

            // Deactivate a log for testing
            logger.deactivateLog(testLogId);

            await logger.exportLogConfig(configPath);

            // Verify that the config file exists
            try {
                await fs.access(configPath);
            } catch {
                assert.fail('Config file should exist after export');
            }

            // Read and verify the content of the config file
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);

            assert.strictEqual(config[testLogId].active, false, 'Exported config should reflect deactivated log');
            assert.strictEqual(config[testLogId].file, logCalls[0].file, 'Exported config should include file information');
            assert.strictEqual(config[testLogId].type, logCalls[0].type, 'Exported config should include type information');
            assert.strictEqual(config[testLogId].content, logCalls[0].content, 'Exported config should include content information');
        });

        it('should import log configuration from a JSON file', async function () {
            const logCalls = logger.getLogCalls();
            const testLogId = logCalls[0].id;

            // Ensure the log is deactivated in the config file
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);
            assert.strictEqual(config[testLogId].active, false, 'Log should be deactivated in config file');

            // Create a new Logger instance and import the config
            const newLogger = new Logger(8, {
                logDirectory: logsDir,
                logFileName: 'test-app.log',
                rotationInterval: '1m',
                maxFiles: 5,
                compress: 'gzip',
            });

            await newLogger.scanFiles(srcDir);
            await newLogger.importLogConfig(configPath);

            // Verify that the log is deactivated in the new Logger instance
            assert.strictEqual(newLogger.logConfig[testLogId].active, false, 'Imported config should deactivate the log');

            // Clean up
            newLogger.shutdown();
        });

        it('should handle importing from a non-existent config file gracefully', async function () {
            const invalidConfigPath = path.join(tempDir, 'non-existent-config.json');

            // Capture console errors
            let errorMsg = '';
            const originalError = console.error;
            console.error = (msg) => { errorMsg = msg; };

            await assert.rejects(
                logger.importLogConfig(invalidConfigPath),
                {
                    message: `Config file not found at ${invalidConfigPath}`,
                },
                'Should throw an error for non-existent config file'
            );

            assert.strictEqual(
                errorMsg.includes(`Error importing log config:`),
                true,
                'Should log an error message when import fails'
            );

            // Restore console.error
            console.error = originalError;
        });

        it('should handle importing from a config file with invalid JSON', async function () {
            // Create a config file with invalid JSON
            const invalidJsonPath = path.join(tempDir, 'invalid-config.json');
            await fs.writeFile(invalidJsonPath, '{ invalid json }', 'utf-8');

            // Capture console errors
            let errorMsg = '';
            const originalError = console.error;
            console.error = (msg) => { errorMsg = msg; };

            await assert.rejects(
                logger.importLogConfig(invalidJsonPath),
                {
                    message: /Invalid JSON in config file:/,
                },
                'Should throw an error for invalid JSON in config file'
            );

            assert.strictEqual(
                errorMsg.includes('Error importing log config:'),
                true,
                'Should log an error message when JSON parsing fails'
            );

            // Restore console.error
            console.error = originalError;
        });
    });

    describe('Logging to Files and Console', function () {
        it('should write active logs to the log file', async function () {
            const logMessage = 'ACTV0001This is an active log message.';
            logger.info(logMessage);

            // Allow some time for the log to be written
            await new Promise(resolve => setTimeout(resolve, 100));

            // Read the latest log file
            const logFiles = await fs.readdir(logsDir);
            const latestLogFile = logFiles.find(file => file.startsWith('test-app.log'));
            assert.ok(latestLogFile, 'Latest log file should exist');

            const logFilePath = path.join(logsDir, latestLogFile);
            const logContent = await fs.readFile(logFilePath, 'utf-8');

            // Verify that the log message is present in the log file
            assert.ok(
                logContent.includes('This is an active log message.'),
                'Log message should be written to the log file'
            );
        });

        it('should not write deactivated logs to the log file', async function () {
            const logCalls = logger.getLogCalls();
            const testLogId = logCalls.find(log => log.type === 'info')?.id;
            if (!testLogId) {
                assert.fail('No info log found to deactivate');
            }

            // Deactivate the log
            logger.deactivateLog(testLogId);

            const logMessage = `${testLogId}This log should not be written to the file.`;
            logger.info(logMessage);

            // Allow some time for the log to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // Read the latest log file
            const logFiles = await fs.readdir(logsDir);
            const latestLogFile = logFiles.find(file => file.startsWith('test-app.log'));
            assert.ok(latestLogFile, 'Latest log file should exist');

            const logFilePath = path.join(logsDir, latestLogFile);
            const logContent = await fs.readFile(logFilePath, 'utf-8');

            // Verify that the deactivated log message is not present
            assert.ok(
                !logContent.includes('This log should not be written to the file.'),
                'Deactivated log message should not be written to the log file'
            );
        });


        it('should handle logging with insufficient message length gracefully', function () {
            const shortMessage = 'SHORT'; // Less than idLength (8)

            // Capture console errors
            let errorMsg = '';
            const originalError = console.error;
            console.error = (msg) => { errorMsg = msg; };

            logger.info(shortMessage);

            // Verify that an error was logged
            assert.strictEqual(
                errorMsg,
                `Log message must be at least 8 characters long to extract ID.`,
                'Should log an error for messages shorter than idLength'
            );

            // Restore console.error
            console.error = originalError;
        });

        it('should handle non-string log messages gracefully', function () {
            const nonStringMessage = { message: 'This is not a string' };

            // Capture console errors
            let errorMsg = '';
            const originalError = console.error;
            console.error = (msg) => { errorMsg = msg; };

            logger.info(nonStringMessage);

            // Verify that an error was logged
            assert.strictEqual(
                errorMsg,
                'Logger expects the second argument to be a string message.',
                'Should log an error for non-string messages'
            );

            // Restore console.error
            console.error = originalError;
        });
    });

    describe('Log Rotation', function () {
        it('should rotate log files based on the rotation interval', async function () {
            // Set a short rotation interval for testing (e.g., every 2 seconds)
            const shortIntervalLogger = new Logger(8, {
                logDirectory: logsDir,
                logFileName: 'rotation-test.log',
                rotationInterval: '2s', // Rotate every 2 seconds
                maxFiles: 3,
                compress: 'gzip',
            });

            // Scan files to initialize
            await shortIntervalLogger.scanFiles(srcDir);

            // Log multiple messages to trigger rotation
            shortIntervalLogger.info('ROTAT001Log message 1.');
            shortIntervalLogger.info('ROTAT002Log message 2.');
            shortIntervalLogger.info('ROTAT003Log message 3.');

            // Wait to allow rotation to occur
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds

            // Check the number of rotated files
            const logFiles = await fs.readdir(logsDir);
            const rotatedFiles = logFiles.filter(file => file.startsWith('rotation-test.log'));

            // Expecting multiple rotated files due to the short interval
            assert.ok(rotatedFiles.length >= 2, 'Should have at least two rotated log files');

            // Clean up
            shortIntervalLogger.shutdown();
        });
    });

    describe('Graceful Shutdown', function () {
        it('should close the log stream without errors', function () {
            // Spy on the logStream's end method
            const originalEnd = logger.logStream.end;
            let endCalled = false;
            logger.logStream.end = function (callback) {
                endCalled = true;
                if (callback) callback();
            };

            logger.shutdown();
            assert.strictEqual(endCalled, true, 'logStream.end should be called during shutdown');

            // Restore the original end method
            logger.logStream.end = originalEnd;
        });
    });
});
