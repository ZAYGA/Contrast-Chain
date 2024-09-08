import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import pino from 'pino';
import { BlockTree } from './block-tree.mjs';
import { ForkChoiceRule } from './fork-rule.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { Block, BlockData } from './block.mjs';
import { SnapshotManager } from './snapshot-system.mjs';
import { Vss } from './vss.mjs';

/**
* @typedef {import("../src/block-tree.mjs").treeBlockData} treeBlockData
*/

/**
 * Represents the blockchain and manages its operations.
 */
export class Blockchain {
    /**
     * Creates a new Blockchain instance.
     * @param {string} dbPath - The path to the LevelDB database.
     * @param {Object} p2p - The P2P network interface.
     * @param {Object} [options] - Configuration options for the blockchain.
     * @param {number} [options.maxInMemoryBlocks=1000] - Maximum number of blocks to keep in memory.
     * @param {string} [options.logLevel='info'] - The logging level for Pino.
     * @param {number} [options.snapshotInterval=100] - Interval at which to take full snapshots.
     * @param {boolean} [options.loadFromDisk=false] - Whether to load the blockchain from disk on initialization.
     */
    constructor(dbPath, p2p, options = {}) {
        const {
            maxInMemoryBlocks = 1000,
            logLevel = 'silent',
            snapshotInterval = 100,
            loadFromDisk = false
        } = options;

        /** @type {LevelUp} */
        this.db = LevelUp(LevelDown(dbPath));

        /** @type {BlockTree} */
        this.blockTree = new BlockTree('ContrastGenesisBlock');

        /** @type {ForkChoiceRule} */
        this.forkChoiceRule = new ForkChoiceRule(this.blockTree);

        /** @type {SnapshotManager} */
        this.snapshotManager = new SnapshotManager();

        /** @type {Map<string, BlockData>} */
        this.inMemoryBlocks = new Map();

        /** @type {Map<number, string>} */
        this.blocksByHeight = new Map();

        /** @type {Map<string, number>} */
        this.blockHeightByHash = new Map();

        /** @type {number} */
        this.maxInMemoryBlocks = maxInMemoryBlocks;

        /** @type {number} */
        this.currentHeight = -1;

        /** @type {BlockData|null} */
        this.lastBlock = null;

        /** @type {number} */
        this.snapshotInterval = snapshotInterval;

        /** @type {Vss} */
        this.vss = new Vss();

        /** @type {pino.Logger} */
        this.logger = pino({
            level: logLevel,
            transport: {
                target: 'pino-pretty',
                options: { colorize: true }
            }
        });

        /** @type {Object} */
        this.p2p = p2p;

        /** @type {boolean} */
        this.isSyncing = false;

        /** @type {boolean} */
        this.loadFromDisk = loadFromDisk;

        this.logger.info({ dbPath, maxInMemoryBlocks, snapshotInterval, loadFromDisk }, 'Blockchain instance created');
    }

    /**
     * Initializes the blockchain.
     * @returns {Promise<void>}
     */
    async init() {
        this.logger.info('Initializing blockchain');
        try {
            await this.db.open();

            if (this.loadFromDisk) {
                await this.loadBlockchainFromDisk();
            } else {
                const genesisBlock = this.createGenesisBlock();
                // await this.addConfirmedBlock(genesisBlock);
            }

            this.logger.info('Blockchain initialized successfully');
        } catch (error) {
            this.logger.error({ error }, 'Failed to initialize blockchain');
            throw error;
        }
    }

    /**
     * Loads the blockchain state from disk.
     * @returns {Promise<void>}
     * @private
     */
    async loadBlockchainFromDisk() {
        this.logger.info('Loading blockchain from disk');
        try {
            const storedHeight = await this.db.get('currentHeight').catch(() => '0');
            const currentHeight = parseInt(storedHeight, 10);

            for (let i = 0; i <= currentHeight; i++) {
                const blockData = await this.getBlockFromDiskByHeight(i);
                if (blockData) {
                    await this.addConfirmedBlock(blockData, false);
                } else {
                    this.logger.warn({ height: i }, 'Failed to load block from disk');
                    break;
                }
            }

            this.logger.info({ loadedBlocks: currentHeight + 1 }, 'Finished loading blockchain from disk');
        } catch (error) {
            this.logger.error({ error }, 'Error loading blockchain from disk');
            if (this.currentHeight === 0) {
                this.logger.info('Initializing with genesis block');
                const genesisBlock = this.createGenesisBlock();
                await this.addConfirmedBlock(genesisBlock);
            }
        }
    }

