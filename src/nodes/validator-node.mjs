import { BlockchainNode } from '../blockchain-node.mjs';
import { ForkChoiceRule } from '../fork-rule.mjs';
import Mempool from '../mempool.mjs';
import { TransactionValidator } from '../transaction-validator.mjs';

class ValidatorNode extends BlockchainNode {
    constructor(options, pubSubManager, blockManager, eventBus, forkChoiceRule) {
        super(options, pubSubManager, blockManager, eventBus);
        this.role = 'validator';
        this.mempool = new Mempool({
            maxSize: 1000,
            cleanupInterval: 1800000, // 30 minutes
            expirationTime: 12 * 60 * 60 * 1000 // 12 hours
          }); // Create a new Mempool with a capacity of 1000 transactions
        this.blockCandidateInterval = null;
        this.blockTree = new Map();
        this.genesisBlockHash = "0".repeat(64);
        this.forkChoiceRule = forkChoiceRule || new ForkChoiceRule(this.genesisBlockHash);
        this.transactionValidator = new TransactionValidator(this.blockManager.utxoManager);
        
    }

    async start() {
        await super.start();
        this.eventBus.on('newMinedBlock', this.handleNewBlock.bind(this));
        this.eventBus.on('newTransaction', this.handleTransaction.bind(this));

        await this.initializeGenesisBlock();
        this.startBlockCandidateCreation();
    }

    async initializeGenesisBlock() {
        const genesisBlock = {
            hash: this.genesisBlockHash,
            previousHash: null,
            index: 0,
            timestamp: Date.now(),
            data: [],
            score: 0
        };
        await this.addBlockToTree(genesisBlock);
        this.blockManager.setLatestBlockHash(this.genesisBlockHash);
        this.blockManager.setLatestBlockNumber(0);
    }

    async handleNewBlock({ minedBlock }) {
        try {
            if (await this.blockManager.isValidBlock(minedBlock)) {
                await this.processBlock(minedBlock);
                await this.updateChain();
            } else {
                console.error(`ValidatorNode: Received invalid block ${minedBlock.hash}, ignoring`);
            }
        } catch (error) {
            console.error(`ValidatorNode: Error handling new block ${minedBlock.hash}:`, error);
        }
    }

    async processBlock(block) {
        if (this.blockTree.has(block.hash)) {
            return;
        }
        await this.addBlockToTree(block);
    }

    async addBlockToTree(block) {
        try {
            const blockInfo = {
                block,
                children: [],
                height: block.index
            };
            this.blockTree.set(block.hash, blockInfo);

            if (block.previousHash) {
                const parentInfo = this.blockTree.get(block.previousHash);
                if (parentInfo) {
                    parentInfo.children.push(block.hash);
                }
            }
        } catch (error) {
            console.error(`Error adding block ${block.hash} to tree:`, error);
        }
    }

    async updateChain() {
        try {
            const bestBlock = this.forkChoiceRule.findBestBlock(this.blockTree);
            if (bestBlock && bestBlock !== this.blockManager.getLatestBlockHash()) {
                await this.switchToChain(bestBlock);
                this.blockManager.addBlock(this.blockTree.get(bestBlock).block);
                this.removeTransactionsFromMempool(this.blockTree.get(bestBlock).block);
            }
        } catch (error) {
            console.error('ValidatorNode: Error updating chain:', error);
        }
    }

    async removeTransactionsFromMempool(block) {
        const transactions = JSON.parse(block.data);
        
        for (const tx of transactions) {
            this.mempool.removeTransaction(tx.id);
            console.warn(`ValidatorNode: Removed transaction ${tx.id} from mempool`);
        }


        console.log(`ValidatorNode: Removed block transactions from mempool. Mempool size: ${this.mempool.getStats().totalTransactions}`);
    }

    async switchToChain(newTipHash) {
        try {
            console.log(`ValidatorNode: Switching to new chain tip: ${newTipHash}`);
            const newTipBlock = this.blockTree.get(newTipHash)?.block;
            if (newTipBlock) {
                this.blockManager.setLatestBlockHash(newTipHash);
                this.blockManager.setLatestBlockNumber(newTipBlock.index);
            } else {
                throw new Error(`New tip block ${newTipHash} not found in blockTree`);
            }
        } catch (error) {
            console.error('ValidatorNode: Error switching to new chain:', error);
        }
    }

    handleTransaction(message) {
        const transaction = message.transaction || message;
        if (this.isValidTransaction(transaction)) {
            const added = this.mempool.addTransaction(transaction);
            if (added) {
                console.log(`ValidatorNode: Transaction added to mempool. Mempool size: ${this.mempool.getStats().totalTransactions}`);
            } else {
                console.log(`ValidatorNode: Transaction not added to mempool (possibly duplicate or mempool full)`);
            }
        } else {
            console.error(`ValidatorNode: Invalid transaction received, ignoring: ${JSON.stringify(transaction)}`);
        }
    }

    isValidTransaction(transaction) {
        return this.transactionValidator.isValidTransaction(transaction);
    }

    async createBlockCandidate() {
        console.log(`ValidatorNode: Creating block candidate. Mempool size: ${this.mempool.getStats().totalTransactions}`);

        const nextBlockNumber = this.blockManager.getLatestBlockNumber() + 1;
        const previousBlockHash = this.blockManager.getLatestBlockHash();

        // Select transactions from mempool
        const transactions = this.mempool.selectTransactionsForBlock(1000000, 10); // Assume 1MB block size limit and max 10 transactions
        console.log(`ValidatorNode: Selected ${transactions.length} transactions for the block`);

        const blockCandidate = this.blockManager.createBlock(
            nextBlockNumber,
            previousBlockHash,
            JSON.stringify(transactions)
        );
        blockCandidate.score = transactions.length + 1;
        
        console.log(`ValidatorNode: Created block candidate: ${blockCandidate.hash}, score: ${blockCandidate.score}, transactions: ${blockCandidate.data}`);
      
        await this.pubSubManager.broadcast('block_candidate', blockCandidate);
        
        // Remove used transactions from the mempool
        transactions.forEach(tx => this.mempool.removeTransaction(tx.id));
        console.log(`ValidatorNode: Updated mempool size after block creation: ${this.mempool.getStats().totalTransactions}`);
    }

    startBlockCandidateCreation() {
        this.blockCandidateInterval = setInterval(() => {
            this.createBlockCandidate().catch(error => 
                console.error('ValidatorNode: Error creating block candidate:', error)
            );
        }, 5000);
    }

    async stop() {
        if (this.blockCandidateInterval) {
            clearInterval(this.blockCandidateInterval);
            this.blockCandidateInterval = null;
        }
        this.eventBus.removeAllListeners();;
        await super.stop();
        console.log('ValidatorNode: Stopped');
    }
}

export { ValidatorNode };