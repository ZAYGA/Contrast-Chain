// Logger.syncConfig.test.mjs

import { expect } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Logger } from '../src/logger.mjs'; // Adjust the path if necessary

describe('Logger.syncConfig Method', function () {
    // Increase timeout for asynchronous operations if needed
    this.timeout(10000);

    let logger;
    let originalCwd;
    let tempProjectDir;
    const configDirName = 'config';
    const configFileName = 'logConfig.json';
    let configFilePath;

    // Define serverJsContent in a higher scope for accessibility
    const serverJsContent = `import Logger from './logger.mjs';

class Server {
    constructor() {
        this.logger = new Logger();
    }

    initialize() {
        this.logger.warn('11223344Low disk space');
    }
}

export default Server;
`;

    // Sample initial log calls in mock files
    const initialLogCalls = [
        {
            id: '12345678',
            type: 'info',
            message: '12345678User logged in'
        },
        {
            id: '87654321',
            type: 'error',
            message: '87654321Error occurred'
        }
    ];

    // Expected configuration after initial scan
    const expectedInitialConfig = {
        '12345678': {
            active: true,
            file: 'app.js',
            line: 9, // Adjusted line numbers based on mock file content
            type: 'info',
            content: '12345678User logged in'
        },
        '87654321': {
            active: true,
            file: 'app.js',
            line: 10,
            type: 'error',
            content: '87654321Error occurred'
        }
    };

    // Expected configuration after modification
    const expectedUpdatedConfig = {
        '12345678': {
            active: true,
            file: 'app.js',
            line: 9,
            type: 'info',
            content: '12345678User logged in'
        },
        '11223344': {
            active: true,
            file: 'server.js',
            line: 9,
            type: 'warn',
            content: '11223344Low disk space'
        }
    };

    before(async () => {
        // Save the original current working directory
        originalCwd = process.cwd();

        // Create a temporary project directory
        tempProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));

        // Change the current working directory to the temporary project directory
        process.chdir(tempProjectDir);

        // Create a mock package.json to simulate a project root
        const packageJsonContent = {
            name: 'logger-test-project',
            version: '1.0.0',
            main: 'index.js'
        };
        await fs.writeFile('package.json', JSON.stringify(packageJsonContent, null, 2), 'utf-8');

        // Create mock JavaScript files with log calls
        // File: app.js
        const appJsContent = `import Logger from './logger.mjs';

class App {
    constructor() {
        this.logger = new Logger();
    }

    start() {
        this.logger.info('12345678User logged in');
        this.logger.error('87654321Error occurred');
    }
}

export default App;
`;
        await fs.writeFile('app.js', appJsContent, 'utf-8');

        // Note: server.js does not exist initially; it will be created later

        // Initialize the Logger instance
        logger = new Logger();

        // Define the path to the configuration file
        configFilePath = path.join(tempProjectDir, configDirName, configFileName);

        // Wait for Logger to finish scanning files
        // Since scanFiles is called in the constructor and is async but not awaited,
        // we'll poll until logCalls is populated
        await new Promise((resolve, reject) => {
            const maxRetries = 10;
            let attempts = 0;
            const interval = setInterval(() => {
                if (logger.logCalls.length >= initialLogCalls.length) {
                    clearInterval(interval);
                    resolve();
                } else {
                    attempts++;
                    if (attempts >= maxRetries) {
                        clearInterval(interval);
                        reject(new Error('Logger failed to populate logCalls in time.'));
                    }
                }
            }, 500); // Poll every 500ms
        });
    });

    after(async () => {
        try {
            // Shut down the logger to close any open streams
            await logger.shutdown();
        } catch (err) {
            console.error('Error during logger shutdown:', err);
        }

        // Restore the original current working directory
        process.chdir(originalCwd);

        // Remove the temporary project directory and all its contents
        //await fs.rm(tempProjectDir, { recursive: true, force: true });
    });

    it('should create initial configuration by scanning log calls', async () => {
        // Ensure that the config directory exists before exporting
        const configDirPath = path.dirname(configFilePath);
        try {
            await fs.mkdir(configDirPath, { recursive: true });
        } catch (err) {
            // If directory exists, do nothing
            if (err.code !== 'EEXIST') throw err;
        }

        // Export the initial configuration to the config file
        await logger.exportLogConfig(configFilePath);

        // Read the exported configuration file
        const configContent = await fs.readFile(configFilePath, 'utf-8');
        const config = JSON.parse(configContent);

        // Verify that the initial configuration matches expectedInitialConfig
        expect(config).to.deep.equal(expectedInitialConfig);
    });

    it('should synchronize configuration after modifying log calls', async () => {
        // Modify the mock files:
        // 1. Remove the existing error log in app.js
        // 2. Add a new warn log in server.js

        // Read app.js content
        const appJsPath = path.join(tempProjectDir, 'app.js');
        let appJsContent = await fs.readFile(appJsPath, 'utf-8');

        // Remove the error log line (line containing '87654321Error occurred')
        const appJsLines = appJsContent.split('\n');
        const errorLogLineIndex = appJsLines.findIndex(line => line.includes('87654321Error occurred'));
        if (errorLogLineIndex !== -1) {
            appJsLines.splice(errorLogLineIndex, 1);
        }
        // Update app.js content
        appJsContent = appJsLines.join('\n');
        await fs.writeFile(appJsPath, appJsContent, 'utf-8');

        // Create server.js with a new warn log
        const serverJsPath = path.join(tempProjectDir, 'server.js');
        await fs.writeFile(serverJsPath, serverJsContent, 'utf-8');

        // Re-initialize the Logger to rescan files
        // Note: Since scanFiles is called in the constructor, create a new instance
        logger = new Logger();

        // Define the expected log calls after modification
        const expectedLogCallsAfterModification = [
            {
                id: '12345678',
                type: 'info',
                message: '12345678User logged in'
            },
            {
                id: '11223344',
                type: 'warn',
                message: '11223344Low disk space'
            }
        ];

        // Wait for Logger to finish scanning files
        await new Promise((resolve, reject) => {
            const maxRetries = 10;
            let attempts = 0;
            const totalExpected = expectedLogCallsAfterModification.length;
            const interval = setInterval(() => {
                if (logger.logCalls.length >= totalExpected) {
                    clearInterval(interval);
                    resolve();
                } else {
                    attempts++;
                    if (attempts >= maxRetries) {
                        clearInterval(interval);
                        reject(new Error('Logger failed to populate logCalls after modification.'));
                    }
                }
            }, 500); // Poll every 500ms
        });

        // Perform synchronization
        await logger.syncConfig(configFilePath);

        // Read the updated configuration file
        const updatedConfigContent = await fs.readFile(configFilePath, 'utf-8');
        const updatedConfig = JSON.parse(updatedConfigContent);

        // Verify that:
        // - '12345678' is retained
        // - '87654321' is removed
        // - '11223344' is added
        expect(updatedConfig).to.deep.equal(expectedUpdatedConfig);
    });
});