    /**
     * Creates the genesis block.
     * @returns {BlockData}
     * @private
     */
    createGenesisBlock() {
        return BlockData(0, 0, 0, 1, 0, 'ContrastGenesisBlock', [], Date.now(), Date.now(), 'genesisHash', '0');
    }

    /**
     * Closes the blockchain database.
     * @returns {Promise<void>}
     */
    async close() {
        await this.db.close();
    }

    /**
     * Adds a new confirmed block to the blockchain.
     * @param {UtxoCache} utxoCache - The UTXO cache to use for the block.
     * @param {BlockData} block - The block to be added.
     * @param {boolean} [persistToDisk=true] - Whether to persist the block to disk.
     * @returns {Promise<void>}
     * @throws {Error} If the block is invalid or cannot be added.
     */
    async addConfirmedBlock(utxoCache, block, persistToDisk = true) {
        this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Adding new block');

        try {
            this.updateIndices(block);
            this.inMemoryBlocks.set(block.hash, block);

            if (this.inMemoryBlocks.size > this.maxInMemoryBlocks) {
                await this.persistOldestBlockToDisk();
            }

            this.blockTree.addBlock({
                hash: block.hash,
                prevHash: block.prevHash,
                height: block.index,
                score: this.calculateBlockScore(block)
            });

            await this.applyBlock(utxoCache, block);

            if (block.index % this.snapshotInterval === 0) {
                //this.snapshotManager.takeSnapshot(block.index, this.utxoCache, this.vss);
                this.snapshotManager.takeSnapshot(block.index, utxoCache, this.vss);
            }

            await this.checkAndHandleReorg();

            this.lastBlock = block;
            this.currentHeight = block.index;

            if (persistToDisk) {
                await this.persistBlockToDisk(block);
            }

            await this.db.put('currentHeight', this.currentHeight.toString());

            this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Block successfully added');
        } catch (error) {
            this.logger.error({ error, blockHash: block.hash }, 'Failed to add block');
            throw error;
        }
    }

    /**
     * Updates the block indices.
     * @param {BlockData} block - The block to update indices for.
     * @private
     */
    updateIndices(block) {
        this.blocksByHeight.set(block.index, block.hash);
        this.blockHeightByHash.set(block.hash, block.index);
    }

    /**
     * Calculates the score for a block.
     * @param {BlockData} block - The block to calculate the score for.
     * @returns {number} The calculated score.
     * @private
     */
    calculateBlockScore(block) {
        // TODO: Implement a more sophisticated scoring mechanism
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

        if (this.inMemoryBlocks.has(hash)) {
            return this.inMemoryBlocks.get(hash);
        }

        const height = this.blockHeightByHash.get(hash);
        if (height !== undefined) {
            return this.getBlockFromDiskByHeight(height);
        }

        this.logger.error({ blockHash: hash }, 'Block not found');
        throw new Error(`Block not found: ${hash}`);
    }

    /**
     * Persists the oldest in-memory block to disk.
     * @returns {Promise<void>}
     * @private
     */
    async persistOldestBlockToDisk() {
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
            await this.db.put(`height-${block.index}`, block.hash);
            this.logger.debug({ blockHash: block.hash }, 'Block persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: block.hash }, 'Failed to persist block to disk');
            throw error;
        }
    }

