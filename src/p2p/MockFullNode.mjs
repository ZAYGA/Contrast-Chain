import { Block, BlockData } from '../Block.mjs';
import { Transaction, Transaction_Builder } from '../Transaction.mjs';
import { FullNode } from '../Node.mjs';
import { Miner } from '../Miner.mjs';
import { Account } from '../Account.mjs';
import utils from '../utils.mjs';
import crypto from 'crypto';
import {Validation} from '../Validation.mjs';

export class MockFullNode {
    constructor(role) {
        this.chain = [{ index: 0, hash: 'genesis', prevHash: null }];
        this.mempool = new Map();
        this.role = role;
        this.pendingBlocks = new Map();
        this.difficulty = 4; // Proof-of-work difficulty (number of leading zeros)
        
        // Create a proper Account instance
        const privateKey = crypto.randomBytes(32).toString('hex');
        const publicKey = crypto.randomBytes(32).toString('hex');
        const address = this.generateMockAddress();
        this.validatorAccount = new Account(publicKey, privateKey, address);
        
        this.miner = new Miner(this.validatorAccount);
    }

    // Generate a mock address that conforms to the expected format
    generateMockAddress() {
        const addressChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let address = 'C'; // Start with 'C' to match the expected format
        for (let i = 0; i < 19; i++) {
            address += addressChars[Math.floor(Math.random() * addressChars.length)];
        }
        return address;
    }

    // Generate a block candidate with current mempool transactions
    async createBlockCandidate() {
        const lastBlock = this.getLastBlock();
        const newIndex = lastBlock.index + 1;
        const newSupply = lastBlock.supply + lastBlock.coinBase;
        const coinBase = Block.calculateNextCoinbaseReward(lastBlock);
        const difficulty = utils.mining.difficultyAdjustment(this.chain);
        
        const transactions = Array.from(this.mempool.values());
        
        this.blockCandidate = BlockData(
            newIndex,
            newSupply,
            coinBase,
            difficulty,
            lastBlock.hash,
            transactions,
            Date.now()
        );
        
        console.log(`Created block candidate with difficulty: ${difficulty}`);
        return this.blockCandidate;
    }

    // Simulate mining by performing proof-of-work
    async mineBlock(blockCandidate) {
        if (this.role !== 'Miner') {
            throw new Error('Only Miner nodes can mine blocks');
        }
    
        console.log(`Mining block ${blockCandidate.index} with difficulty ${blockCandidate.difficulty}...`);
    
        try {
            const { validBlockCandidate } = await this.miner.minePow(blockCandidate);
            console.log(`Block mined! Index: ${validBlockCandidate.index}, Hash: ${validBlockCandidate.hash}`);
            return validBlockCandidate;
        } catch (error) {
            console.error('Error mining block:', error);
            throw error;
        }
    }

    // Validate a mined block
    async validatePowMinedBlock(minedBlock) {
        if (this.role !== 'Validator') {
            throw new Error('Only Validator nodes can validate mined blocks');
        }
    
        if (this.hasBlock(minedBlock.hash)) {
            console.warn(`Block ${minedBlock.index} already exists. Ignoring.`);
            return false;
        }
    
        console.log(`Validating mined block ${minedBlock.index}...`);
    
        if (!await this.isValidBlock(minedBlock)) {
            console.warn(`Block ${minedBlock.index} is invalid`);
            return false;
        }
    
        this.chain.push(minedBlock);
        console.log(`Block ${minedBlock.index} added to chain by ${this.role} with id ${this.id}`);
        return true;
    }

