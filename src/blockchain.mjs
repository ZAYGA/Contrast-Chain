import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import pino from 'pino';
import { BlockTree } from './block-tree.mjs';
import { ForkChoiceRule } from './fork-rule.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockUtils, BlockData } from './block.mjs';
import { SnapshotManager } from './snapshot-system.mjs';
import { Vss } from './vss.mjs';
import utils from './utils.mjs';

/**
* @typedef {import("../src/block-tree.mjs").TreeNode} TreeNode
* @typedef {import("../src/block.mjs").BlockInfo} BlockInfo
*/

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
    constructor(nodeId, options = {}) {
        const {
            maxInMemoryBlocks = 1000,
            logLevel = 'silent', // 'silent',
            snapshotInterval = 100,
        } = options;

        /** @type {LevelUp} */
        this.db = LevelUp(LevelDown('./databases/blockchainDB' + nodeId));
        /** @type {BlockTree} */
        this.blockTree = new BlockTree('0000000000000000000000000000000000000000000000000000000000000000');
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

        /** @type {boolean} */
        this.isSyncing = false;
        this.logger.info({ dbPath: './databases/blockchainDB' + nodeId, maxInMemoryBlocks, snapshotInterval }, 'Blockchain instance created');
    }

    async init() {
        this.logger.info('Initializing blockchain');
        try {
            await this.db.open();
        } catch (error) {
            this.logger.error({ error }, 'Failed to open blockchain database');
            throw error;
        }
    }
    async recoverBlocksFromStorage() {
        try {
            this.logger.info('Loading blockchain from disk...');
            const storedHeight = await this.db.get('currentHeight').catch(() => '0');
            const storedHeightInt = parseInt(storedHeight, 10);
            const blocksData = [];
            for (let i = 0; i <= storedHeightInt; i++) {
                const blockData = await this.getBlockFromDiskByHeight(i);
                if (!blockData) { this.logger.warn({ height: i }, 'Failed to load block from disk'); break; }

                blocksData.push(blockData);
            }

            const loadedBlocks = blocksData.length;
            if (loadedBlocks === 0) { this.logger.info('No blocks loaded from disk'); }
            this.logger.info({ loadedBlocks }, 'Loading blockchain from disk successful');

            return blocksData;
        } catch (error) {
            this.logger.error({ error }, 'Failed to load blockchain from disk');
            throw error;
        }
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
     * @param {BlockData[]} blocks - The blocks to add. ordered by height
     * @param {boolean} [persistToDisk=true] - Whether to persist the block to disk.
     * @throws {Error} If the block is invalid or cannot be added.
     */
    async addConfirmedBlocks(utxoCache, blocks, persistToDisk = true) {
        for (const block of blocks) {
            this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Adding new block');
            try {
                this.updateIndices(block);
                this.inMemoryBlocks.set(block.hash, block);

                if (this.inMemoryBlocks.size > this.maxInMemoryBlocks) { await this.persistOldestBlockToDisk(utxoCache.utxosByAnchor); }

                this.blockTree.addBlock({
                    hash: block.hash,
                    prevHash: block.prevHash,
                    height: block.index,
                    score: this.calculateBlockScore(block)
                });

                this.snapshotManager.takeSnapshot(block.index, utxoCache, this.vss);

                this.lastBlock = block;
                this.currentHeight = block.index;

                /** @type {BlockInfo} */
                let blockInfo;
                if (persistToDisk) {
                    await this.persistBlockToDisk(block);
                    blockInfo = BlockUtils.getFinalizedBlockInfo(utxoCache.utxosByAnchor, block);
                    await this.persistBlockInfoToDisk(blockInfo);
                }

                await this.db.put('currentHeight', this.currentHeight.toString());

                this.logger.info({ blockHeight: block.index, blockHash: block.hash }, 'Block successfully added');
                return {block, blockInfo};
            } catch (error) {
                this.logger.error({ error, blockHash: block.hash }, 'Failed to add block');
                throw error;
            }
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
    async persistOldestBlockToDisk(utxosByAnchor) {
        const oldestBlockHash = this.inMemoryBlocks.keys().next().value;
        if (!oldestBlockHash) {
            throw new Error('Failed to get oldest block');
        }

        const oldestBlock = this.inMemoryBlocks.get(oldestBlockHash);
        this.inMemoryBlocks.delete(oldestBlockHash);

        await this.persistBlockToDisk(oldestBlock);
        await this.persistBlockInfoToDisk(BlockUtils.getFinalizedBlockInfo(utxosByAnchor, oldestBlock));
        this.logger.info({ blockHash: oldestBlockHash }, 'Oldest block persisted to disk and removed from memory');
    }
    /**
     * Persists a block to disk.
     * @param {BlockData} finalizedBlock - The block to persist.
     * @returns {Promise<void>}
     * @private
     */
    async persistBlockToDisk(finalizedBlock) {
        this.logger.debug({ blockHash: finalizedBlock.hash }, 'Persisting block to disk');
        try {
            const serializedBlock = utils.serializer.block_finalized.toBinary_v2(finalizedBlock);
            const buffer = Buffer.from(serializedBlock);
            await this.db.put(finalizedBlock.hash, buffer);
            await this.db.put(`height-${finalizedBlock.index}`, finalizedBlock.hash);

            this.logger.debug({ blockHash: finalizedBlock.hash }, 'Block persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: finalizedBlock.hash }, 'Failed to persist block to disk');
            throw error;
        }
    }
    /** @param {BlockInfo} blockInfo */
    async persistBlockInfoToDisk(blockInfo) {
        this.logger.debug({ blockHash: blockInfo.header.hash }, 'Persisting block info to disk');
        try {
            const serializedBlockInfo = utils.serializer.rawData.toBinary_v1(blockInfo);
            const buffer = Buffer.from(serializedBlockInfo);
            await this.db.put(`info-${blockInfo.header.hash}`, buffer);

            this.logger.debug({ blockHash: blockInfo.header.hash }, 'Block info persisted to disk');
        } catch (error) {
            this.logger.error({ error, blockHash: blockInfo.header.hash }, 'Failed to persist block info to disk');
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
            const blockHashUint8Array = await this.db.get(`height-${height}`);
            const blockHash = new TextDecoder().decode(blockHashUint8Array);

            const serializedBlock = await this.db.get(blockHash);
            const blockData = utils.serializer.block_finalized.fromBinary_v2(serializedBlock);

            return blockData;
        } catch (error) {
            if (error.type === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }
    async getBlockInfoFromDiskByHeight(height = 0) {
        try {
            const blockHashUint8Array = await this.db.get(`height-${height}`);
            const blockHash = new TextDecoder().decode(blockHashUint8Array);

            const blockInfoUint8Array = await this.db.get(`info-${blockHash}`);
            /** @type {BlockInfo} */
            const blockInfo = utils.serializer.rawData.fromBinary_v1(blockInfoUint8Array);

            return blockInfo;
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
     */
    async checkAndHandleReorg(utxoCache) {
        const currentTip = this.getLatestBlockHash(); // The hash of the current tip block (the apex)
        const newTip = this.forkChoiceRule.findBestBlock();

        this.logger.debug({ currentTip, newTip, currentHeight: this.currentHeight }, 'Checking for chain reorganization');

        const shouldReorg = this.forkChoiceRule.shouldReorg(currentTip, newTip);
        if (newTip === currentTip || !shouldReorg) {
            const tipBlock = await this.getBlock(newTip);
            return [tipBlock];
        }

        const blocksToapply = await this.#getBlocksToapply(utxoCache, newTip);
        return blocksToapply;
    }

    /**
     * Performs a chain reorganization.
     * @param {UtxoCache} utxoCache - The UTXO cache to use for the reorg.
     * @param {string} newTip - The hash of the new tip block.
     */
    async #getBlocksToapply(utxoCache, newTip) {
        this.logger.info({ newTip }, 'Performing chain reorganization');

        const reorgPath = this.forkChoiceRule.getReorgPath(this.getLatestBlockHash(), newTip);
        if (!reorgPath) { this.logger.error('Failed to get reorganization path'); return []; }

        const commonAncestorHeight = this.blockTree.getBlockHeight(reorgPath.revert[reorgPath.revert.length - 1]);
        if (commonAncestorHeight === -1) { this.logger.error('Failed to get common ancestor height'); return []; }

        await this.snapshotManager.restoreSnapshot(commonAncestorHeight, utxoCache, this.blockTree);

        /*for (const hash of reorgPath.apply) {
            const block = await this.getBlock(hash);
            await this.applyBlock(utxoCache, block);
        }*/
        this.lastBlock = await this.getBlock(newTip);
        if (!this.lastBlock) { this.logger.error('Failed to get new tip block'); return false; }

        this.currentHeight = this.lastBlock.index;
        await this.db.put('currentHeight', this.currentHeight.toString());

        const blocksData = [];
        for (const hash of reorgPath.apply) {
            const block = await this.getBlock(hash);
            blocksData.push(block);
        }

        return blocksData;
        //this.logger.info({ newTip, newHeight: this.currentHeight }, 'Chain reorganization complete'); not true
    }
    /**
     * @param {UtxoCache} utxoCache
     * @param {Vss} vss
     * @param {BlockData[]} blocksData
     */
    async applyChainReorg(utxoCache, vss, blocksData) {
        for (const block of blocksData) {
            const blockDataCloneToDigest = BlockUtils.cloneBlockData(block); // clone to avoid modification
            const newStakesOutputs = await utxoCache.digestFinalizedBlocks([blockDataCloneToDigest]);
            if (!newStakesOutputs) { continue; }

            vss.newStakes(newStakesOutputs);
        }
    }

    /**
     * Gets the hash of the latest block.
     * @returns {string} The hash of the latest block.
     */
    getLatestBlockHash() {
        return this.lastBlock ? this.lastBlock.hash : "0000000000000000000000000000000000000000000000000000000000000000";
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