    /**
     * Retrieves a block from disk by its height.
     * @param {number} height - The height of the block to retrieve.
     * @returns {Promise<BlockData|null>} The retrieved block or null if not found.
     * @private
     */
    async getBlockFromDiskByHeight(height) {
        try {
            const blockHash = await this.db.get(`height-${height}`);
            const blockJson = await this.db.get(blockHash);
            return Block.blockDataFromJSON(blockJson);
        } catch (error) {
            if (error.type === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }

    /**
     * Checks if a chain reorganization is needed and handles it if necessary.
     * @param {UtxoCache} utxoCache - The UTXO cache to use for the
     * @returns {Promise<void>}
     * @private
     */
    async checkAndHandleReorg(utxoCache) {
        const currentTip = this.getLatestBlockHash();
        const newTip = this.forkChoiceRule.findBestBlock();

        this.logger.debug({ currentTip, newTip, currentHeight: this.currentHeight }, 'Checking for chain reorganization');

        if (newTip !== currentTip && this.forkChoiceRule.shouldReorg(currentTip, newTip)) {
            await this.performChainReorg(utxoCache, newTip);
        } else {
            this.logger.debug('No chain reorganization needed');
        }
    }

    /**
     * Performs a chain reorganization.
     * @param {UtxoCache} utxoCache - The UTXO cache to use for the reorg.
     * @param {string} newTip - The hash of the new tip block.
     * @returns {Promise<void>}
     * @private
     */
    async performChainReorg(utxoCache, newTip) {
        this.logger.info({ newTip }, 'Performing chain reorganization');

        const reorgPath = this.forkChoiceRule.getReorgPath(this.getLatestBlockHash(), newTip);
        if (!reorgPath) { this.logger.error('Failed to get reorganization path'); return; }

        const commonAncestorHeight = this.blockTree.getBlockHeight(reorgPath.revert[reorgPath.revert.length - 1]);
        if (commonAncestorHeight === -1) { this.logger.error('Failed to get common ancestor height'); return; }

        //await this.snapshotManager.restoreSnapshot(commonAncestorHeight, this.utxoCache, this.blockTree);
        await this.snapshotManager.restoreSnapshot(commonAncestorHeight, utxoCache, this.blockTree);

        for (const hash of reorgPath.apply) {
            const block = await this.getBlock(hash);
            await this.applyBlock(utxoCache, block);
        }

        this.lastBlock = await this.getBlock(newTip);
        if (!this.lastBlock) { this.logger.error('Failed to get new tip block'); return; }

        this.currentHeight = this.lastBlock.index;
        await this.db.put('currentHeight', this.currentHeight.toString());

        this.logger.info({ newTip, newHeight: this.currentHeight }, 'Chain reorganization complete');
    }

    /**
     * Applies a block to the current state.
     * @param {UtxoCache} utxoCache - The UTXO cache to apply the block to.
     * @param {BlockData} block - The block to apply.
     * @returns {Promise<void>}
     * @private
     */
    async applyBlock(utxoCache, block) {
        this.logger.debug({ blockHash: block.hash }, 'Applying block');
        try {
            // const blockDataCloneToDigest = Block.cloneBlockData(minerCandidate); // clone to avoid modification ?
            //await this.utxoCache.digestFinalizedBlocks([block]);
            //this.snapshotManager.takeSnapshot(block.index, this.utxoCache, this.vss);

            // already digest in node.mjs
            this.snapshotManager.takeSnapshot(block.index, utxoCache, this.vss);
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
        return this.lastBlock ? this.lastBlock.hash : "ContrastGenesisBlock";
    }

    /**
         * Retrieves a block by its index (height).
         * @param {number} index - The index of the block to retrieve.
         * @returns {Promise<BlockData|null>} The retrieved block or null if not found.
         */
    async getBlockByIndex(index) {
        this.logger.debug({ blockIndex: index }, 'Retrieving block by index');

        if (index < 0 || index > this.currentHeight) {
            this.logger.warn({ blockIndex: index }, 'Invalid block index requested');
            return null;
        }

        const blockHash = this.blocksByHeight.get(index);
        if (blockHash) {
            return this.getBlock(blockHash);
        }

        return this.getBlockFromDiskByHeight(index);
    }

}