class Miner {
    constructor(difficulty = 1) {
      this.difficulty = difficulty;
    }
  
    mine(block) {
      throw new Error('Method not implemented');
    }
  
    isValidProof(block, nonce) {
      throw new Error('Method not implemented');
    }
  }
  
  export { Miner };
  