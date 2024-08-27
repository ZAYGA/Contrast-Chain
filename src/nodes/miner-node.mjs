import { BlockchainNode } from '../blockchain-node.mjs';
import { BlockMiner } from '../block-miner.mjs';
import {utils} from '../utils.mjs';

class MinerNode extends BlockchainNode {
  constructor(options, pubSubManager, blockManager, eventBus) {
    super(options, pubSubManager, blockManager, eventBus);
    this.role = 'miner';
    this.pendingBlockCandidate = null;
    this.isMining = false;
    this.minerAddress = options.minerAddress;
    this.blockMiner = new BlockMiner(8); // difficulty set to 1
    console.log('MinerNode constructed');
  }

  async start() {
    await super.start();

    console.log(`MinerNode: Starting miner node with PeerId: ${this.node.peerId.toString()}`);

    this.eventBus.on('newBlockCandidate', this.handleBlockCandidate.bind(this));

    console.log('MinerNode: Subscribed to block_candidate topic');
  }

  async handleBlockCandidate(blockCandidate) {
    console.warn(`MinerNode: Received block candidate`);
    if (!this.isMining) {
      this.pendingBlockCandidate = blockCandidate.blockCandidate;
      await this.startMining();
    } else {
      console.error('MinerNode: Already mining, ignoring new block candidate');
    }
  }

  async startMining() {
    if (!this.pendingBlockCandidate) {
      console.log('MinerNode: No pending block candidate to mine');
      return;
    }

    this.isMining = true;
    try {
      console.log('MinerNode: Mining block...', this.pendingBlockCandidate.index);
      
      const minedBlock = await this.mineBlock(
        this.minerAddress, 
        this.pendingBlockCandidate.index, 
        this.pendingBlockCandidate
      );
      
      if (minedBlock) {
        const isValid = await this.blockManager.isValidBlock(minedBlock);
        console.warn(`MinerNode: Is mined block valid? ${isValid}`);
        
        if (isValid) {
          // Broadcast the mined block
          await this.pubSubManager.broadcast('mined_block', minedBlock);
          // Add the block to the blockchain
          await this.blockManager.addBlock(minedBlock);
          console.warn(`MinerNode: Mining complete and block added to chain`);
        } else {
          console.error('MinerNode: Mined block is invalid, not broadcasting');
        }
      } else {
        console.error('MinerNode: Mining failed, block was not produced');
      }
    } catch (error) {
      console.error('MinerNode: Error during mining process:', error);
    } finally {
      this.isMining = false;
      this.pendingBlockCandidate = null;
    }
  }

  async mineBlock(minerAddress, index, blockCandidate) {
    console.log(`Mining block ${index} with block candidate: ${JSON.stringify(blockCandidate)}`);

    const coinbaseTx = utils.createCoinbaseTransaction(minerAddress);
    const newBlock = this.blockManager.createBlock(index, blockCandidate.previousHash, blockCandidate.data);
    newBlock.transactions = [coinbaseTx, ...JSON.parse(blockCandidate.data)];

    const minedBlock = await this.blockMiner.mineBlock(newBlock);
    return minedBlock;
  }

  async stop() {
    await super.stop();
    console.log('MinerNode stopped');
  }

}

export { MinerNode };