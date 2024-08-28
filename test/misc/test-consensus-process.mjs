import { expect } from 'chai';
import sinon from 'sinon';
import { NodeManager } from '../../core/node-manager.mjs';

describe('Consensus Process', function() {
  this.timeout(30000); // Set a longer timeout for these tests

  let nodeManager;
  let validatorNode;
  let minerNode;
  let fullNode;

  before(async function() {
    nodeManager = new NodeManager();

    validatorNode = await nodeManager.createNode('validator1', { 
      role: 'validator', 
      listenAddress: '/ip4/127.0.0.1/tcp/12001'
    });

    minerNode = await nodeManager.createNode('miner1', { 
      role: 'miner', 
      listenAddress: '/ip4/127.0.0.1/tcp/12002',
      minerAddress: 'miner1_address'
    });

    fullNode = await nodeManager.createNode('fullnode1', { 
      role: 'full',
      listenAddress: '/ip4/127.0.0.1/tcp/12003'
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
  it('should mine blocks from block candidates', async function() {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const minedBlockListener = sinon.spy();
    fullNode.eventBus.on('newMinedBlock', minedBlockListener);

    // add transactions to miner node
    for (let i = 0; i < 5; i++) {
      const transaction = { id: `tx${i+7}`, data: `user${i+7}`};
      await fullNode.getPubSubManager().broadcast('transactions', transaction
      );
    }

    // Wait for mining process
    await new Promise(resolve => setTimeout(resolve, 10000));

    expect(minedBlockListener.called).to.be.true;
    const minedBlock = minedBlockListener.firstCall.args[0].minedBlock;
    expect(minedBlock).to.have.property('hash');
    expect(minedBlock.hash.substring(0, 4)).to.equal('0000'); // Assuming difficulty is 4
  })


  it('should create block candidates from transactions', async function() {
    const blockCandidateListener = sinon.spy();
    minerNode.eventBus.on('newBlockCandidate', blockCandidateListener);

    // Generate multiple transactions
    for (let i = 0; i < 5; i++) {
      const transaction = { id: `tx${i+2}`, data: `user${i+2}`};
      await fullNode.getPubSubManager().broadcast('transactions', transaction);
    }

    // Wait for block candidate creation
    await new Promise(resolve => setTimeout(resolve, 6000));

    expect(blockCandidateListener.called).to.be.true;
    const blockCandidate = blockCandidateListener.firstCall.args[0].blockCandidate;
    expect(blockCandidate).to.have.property('data');
    const transactions = JSON.parse(blockCandidate.data);
    expect(transactions).to.have.lengthOf.at.least(1);
  });

  it('should propagate transactions across the network', async function() {
    const transactionListener = sinon.spy();
    validatorNode.eventBus.on('newTransaction', transactionListener);

    const transaction = { id: 'tx1', data: 'user1'};
    await fullNode.getPubSubManager().broadcast('transactions', transaction);

    // Wait for transaction propagation
    await new Promise(resolve => setTimeout(resolve, 5000));

    expect(transactionListener.calledOnce).to.be.true;
    expect(transactionListener.firstCall.args[0].transaction).to.deep.equal(transaction);
  });
 
  it('should maintain consensus across all nodes', async function() {
    // Wait for any ongoing processes to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    const validatorBlockNumber = validatorNode.blockManager.getLatestBlockNumber();
    const minerBlockNumber = minerNode.blockManager.getLatestBlockNumber();
    const fullNodeBlockNumber = fullNode.blockManager.getLatestBlockNumber();

    expect(validatorBlockNumber).to.equal(minerBlockNumber);
    expect(minerBlockNumber).to.equal(fullNodeBlockNumber);

    const validatorBlockHash = validatorNode.blockManager.getLatestBlockHash();
    const minerBlockHash = minerNode.blockManager.getLatestBlockHash();
    const fullNodeBlockHash = fullNode.blockManager.getLatestBlockHash();

    expect(validatorBlockHash).to.equal(minerBlockHash);
    //expect(minerBlockHash).to.equal(fullNodeBlockHash);
  });
});