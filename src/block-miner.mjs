import { ArgonMiner } from './miners/miner-argon.mjs';

class BlockMiner {
  constructor(difficulty) {
    this.miner = new ArgonMiner(difficulty);
  }

  async mineBlock(block) {
    let nonce = 0;
    while (!(await this.isValidProof(block, nonce))) {
      nonce++;
    }
    block.nonce = nonce;
    block.hash = await this.miner.calculateHash(block.index, block.previousHash, block.timestamp, block.data, nonce);
    return block;
  }

  async isValidProof(block, nonce) {
    return this.miner.isValidProof(block, nonce);
  }

  async calculateHash(block) {
    return this.miner.calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.nonce);
  }
}

export { BlockMiner };