// test/logger-perf.test.mjs

import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import os from 'os';
import Logger from '../src/logger.mjs'; // Adjust the path as necessary

// Helper function to create sample source files with log calls
async function createSampleFile(filePath, logCalls) {
    const contentLines = logCalls.map(
        (log) => `this.logger.${log.type}('${log.id}${log.message}');`
    );
    const content = contentLines.join('\n');
    await fs.writeFile(filePath, content, 'utf-8');
}

describe('Logger Performance', function () {
    // Increase timeout for this specific test if needed
    this.timeout(60000); // 60 seconds

    let performanceLogger;
    let tempDir;
    let srcDir;
    let performanceLogsDir;
    const performanceLogFile = 'performance-test.log';

    before(async function () {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-perf-test-'));
        srcDir = path.join(tempDir, 'src');
        performanceLogsDir = path.join(tempDir, 'performance-logs');

        // Create src and performance-logs directories
        await fs.mkdir(srcDir, { recursive: true });
        await fs.mkdir(performanceLogsDir, { recursive: true });

        // Create sample source files with log calls (optional)
        const file1Path = path.join(srcDir, 'app1.js');
        const file2Path = path.join(srcDir, 'app2.js');

        // Define sample log calls if needed
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

        await createSampleFile(file1Path, sampleLogCallsFile1);
        await createSampleFile(file2Path, sampleLogCallsFile2);

        // Initialize the Logger with custom options pointing to temporary directories
        performanceLogger = new Logger(8, {
            logDirectory: performanceLogsDir,
            logFileName: performanceLogFile,
            rotationInterval: '10m', // Less frequent rotation for the test
            maxFiles: 2,
            compress: 'gzip',
        });

        // Perform initial scan if necessary
        await performanceLogger.scanFiles(srcDir);
    });

    after(async function () {
        // Shutdown the performance logger
        performanceLogger.shutdown();

        // Clean up performance log files
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should log a large number of messages quickly', async function () {
        const numLogs = 10000; // Number of log messages to test
        const logId = 'PERFLOG1';
        const logMessage = `${logId}This is a performance test log message.`;

        // Start time measurement
        const startTime = process.hrtime();

        // Log messages in a loop
        for (let i = 0; i < numLogs; i++) {
            performanceLogger.info(logMessage);
        }

        // Allow some time for all logs to be written
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds

        // End time measurement
        const elapsed = process.hrtime(startTime);
        const elapsedMs = (elapsed[0] * 1000) + (elapsed[1] / 1e6);

        console.log(`Logged ${numLogs} messages in ${elapsedMs.toFixed(2)} ms`);

        // Assert that logging completes within an acceptable timeframe (e.g., 5000 ms)
        const maxAllowedTimeMs = 5000;
        assert.ok(
            elapsedMs < maxAllowedTimeMs,
            `Logging ${numLogs} messages took too long: ${elapsedMs.toFixed(2)} ms`
        );

        // Optional: Verify that all messages are present in the log file
        const logFilePath = path.join(performanceLogsDir, performanceLogFile);
        const logContent = await fs.readFile(logFilePath, 'utf-8');

        // Count occurrences of the log message
        const messageCount = (logContent.match(new RegExp(`This is a performance test log message.`, 'g')) || []).length;

        assert.strictEqual(
            messageCount,
            numLogs,
            `Expected ${numLogs} log messages, but found ${messageCount}`
        );
    });
});
