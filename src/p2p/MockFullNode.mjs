import crypto from 'crypto';

export class MockFullNode {
    constructor(role) {
        this.chain = [{ index: 0, hash: 'genesis', prevHash: null }];
        this.mempool = new Map();
        this.role = role;
        this.pendingBlocks = new Map();
        this.difficulty = 4; // Proof-of-work difficulty (number of leading zeros)
        this.validatorAccount = { address: crypto.randomBytes(20).toString('hex') };
    }


    // Generate a block candidate with current mempool transactions
    async createBlockCandidate() {

        this.blockCandidate = {
            index: this.chain.length,
            prevHash: this.getLastBlock().hash,
            transactions: Array.from(this.mempool.values()),
            timestamp: Date.now(),
        };
        return this.blockCandidate;
    }
    // Simulate mining by performing proof-of-work
    async mineBlock(blockCandidate) {
        if (this.role !== 'Miner') {
            throw new Error('Only Miner nodes can mine blocks');
        }

        console.log(`Mining block ${blockCandidate.index}...`);

        // Proof-of-work simulation
        let nonce = 0;
        let hash = '';
        const target = '0'.repeat(this.difficulty);

        // Loop until we find a hash that meets the difficulty requirement
        while (!hash.startsWith(target)) {
            nonce++;
            hash = this.calculateHash(blockCandidate, nonce);
        }

        console.warn(`Block mined! Index: ${blockCandidate.index}, Nonce: ${nonce}, Hash: ${hash}`);

        return { ...blockCandidate, nonce, hash };
    }
    // Calculate the hash for a block candidate and nonce
    calculateHash(blockCandidate, nonce) {
        const data = `${blockCandidate.index}${blockCandidate.prevHash}${JSON.stringify(blockCandidate.transactions)}${blockCandidate.timestamp}${nonce}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    // Validate a mined block
    async validatePowMinedBlock(minedBlock) {
        if (this.role !== 'Validator') {
            throw new Error('Only Validator nodes can validate mined blocks');
        }

        if (this.hasBlock(minedBlock.hash)) {
            console.warn(`Block ${minedBlock.index} already in chain, ignoring`);
            return false;
        }

        console.log(`Validating mined block ${minedBlock.index}...`);

        // Check if the block meets proof-of-work requirements
        if (!this.isValidBlock(minedBlock)) {
            console.warn(`Block ${minedBlock.index} is invalid`);
            return false;
        }

        // Add block to the chain if valid
        this.chain.push(minedBlock);
        console.warn(`Block ${minedBlock.index} added to chain by ${this.role} with id ${this.id}`);
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
    isValidBlock(block) {

        if (block.index === 0) {
            return true; // Genesis block is always valid
        }
        const target = '0'.repeat(this.difficulty);
        const hash = this.calculateHash(block, block.nonce);

        // Ensure block index and previous hash are correct
        const isCorrectIndex = block.index === this.chain.length;
        const isCorrectPrevHash = block.prevHash === this.getLastBlock().hash;
        const meetsDifficulty = hash.startsWith(target);

        return isCorrectIndex && isCorrectPrevHash && meetsDifficulty;
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
            const transaction = JSON.parse(transactionJSON);

            // Basic validation (e.g., check for unique transaction ID)
            if (!transaction.id || this.hasTransaction(transaction.id)) {
                console.log("Transaction is invalid or already exists in the mempool");
                return false;
            }

            // Add transaction to mempool
            this.mempool.set(transaction.id, transaction);
            console.log(`Transaction ${transaction.id} added to mempool`);
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
