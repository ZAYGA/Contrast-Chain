// BlockManager.mjs (updated)
import { BlockSerializer } from './serializers/block-serializer.mjs';
import { UTXOManager } from './utxo-manager.mjs';
import { TransactionValidator } from './transaction-validator.mjs';
import { BlockValidator } from './block-validator.mjs';
import { UTXOHandler } from './utxo-handler.mjs';
import { BlockMiner } from './block-miner.mjs';

class BlockManager {
  constructor(storage, id) {
    this.blockMiner = new BlockMiner(8);
    this.storage = storage;
    this.blockSerializer = new BlockSerializer();
    this.utxoManager = new UTXOManager(`./utxo-db${id}`);
    this.transactionValidator = new TransactionValidator(this.utxoManager);
    this.blockValidator = new BlockValidator(this.blockMiner,this.transactionValidator);
    this.utxoHandler = new UTXOHandler(this.utxoManager);
    this.latestBlockNumber = 0;
    this.latestBlockHash = "0".repeat(64); // Genesis block hash
  }

  async initialize() {
    console.log('Initializing block manager');
    await this.utxoManager.initialize();
    
  }

  createBlock(index, previousHash, data) {
    return {
      index: Number(index),
      previousHash: String(previousHash),
      timestamp: Date.now(),
      data: String(data),
      nonce: 0,
      hash: '',
      score: 1,
      transactions: []
    };
  }

  async loadLatestBlockInfo() {
    const latestBlock = await this.storage.getLatestBlock();
    if (latestBlock) {
      this.latestBlockNumber = latestBlock.index;
      this.latestBlockHash = latestBlock.hash;
    }
  }

  async isValidBlock(block) {
    return this.blockValidator.isValidBlock(block);
  }

  async addBlock(block) {
    await this.storage.saveBlock(block);
    
    this.updateLatestBlockInfo(block);
    await this.processBlockTransactions(block);
    await this.utxoHandler.updateUTXOSet(block);
    await this.utxoManager.commitBatch();
    
  }

  updateLatestBlockInfo(block) {
    this.latestBlockNumber = block.index;
    this.latestBlockHash = block.hash;
  }

  async processBlockTransactions(block) {
    const transactions = JSON.parse(block.data);
    for (const tx of transactions) {
      await this.utxoHandler.processTransaction(tx);
    }
  }

  getLatestBlockNumber() {
    return this.latestBlockNumber;
  }

  getLatestBlockHash() {
    return this.latestBlockHash;
  }

  setLatestBlockNumber(n) {
    this.latestBlockNumber = n;
  }

  setLatestBlockHash(hash) {
    this.latestBlockHash = hash;
  }

  async getBalance(address) {
    return this.utxoHandler.getBalance(address);
  }
}

export { BlockManager };