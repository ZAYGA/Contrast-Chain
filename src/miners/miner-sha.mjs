import crypto from 'crypto';
import { Miner } from '../miner.mjs';

class Sha256Miner extends Miner {
  
  constructor(difficulty = 1) {
    super(difficulty);
  }

  async isValidProof(block, nonce) {
    const hash = await this.calculateHash(block.index, block.previousHash, block.timestamp, block.data, nonce);
    let isValid = hash.substring(0, this.difficulty) === "0".repeat(this.difficulty);
    return isValid;
  }

  async calculateHash(index, previousHash, timestamp, data, nonce) {
    const content = `${index}${previousHash}${timestamp}${data}${nonce}`;
    // Directly return the hash, no need to wrap it in a Promise
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}

export { Sha256Miner };
