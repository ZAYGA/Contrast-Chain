import LevelUp from 'levelup';
import LevelDown from 'leveldown';
import { BlockTree } from './block-tree.mjs';
import { ForkChoiceRule } from './fork-rule.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { Block } from './block.mjs';

export class BlockchainStorage {
    constructor(dbPath) {
        this.db = LevelUp(LevelDown(dbPath));
        this.blockTree = new BlockTree('ContrastGenesisBlock');
        this.forkChoiceRule = new ForkChoiceRule(this.blockTree);
        this.utxoCache = new UtxoCache();
        this.inMemoryBlocks = new Map();
        this.maxInMemoryBlocks = 1000;
        this.currentHeight = 0;
        this.lastBlock = null;

    }

    async init() {

    }

    async addBlock(block) {
        this.db.open();
        // Add block to in-memory storage
        console.log('Adding block to memory, height:', block.index);
        this.inMemoryBlocks.set(block.hash, block);

        // If we've exceeded the max in-memory blocks, remove the oldest
        if (this.inMemoryBlocks.size > this.maxInMemoryBlocks) {
            console.log('Removing oldest block from memory');
            const oldestBlock = this.inMemoryBlocks.keys().next().value;
            if (oldestBlock === undefined || oldestBlock === null) {
                throw new Error('Failed to get oldest block');
            }
            console.log('Persisting block to disk:', oldestBlock);
            const block = this.inMemoryBlocks.get(oldestBlock);
            this.inMemoryBlocks.delete(oldestBlock);
            await this.persistBlockToDisk(block);
        }

        // Update block tree
        this.blockTree.addBlock({
            hash: block.hash,
            prevHash: block.prevHash,
            height: block.index,
            score: this.calculateBlockScore(block)
        });
        console.log('Block tree updated, height:', block.index);
        // Update UTXO cache
        await this.utxoCache.digestFinalizedBlocks([block]);

        // Check if we need to do a chain reorganization
        await this.checkAndHandleReorg();

    }

    calculateBlockScore(block) {
        return block.index;
    }

    async getBlock(hash) {
        // Check in-memory first
        if (this.inMemoryBlocks.has(hash)) {
            return this.inMemoryBlocks.get(hash);
        }

        // If not in memory, fetch from disk
        return this.getBlockFromDisk(hash);
    }

    async persistBlockToDisk(block) {

        console.log('Persisting block to disk:', block);
        await this.db.put(block.hash, Block.dataAsJSON(block));
    }

    async getBlockFromDisk(hash) {
        const blockJSON = await this.db.get(hash);
        return Block.blockDataFromJSON(blockJSON);
    }

    async checkAndHandleReorg() {
        const currentTip = this.getLatestBlockHash();
        const newTip = this.forkChoiceRule.findBestBlock();

        if (newTip !== currentTip && this.forkChoiceRule.shouldReorg(currentTip, newTip)) {
            await this.performChainReorg(newTip);
        }
    }

    async performChainReorg(newTip) {
        const reorgPath = this.forkChoiceRule.getReorgPath(this.getLatestBlockHash(), newTip);
        if (!reorgPath) return;

        for (const hash of reorgPath.revert) {
            await this.revertBlock(hash);
        }

        for (const hash of reorgPath.apply) {
            const block = await this.getBlock(hash);
            await this.applyBlock(block);
        }

        this.lastBlock = await this.getBlock(newTip);
        this.currentHeight = this.lastBlock.index;
    }

    async revertBlock(hash) {

    }

    async applyBlock(block) {
        await this.utxoCache.digestFinalizedBlocks([block]);
    }

    getLatestBlockHash() {
        if (!this.lastBlock) return "ContrastGenesisBlock";
        return this.lastBlock.hash;
    }


}