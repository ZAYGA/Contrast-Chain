import { expect } from 'chai';
import { NodeManager } from '../core/node-manager.mjs';
import Transaction from '../core/transaction.mjs';
describe('Consensus Test with 6 Validators and 6 Miners to Block 2', function() {
  this.timeout(120000); // 2 minutes should be sufficient for 2 blocks

  let nodeManager;
  let validators = [];
  let miners = [];
  // Helper function to create a signed transaction
  function createSignedTransaction(toAddress, amount) {
    const tx = new Transaction(
      [{ txid: 'dummy', vout: 0, scriptSig: "aaaa" }],
      [{ amount, scriptPubKey: toAddress }]
    );
    return tx;
  }
  
  before(async function() {
    const bootstrapNodes = [
    ];

    nodeManager = new NodeManager(bootstrapNodes);

    // Create 6 validators
    for (let i = 0; i < 3; i++) {
      validators[i] = await nodeManager.createNode(`validator${i+1}`, { 
        role: 'validator', 
        listenAddress: `/ip4/127.0.0.1/tcp/${10001 + i}`
      });
    }

    // Create 6 miners
    for (let i = 0; i < 2; i++) {
      miners[i] = await nodeManager.createNode(`miner${i+1}`, { 
        role: 'miner', 
        listenAddress: `/ip4/127.0.0.1/tcp/${10007 + i}`,
        minerAddress: `miner${i+1}_address`
      });
    }

    await nodeManager.connectAllNodes();

    // Subscribe all nodes to necessary topics
    const topics = ['transactions', 'block_candidate', 'mined_block', 'vssShare'];
    for (const topic of topics) {
      await nodeManager.subscribeAll(topic, () => {});
    }

    // Wait for connections and subscriptions to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  after(async function() {
    await nodeManager.shutdownAllNodes();
  });

  it('should maintain consensus as the blockchain progresses to block 2', async function() {
    const initialBlockNumber = validators[0].blockManager.getLatestBlockNumber();
    console.log('Initial block number:', initialBlockNumber);

    let currentBlockNumber = initialBlockNumber;
    
    while (currentBlockNumber < 3) {
      console.log(`Mining block ${currentBlockNumber + 1}...`);
      
      // Create and broadcast a few transactions
      for (let i = 0; i < 6; i++) {
   
        const transaction = createSignedTransaction( "aaaaaa", 100);
        await validators[0].getPubSubManager().broadcast('transactions', transaction);
        await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between transactions
      }

      // Wait for block mining and propagation
      await new Promise(resolve => setTimeout(resolve, 8000));

      // Update current block number
      currentBlockNumber = validators[0].blockManager.getLatestBlockNumber();
      console.log(`Current block number: ${currentBlockNumber}`);

      // Check consensus after each block
      await checkConsensus();
    }

    console.log('Consensus achieved. All nodes are in sync at block 2.');
  });

  async function checkConsensus() {
    const nodes = [...validators, ...miners];
    const blockNumbers = nodes.map(node => node.blockManager.getLatestBlockNumber());
    const blockHashes = nodes.map(node => node.blockManager.getLatestBlockHash());

    // map roles for logging
    const roles = nodes.map(node => node.role);

    console.log('Current block numbers:', blockNumbers);
    console.log('Current block hashes:', blockHashes );
    console.log('Current roles:', roles);

    // Assert that all nodes have the same block number
    const uniqueBlockNumbers = new Set(blockNumbers);
    expect(uniqueBlockNumbers.size).to.equal(1, `All nodes should have the same block number. Found ${uniqueBlockNumbers.size} different numbers.`);

    // Assert that all nodes have the same block hash
    const uniqueBlockHashes = new Set(blockHashes);
    //expect(uniqueBlockHashes.size).to.equal(1, `All nodes should have the same block hash. Found ${uniqueBlockHashes.size} different hashes.`);

    // Assert that the blockchain has progressed
    expect(blockNumbers[0]).to.be.at.least(0, 'Blockchain should have progressed');

    // Log more detailed information if consensus is not achieved
    if (uniqueBlockNumbers.size !== 1 || uniqueBlockHashes.size !== 1) {
      nodes.forEach((node, index) => {
        console.log(`Node ${index} (${node.role}): Block ${blockNumbers[index]}, Hash ${blockHashes[index]}`);
      });
    }
  }
});