    async verifyIfLastBlockAndAddToChain(blockData) {
        console.log(`Proposing block ${blockData.index} to MockFullNode`);

        // Check if the proposing peer is on the same or ahead in the chain
        if (blockData.index < this.chain.length) {
            console.warn(`Received block ${blockData.index}, but already at height ${this.chain.length}`);
            this.lastValidationError = "Peer behind in chain";
            return false;
        }

        if (this.hasBlock(blockData.hash)) {
            console.log(`Block ${blockData.index} already in chain, ignoring`);
            this.lastValidationError = "Block already exists";
            return false;
        }
        if (blockData.index !== this.chain.length) {
            console.warn(`Received block ${blockData.index}, but expected block ${this.chain.length}`);
            this.lastValidationError = "Incorrect block index";
            return false;
        }
        if (blockData.prevHash !== this.getLastBlock().hash) {
            console.warn(`Invalid previous hash for block ${blockData.index}. Expected ${this.getLastBlock().hash}, got ${blockData.prevHash}`);
            this.lastValidationError = "Invalid previous hash";
            return false;
        }

        // If valid, add the block to the chain
        this.chain.push(blockData);
        console.log(`Block ${blockData.index} added to chain in ${this.role}. New chain length: ${this.chain.length}`);
        return true;
    }

    // Check if a block is valid
    async isValidBlock(block) {
        if (block.index === 0) {
            return true; // Genesis block is always valid
        }
    
        const lastBlock = this.getLastBlock();
        const isCorrectIndex = block.index === lastBlock.index + 1;
        const isCorrectPrevHash = block.prevHash === lastBlock.hash;
    
        const { bitsArrayAsString } = await Block.calculateHash(block);
        try {
            utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, block.difficulty);
        } catch (error) {
            console.warn(`Block ${block.index} does not meet difficulty requirements`);
            return false;
        }
    
        return isCorrectIndex && isCorrectPrevHash;
    }

    // Check if a block with a given hash exists in the chain
    hasBlock(hash) {
        return this.chain.some(block => block.hash === hash);
    }

    // Get the height of the blockchain (last block index)
    getBlockchainHeight() {
        return this.chain.length - 1;
    }

    // Process any pending blocks that couldn't be added initially
    processPendingBlocks() {
        let added = true;
        while (added) {
            added = false;
            for (let [index, block] of this.pendingBlocks) {
                if (index === this.chain.length && block.prevHash === this.getLastBlock().hash) {
                    this.chain.push(block);
                    this.pendingBlocks.delete(index);
                    console.log(`Pending block ${index} added to chain`);
                    added = true;
                    break;
                }
            }
        }
    }
    // Add a transaction to the mempool (after basic validation)
    async addTransactionJSONToMemPool(transactionJSON) {
        try {
            // Basic validation (e.g., check for unique transaction ID)
            if (!transactionJSON.id || this.hasTransaction(transactionJSON.id)) {
                console.log("Transaction is invalid or already exists in the mempool");
                return false;
            }
            Validation.isConformTransaction(transactionJSON, false);
            // Add transaction to mempool
            this.mempool.set(transactionJSON.id, transactionJSON);
            console.log(`Transaction ${transactionJSON.id} added to mempool`);
            return true;
        } catch (error) {
            console.error("Failed to add transaction to mempool:", error);
            return false;
        }
    }

    // Check if a transaction exists in the mempool
    hasTransaction(txId) {
        return this.mempool.has(txId);
    }
    // Get the last block in the chain
    getLastBlock() {
        return this.chain[this.chain.length - 1];
    }

    // Get the current block candidate
    getBlockCandidate() {
        if (!this.blockCandidate) {
            throw new Error('No block candidate available');
        }
        return this.blockCandidate;
    }

    // Get all transactions in the mempool
    getMempoolTransactions() {
        return Array.from(this.mempool.values());
    }

    // Add a block to the chain (used for testing or direct addition)
    addBlock(block) {
        this.chain.push(block);
    }

    // Get blocks in a specific range (used for synchronization)
    getBlocksInRange(start, end) {
        return this.chain.slice(start, end);
    }

    // Get a block by its index
    getBlockByIndex(index) {
        return this.chain[index];
    }

    // Get a block by its hash
    getBlock(hash) {
        return this.chain.find(block => block.hash === hash);
    }

    // Placeholder for block verification (more logic can be added)
    checkBlock(block) {
        return true;
    }
}

export default MockFullNode;