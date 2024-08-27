import { expect } from 'chai';
import sinon from 'sinon';
import { NodeManager } from '../../src/node-manager.mjs';

function createDummyTransaction(id, data) {
  return {
    id,
    data,
    timestamp: Date.now(),
    signature: 'dummy_signature'
  };
}


describe('NodeManager and PubSubManager Integration with Different Node Types', () => {
  let network;

  beforeEach(async function() {
    this.timeout(15000);  // Increase timeout to 15 seconds
    try {
      network = new NodeManager();
      await network.createNode('validator4', { role: 'validator', listenAddress: '/ip4/127.0.0.1/tcp/13001' });
      await network.createNode('validator5', { role: 'validator', listenAddress: '/ip4/127.0.0.1/tcp/13004' });
      await network.createNode('miner6', { role: 'miner', listenAddress: '/ip4/127.0.0.1/tcp/13002' });
      await network.createNode('fullnode7', { listenAddress: '/ip4/127.0.0.1/tcp/13003' });

      // Ensure all nodes are connected
      await network.connectAllNodes();
      console.log('All nodes connected');

      // Subscribe all nodes to necessary topics
      await network.subscribeAll('transactions', () => {});
      await network.subscribeAll('block_candidate', () => {});
      await network.subscribeAll('mined_block', () => {});

      console.log('All nodes subscribed to necessary topics');

      // Wait for connections and subscriptions to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error in test setup:', error);
      throw error;
    }
  });

  afterEach(async () => {
    if (network) {
      await network.shutdownAllNodes();
      console.log('All nodes shut down');
    }
  });
  it('should propagate mined blocks across the network', async () => {
    const minedBlockListener = sinon.spy();
    network.subscribeAll('mined_block', minedBlockListener);
    console.log('All nodes subscribed to mined_block topic');

    await new Promise(resolve => setTimeout(resolve, 1000));

    for (let i = 1; i <= 5; i++) {
        const transaction = createDummyTransaction(`tx${i}`, `Transaction ${i} data`);
        const fullNode = network.getNode('fullnode7');
        console.log(`Broadcasting transaction ${i} from full node`);
        await fullNode.getPubSubManager().broadcast('transactions', transaction);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Mined block listener call count:', minedBlockListener.callCount);
    if (minedBlockListener.called) {
        console.log('Mined blocks received:', minedBlockListener.args.map(call => call[0]));
    }
    expect(minedBlockListener.callCount).to.be.at.least(1);
});

  it('should mine blocks and broadcast mined blocks', async function() {
    this.timeout(30000);
    const minedBlockListener = sinon.spy();
    await network.subscribeAll('mined_block', minedBlockListener);

    const transaction = createDummyTransaction('tx1', 'Transaction 1 data');
    const fullNode = network.getNode('fullnode1');
    await fullNode.getPubSubManager().broadcast('transactions', transaction);

    // Wait for block mining and propagation
    await new Promise(resolve => setTimeout(resolve, 6000));

    expect(minedBlockListener.callCount).to.be.at.least(1);
  });

  it('should broadcast block candidates from validator to miner', async function() {
    const blockCandidateListener = sinon.spy();
    await network.subscribeAll('block_candidate', blockCandidateListener);

    const transaction = createDummyTransaction('tx1', 'Transaction 1 data');
    const fullNode = network.getNode('fullnode1');
    await fullNode.getPubSubManager().broadcast('transactions', transaction);

    // Wait for block candidate creation and propagation
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Block candidate listener called:', blockCandidateListener.called);
    expect(blockCandidateListener.called).to.be.true;
  });

  it('should create different types of nodes', () => {
      const validator = network.getNode('validator1');
      const miner = network.getNode('miner1');
      const fullNode = network.getNode('fullnode1');

      console.log('Validator role:', validator.getRole());
      console.log('Miner role:', miner.getRole());
      console.log('Full node role:', fullNode.getRole());

      expect(validator.getRole()).to.equal('validator');
      expect(miner.getRole()).to.equal('miner');
      expect(fullNode.getRole()).to.equal('full');
  });

  it('should handle transactions and create block candidates', async function() {
    this.timeout(10000);  // Increase timeout for this specific test

    const blockCandidateListener = sinon.spy();
    await network.subscribeAll('block_candidate', blockCandidateListener);
    console.log('All nodes subscribed to block_candidate topic');

    await new Promise(resolve => setTimeout(resolve, 1000));

    const transaction = createDummyTransaction('tx1', 'Transaction 1 data');
    const fullNode = network.getNode('fullnode1');
    console.log('Broadcasting transaction from full node');
    try {
      await fullNode.getPubSubManager().broadcast('transactions', transaction);
      console.log('Transaction broadcast successful');
    } catch (error) {
      console.error('Error broadcasting transaction:', error);
      throw error;
    }

    // Wait longer for block candidate creation and propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Block candidate listener called:', blockCandidateListener.called);
    console.log('Block candidate listener call count:', blockCandidateListener.callCount);
    if (blockCandidateListener.called) {
      console.log('Block candidate received:', blockCandidateListener.firstCall.args[0]);
    }
    expect(blockCandidateListener.called).to.be.true;
  });

  it('should handle node shutdown gracefully', async () => {
      const minedBlockListener = sinon.spy();
      network.subscribeAll('mined_block', minedBlockListener);

      await new Promise(resolve => setTimeout(resolve, 1000));
      // Shutdown the miner node
      await network.shutdownNode('miner1');

      // Create a transaction to trigger block candidate creation
      const transaction = createDummyTransaction('tx1', 'Transaction 1 data');
      const fullNode = network.getNode('fullnode1');
      await fullNode.getPubSubManager().broadcast('transactions', transaction);

      // Wait for potential mining (which shouldn't happen)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Assert that no mined blocks were received (since the miner is shut down)
      expect(minedBlockListener.callCount).to.equal(0);
  });
});