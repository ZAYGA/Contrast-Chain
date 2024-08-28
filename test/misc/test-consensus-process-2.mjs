import { expect } from 'chai';
import sinon from 'sinon';
import { NodeManager } from '../../core/node-manager.mjs';

describe('Extended Consensus Process', function() {
  this.timeout(60000); // Set a longer timeout for these extended tests

  let nodeManager;
  let validatorNode;
  let minerNode;
  let fullNode;

  before(async function() {
    nodeManager = new NodeManager();

    validatorNode = await nodeManager.createNode('validator1', { 
      role: 'validator', 
      listenAddress: '/ip4/127.0.0.1/tcp/11020'
    });

    minerNode = await nodeManager.createNode('miner1', { 
      role: 'miner', 
      listenAddress: '/ip4/127.0.0.1/tcp/11021',
      minerAddress: 'miner1_address'
    });


    await nodeManager.connectAllNodes();

    // Subscribe all nodes to necessary topics
    await nodeManager.subscribeAll('transactions', () => {});
    await nodeManager.subscribeAll('block_candidate', () => {});
    await nodeManager.subscribeAll('mined_block', () => {});

    // Wait for connections and subscriptions to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  after(async function() {
    await nodeManager.shutdownAllNodes();
  });

  function createRandomTransaction() {
    const id = Math.random().toString(36).substring(7);
    const amount = Math.floor(Math.random() * 1000) + 1;
    return { id, from: `user${Math.floor(Math.random() * 100)}`, to: `user${Math.floor(Math.random() * 100)}`, amount };
  }

  async function mineBlockAndWait() {
    const minedBlockListener = sinon.spy();
    validatorNode.eventBus.on('newMinedBlock', minedBlockListener);

    // Wait for mining process
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(minedBlockListener.called).to.be.true;
    const minedBlock = minedBlockListener.firstCall.args[0].minedBlock;
    expect(minedBlock).to.have.property('hash');
    expect(minedBlock.hash.substring(0, 4)).to.equal('0000'); // Assuming difficulty is 4

    return minedBlock;
  }

  it('should process multiple transactions and create multiple blocks', async function() {
    const initialBlockNumber = validatorNode.blockManager.getLatestBlockNumber();

    // Create and broadcast 20 random transactions
    for (let i = 0; i < 20; i++) {
      const transaction = createRandomTransaction();
      await validatorNode.getPubSubManager().broadcast('transactions', transaction);
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between transactions
    }

    // Mine multiple blocks
    for (let i = 0; i < 3; i++) {
      console.log(`Mining block ${i + 1}`);
      const minedBlock = await mineBlockAndWait();
      console.log(`Mined block ${i + 1}:`, minedBlock);
    }

    // Check that the blockchain has progressed
    const finalBlockNumber = validatorNode.blockManager.getLatestBlockNumber();
    expect(finalBlockNumber).to.be.greaterThan(initialBlockNumber);
    console.log(`Blockchain progressed from block ${initialBlockNumber} to ${finalBlockNumber}`);
  });

  it('should handle a burst of transactions', async function() {
    const initialBlockNumber = validatorNode.blockManager.getLatestBlockNumber();

    // Create and broadcast 50 transactions rapidly
    const transactionPromises = [];
    for (let i = 0; i < 50; i++) {
      const transaction = createRandomTransaction();
      transactionPromises.push(validatorNode.getPubSubManager().broadcast('transactions', transaction));
    }
    await Promise.all(transactionPromises);

    // Mine blocks to process the burst of transactions
    for (let i = 0; i < 5; i++) {
      console.log(`Mining block for burst ${i + 1}`);
      const minedBlock = await mineBlockAndWait();
      console.log(`Mined block for burst ${i + 1}:`, minedBlock);
    }

    const finalBlockNumber = validatorNode.blockManager.getLatestBlockNumber();
    expect(finalBlockNumber).to.be.greaterThan(initialBlockNumber);
    console.log(`Blockchain handled burst: progressed from block ${initialBlockNumber} to ${finalBlockNumber}`);
  });

  it('should maintain consistent state across all nodes', async function() {
    // Wait for any ongoing processes to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    const validatorBlockNumber = validatorNode.blockManager.getLatestBlockNumber();
    const minerBlockNumber = minerNode.blockManager.getLatestBlockNumber();
    const fullNodeBlockNumber = validatorNode.blockManager.getLatestBlockNumber();

    console.log('Final block numbers:', {
      validator: validatorBlockNumber,
      miner: minerBlockNumber,
      fullNode: fullNodeBlockNumber
    });

    expect(validatorBlockNumber).to.equal(minerBlockNumber);
    expect(minerBlockNumber).to.equal(fullNodeBlockNumber);

    const validatorBlockHash = validatorNode.blockManager.getLatestBlockHash();
    const minerBlockHash = minerNode.blockManager.getLatestBlockHash();
    const fullNodeBlockHash = validatorNode.blockManager.getLatestBlockHash();

    console.log('Final block hashes:', {
      validator: validatorBlockHash,
      miner: minerBlockHash,
      fullNode: fullNodeBlockHash
    });

    expect(validatorBlockHash).to.equal(minerBlockHash);
    expect(minerBlockHash).to.equal(fullNodeBlockHash);
  });

  it('should handle reorganization when a longer chain is received', async function() {
    // Simulate a network partition by disconnecting the miner
    await nodeManager.shutdownNode('miner1');

    // Create some transactions and mine blocks on the main network
    for (let i = 0; i < 3; i++) {
      const transaction = createRandomTransaction();
      await validatorNode.getPubSubManager().broadcast('transactions', transaction);
      await mineBlockAndWait();
    }

    const mainChainBlockNumber = validatorNode.blockManager.getLatestBlockNumber();

    // Reconnect the miner with a longer chain
    minerNode = await nodeManager.createNode('miner1', { 
      role: 'miner', 
      listenAddress: '/ip4/127.0.0.1/tcp/10002',
      minerAddress: 'miner1_address'
    });

    // Simulate a longer chain on the miner
    for (let i = 0; i < 5; i++) {
      const transaction = createRandomTransaction();
      await minerNode.getPubSubManager().broadcast('transactions', transaction);
      await mineBlockAndWait();
    }

    // Wait for reorganization
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Check that all nodes have adopted the longer chain
    const finalValidatorBlockNumber = validatorNode.blockManager.getLatestBlockNumber();
    const finalMinerBlockNumber = minerNode.blockManager.getLatestBlockNumber();
    const finalFullNodeBlockNumber = fullNode.blockManager.getLatestBlockNumber();

    console.log('Block numbers after reorg:', {
      validator: finalValidatorBlockNumber,
      miner: finalMinerBlockNumber,
      fullNode: finalFullNodeBlockNumber
    });

    expect(finalValidatorBlockNumber).to.be.greaterThan(mainChainBlockNumber);
    expect(finalValidatorBlockNumber).to.equal(finalMinerBlockNumber);
    expect(finalMinerBlockNumber).to.equal(finalFullNodeBlockNumber);

    // Verify that all nodes have the same latest block hash
    const finalValidatorBlockHash = validatorNode.blockManager.getLatestBlockHash();
    const finalMinerBlockHash = minerNode.blockManager.getLatestBlockHash();
    const finalFullNodeBlockHash = fullNode.blockManager.getLatestBlockHash();

    console.log('Block hashes after reorg:', {
      validator: finalValidatorBlockHash,
      miner: finalMinerBlockHash,
      fullNode: finalFullNodeBlockHash
    });

    expect(finalValidatorBlockHash).to.equal(finalMinerBlockHash);
    expect(finalMinerBlockHash).to.equal(finalFullNodeBlockHash);
  });
});