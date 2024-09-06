import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import pino from 'pino';
import { BlockTree } from './block-tree.mjs';
import { ForkChoiceRule } from './fork-rule.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { Block, BlockData } from './block.mjs';
import { SnapshotManager } from './snapshot-system.mjs';
import { Vss } from './vss.mjs';
import utils from './utils.mjs';
import { SyncNode } from './sync.mjs';
/**
 * Represents the blockchain and manages its operations.
 */
export class Blockchain {
    /**
     * Creates a new Blockchain instance.
     * @param {string} dbPath - The path to the LevelDB database.
     * @param {Object} [options] - Configuration options for the blockchain.
     * @param {number} [options.maxInMemoryBlocks=1000] - Maximum number of blocks to keep in memory.
     * @param {string} [options.logLevel='info'] - The logging level for Pino.
     * @param {number} [options.snapshotInterval=100] - Interval at which to take full snapshots.
     */
    constructor(dbPath, p2p, options = {}) {
        const {
            maxInMemoryBlocks = 1000,
            logLevel = 'silent',
            snapshotInterval = 100
        } = options;

        /**
         * LevelDB database instance.
         * @type {LevelUp}
         * @private
         */
        this.db = LevelUp(LevelDown(dbPath));

        /**
         * Block tree for managing blockchain structure.
         * @type {BlockTree}
         */
        this.blockTree = new BlockTree('ContrastGenesisBlock');

        /**
         * Fork choice rule for determining the best chain.
         * @type {ForkChoiceRule}
         */
        this.forkChoiceRule = new ForkChoiceRule(this.blockTree);

        /**
         * UTXO cache for managing unspent transaction outputs.
         * @type {UtxoCache}
         */
        this.utxoCache = new UtxoCache();

        /**
         * Snapshot manager for managing blockchain state snapshots.
         * @type {SnapshotManager}
         */
        this.snapshotManager = new SnapshotManager();

        /**
         * In-memory storage for recent blocks.
         * @type {Map<string, BlockData>}
         */
        this.inMemoryBlocks = new Map();

        /**
         * Maximum number of blocks to keep in memory.
         * @type {number}
         */
        this.maxInMemoryBlocks = maxInMemoryBlocks;

        /**
         * Current blockchain height.
         * @type {number}
         */
        this.currentHeight = 0;

        /**
         * The most recent block in the chain.
         * @type {BlockData|null}
         */
        this.lastBlock = null;

        /**
         * Interval at which to take full snapshots.
         * @type {number}
         */
        this.snapshotInterval = snapshotInterval;

        /**
         * Vss instance for managing validators' legitimacy.
         * @type {Vss}
         * */

        this.vss = new Vss();

        /**
         * Pino logger instance.
         * @type {pino.Logger}
         */
        this.logger = pino({
            level: logLevel,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true
                }
            }
        });
        this.p2p = p2p;
        this.syncNode = new SyncNode(p2p, this);
        this.isSyncing = false;

        this.logger.info({ dbPath, maxInMemoryBlocks, snapshotInterval }, 'Blockchain instance created');
    }

    /**
     * Initializes the blockchain.
     * @returns {Promise<void>}
     */
    async init() {
        this.logger.info('Initializing blockchain');
        try {
            await this.db.open();
            // TODO: Load the latest state from the database
            // This might involve loading the last known block, UTXO set, etc.
            this.logger.info('Blockchain initialized successfully');
        } catch (error) {
            this.logger.error({ error }, 'Failed to initialize blockchain');
            throw error;
        }
        this.syncNode.p2p = this.p2p;

        await this.syncNode.start();
    }

    async syncWithPeer(peerMultiaddr) {
        if (this.isSyncing) {
            console.warn('Sync already in progress');
            return;
        }



        this.isSyncing = true;
        try {
            const localHeight = this.currentHeight;

            await this.syncNode.connect(peerMultiaddr);

            const message = {
                type: 'getBlocks',
                startIndex: localHeight + 1,
                endIndex: localHeight + 1000 // Request 1000 blocks at a time
            };

            const response = await this.syncNode.sendMessage(peerMultiaddr, message);

            if (response.status === 'success') {
                for (const blockData of response.blocks) {
                    await this.addBlock(blockData);
                }
                this.logger.info(`Synced ${response.blocks.length} blocks`);

                if (response.blocks.length === 1000) {
                    // There might be more blocks, continue syncing
                    await this.syncWithPeer(peerMultiaddr);
                }
            }
        } catch (error) {
            this.logger.error('Sync failed:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    async close() {
        await this.db.close();
        await this.syncNode.stop();
    }


    // Add a method to handle incoming sync requests
    async handleSyncRequest(message) {
        console.error('Received sync request:', message);
        if (message.type === 'getBlocks') {
            const { startIndex, endIndex } = message;
            const blocks = [];
            for (let i = startIndex; i <= endIndex && i <= this.currentHeight; i++) {
                const block = await this.getBlock(i);
                blocks.push(block);
            }
            return { status: 'success', blocks };
        }
        return { status: 'error', message: 'Invalid request type' };
    }
    /**
     * Adds a new block to the blockchain.
     * @param {BlockData} block - The block to be added.
     * @returns {Promise<void>}
     * @throws {Error} If the block is invalid or cannot be added.
     */
    async addConfirmedBlock(block) {
        this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Adding new block');

        try {
            // Validate the block before adding
            //await this.validateBlock(block); no need to validate again

            // Add block to in-memory storage
            this.inMemoryBlocks.set(block.hash, block);
            this.logger.debug({ blockHash: block.hash }, 'Block added to in-memory storage');

            // Check if we need to persist older blocks to disk
            if (this.inMemoryBlocks.size > this.maxInMemoryBlocks) {
                await this.persistOldestBlockToDisk();
            }

            // Update block tree
            this.blockTree.addBlock({
                hash: block.hash,
                prevHash: block.prevHash,
                height: block.index,
                score: this.calculateBlockScore(block)
            });
            this.logger.debug({ blockHash: block.hash }, 'Block tree updated');

            // Apply the block to the UTXO cache
            await this.applyBlock(block);

            // Take a snapshot if necessary
            if (block.index % this.snapshotInterval === 0) {
                this.snapshotManager.takeSnapshot(block.index, this.utxoCache, this.vss);
                this.logger.info({ blockHeight: block.index }, 'Snapshot taken');
            }

            // Check if we need to do a chain reorganization
            await this.checkAndHandleReorg();

            this.lastBlock = block;
            this.currentHeight = block.index;

            this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Block successfully added');
        } catch (error) {
            this.logger.error({ error, blockHash: block.hash }, 'Failed to add block');
            throw error;
        }
    }

    /** @param {BlockData} block */
    calculateBlockScore(block) {
        /*const targetBlockTime = utils.blockchainSettings.targetBlockTime;
        const oneDiffPointTimeImpact = targetBlockTime * 0.03125; // a difference of 1 difficulty means 3.125% harder to find a valid hash

        const { difficulty, timeDiffAdjustment, legitimacy, finalDifficulty } = utils.mining.getBlockFinalDifficulty(block);
        const blockMiningTime = block.timestamp - block.posTimestamp;

        const diffAdjustment = finalDifficulty - difficulty;
        const expectedMiningTime = blockMiningTime + (diffAdjustment * oneDiffPointTimeImpact); // FAKE */
        // need to clarify our requirements for the block score


        // TODO: Implement a more sophisticated scoring mechanism
        // For now, we're using the block height as the score
        return block.index;
    }

    /**
     * Retrieves a block by its hash.
     * @param {string} hash - The hash of the block to retrieve.
     * @returns {Promise<BlockData>} The retrieved block.
     * @throws {Error} If the block is not found.
     */
    async getBlock(hash) {
        this.logger.debug({ blockHash: hash }, 'Retrieving block');

        // Check in-memory first
        if (this.inMemoryBlocks.has(hash)) {
            this.logger.debug({ blockHash: hash }, 'Block found in memory');
            return this.inMemoryBlocks.get(hash);
        }

        // If not in memory, fetch from disk
        try {
            this.logger.debug({ blockHash: hash }, 'Block not in memory, fetching from disk');
            return await this.getBlockFromDisk(hash);
        } catch (error) {
            this.logger.error({ error, blockHash: hash }, 'Failed to retrieve block');
            throw new Error(`Block not found: ${hash}`);
        }
    }

    /**
     * Persists the oldest in-memory block to disk.
     * @returns {Promise<void>}
     * @private
     */
    async persistOldestBlockToDisk() {
        this.logger.info('Persisting oldest block to disk');

        const oldestBlockHash = this.inMemoryBlocks.keys().next().value;
        if (!oldestBlockHash) {
            throw new Error('Failed to get oldest block');
        }

        const oldestBlock = this.inMemoryBlocks.get(oldestBlockHash);
        this.inMemoryBlocks.delete(oldestBlockHash);

        await this.persistBlockToDisk(oldestBlock);
        this.logger.info({ blockHash: oldestBlockHash }, 'Oldest block persisted to disk and removed from memory');
    }

    /**
     * Persists a block to disk.
     * @param {BlockData} block - The block to persist.
     * @returns {Promise<void>}
     * @private
     */
    async persistBlockToDisk(block) {
        this.logger.debug({ blockHash: block.hash }, 'Persisting block to disk');
        try {
            await this.db.put(block.hash, Block.dataAsJSON(block));
            this.logger.debug({ blockHash: block.hash }, 'Block persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: block.hash }, 'Failed to persist block to disk');
            throw error;
        }
    }

    /**
     * Retrieves a block from disk.
     * @param {string} hash - The hash of the block to retrieve.
     * @returns {Promise<BlockData>} The retrieved block.
     * @private
     */
    async getBlockFromDisk(hash) {
        this.logger.debug({ blockHash: hash }, 'Retrieving block from disk');
        try {
            const blockJSON = await this.db.get(hash);
            const block = Block.blockDataFromJSON(blockJSON);
            this.logger.debug({ blockHash: hash }, 'Block retrieved from disk');
            return block;
        } catch (error) {
            this.logger.error({ error, blockHash: hash }, 'Failed to retrieve block from disk');
            throw error;
        }
    }

    /**
     * Checks if a chain reorganization is needed and handles it if necessary.
     * @returns {Promise<void>}
     * @private
     */
    async checkAndHandleReorg() {
        const currentTip = this.getLatestBlockHash();
        const newTip = this.forkChoiceRule.findBestBlock();

        this.logger.debug({ currentTip, newTip }, 'Checking for chain reorganization');

        if (newTip !== currentTip && this.forkChoiceRule.shouldReorg(currentTip, newTip)) {
            await this.performChainReorg(newTip);
        } else {
            this.logger.debug('No chain reorganization needed');
        }
    }

    /**
     * Performs a chain reorganization.
     * @param {string} newTip - The hash of the new tip block.
     * @returns {Promise<void>}
     * @private
     */
    async performChainReorg(newTip) {
        this.logger.info({ newTip }, 'Performing chain reorganization');

        const reorgPath = this.forkChoiceRule.getReorgPath(this.getLatestBlockHash(), newTip);
        if (!reorgPath) {
            this.logger.error('Failed to get reorganization path');
            return;
        }

        this.logger.debug({ reorgPath }, 'Reorganization path determined');

        // Find the common ancestor's height
        const commonAncestorHeight = this.blockTree.getBlockHeight(reorgPath.revert[reorgPath.revert.length - 1]);
        if (commonAncestorHeight === -1) {
            this.logger.error('Failed to get common ancestor height');
            return;
        }
        // Restore the snapshot at the common ancestor's height
        await this.snapshotManager.restoreSnapshot(commonAncestorHeight, this.utxoCache, this.blockTree);

        for (const hash of reorgPath.apply) {
            const block = await this.getBlock(hash);
            await this.applyBlock(block);
        }

        this.lastBlock = await this.getBlock(newTip);
        if (this.lastBlock === null || this.lastBlock === undefined) {
            this.logger.error('Failed to get new tip block');
            return;
        }
        this.currentHeight = this.lastBlock.index;

        this.logger.info({ newTip, newHeight: this.currentHeight }, 'Chain reorganization complete');
    }

    /**
     * Applies a block to the current state.
     * @param {BlockData} block - The block to apply.
     * @returns {Promise<void>}
     * @private
     */
    async applyBlock(block) {
        this.logger.debug({ blockHash: block.hash }, 'Applying block');
        try {
            await this.utxoCache.digestFinalizedBlocks([block]);
            this.snapshotManager.takeSnapshot(block.index, this.utxoCache, this.vss);
            this.logger.debug({ blockHash: block.hash }, 'Block applied');
        } catch (error) {
            this.logger.error({ error, blockHash: block.hash }, 'Failed to apply block');
            throw error;
        }
    }

    /**
     * Gets the hash of the latest block.
     * @returns {string} The hash of the latest block.
     */
    getLatestBlockHash() {
        if (this.lastBlock === null) {
            this.logger.debug('No last block, returning genesis block hash');
            return "ContrastGenesisBlock";
        }
        this.logger.debug({ latestBlockHash: this.lastBlock.hash }, 'Returning latest block hash');
        return this.lastBlock.hash;
    }


    // TODO: Redo with proper data structure to avoid O(n) lookups

    /**
 * Retrieves a block by its index (height).
 * @param {number} index - The index of the block to retrieve.
 * @returns {Promise<BlockData|null>} The retrieved block or null if not found.
 */
    async getBlockByIndex(index) {
        this.logger.debug({ blockIndex: index }, 'Retrieving block by index');

        // Check if the requested index is valid
        if (index < 0 || index > this.currentHeight) {
            this.logger.warn({ blockIndex: index }, 'Invalid block index requested');
            return null;
        }

        // Check in-memory blocks first
        for (const [hash, block] of this.inMemoryBlocks) {
            if (block.index === index) {
                this.logger.debug({ blockIndex: index, blockHash: hash }, 'Block found in memory');
                return block;
            }
        }

        // If not in memory, try to fetch from disk
        try {
            // We need to iterate through the database to find the block with the correct index
            // This is not efficient for large blockchains and should be optimized in a production environment
            const blockHashes = await this.db.keys().all();
            for (const hash of blockHashes) {
                const blockJSON = await this.db.get(hash);
                const block = Block.blockDataFromJSON(blockJSON);
                if (block.index === index) {
                    this.logger.debug({ blockIndex: index, blockHash: hash }, 'Block found on disk');
                    return block;
                }
            }
        } catch (error) {
            this.logger.error({ error, blockIndex: index }, 'Failed to retrieve block from disk');
        }

        this.logger.warn({ blockIndex: index }, 'Block not found');
        return null;
    }

}