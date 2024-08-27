class BlockValidator {
    constructor(blockMiner, transactionValidator) {
      this.blockMiner = blockMiner;
      this.transactionValidator = transactionValidator;
    }
  
    async isValidBlock(block) {
      const isValidHash = await this.validateBlockHash(block);
      const isValidProof = await this.blockMiner.isValidProof(block, block.nonce);
      // get array of transactions
      let transactions = JSON.parse(block.data);
      block.transactions = transactions;
      const areValidTransactions = await this.validateBlockTransactions(block);
  
      return isValidHash && isValidProof && areValidTransactions;
    }
  
    async validateBlockHash(block) {
      const calculatedHash = await this.blockMiner.calculateHash(block);
      return block.hash === calculatedHash;
    }
  
    async validateBlockTransactions(block) {
      for (const tx of block.transactions) {
        if (!await this.transactionValidator.isValidTransaction(tx)) {
          console.error('Block validation failed: Invalid transaction');
          return false;
        }
      }
      return true;
    }
  }

  export { BlockValidator };