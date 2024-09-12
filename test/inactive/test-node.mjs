import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../../src/node-factory.mjs';
import { Transaction_Builder } from '../../src/transaction.mjs';
import { Wallet } from '../../src/wallet.mjs';
import { SyncHandler } from '../../src/sync.mjs';

describe('Comprehensive Sync System Test', function () {
    this.timeout(3600000); // 1 hour

    const NUM_NODES = 1;
    const TRANSACTION_AMOUNT = 1000000;
    const SYNC_CHECK_INTERVAL = 5000; // Check sync every 5 seconds

    let factory;
    let nodes = [];
    let wallet;
    let accounts = [];

    before(async function () {
        console.info('Initializing test environment...');
        factory = new NodeFactory();
        wallet = new Wallet();

        const derivedAccounts = await wallet.loadOrCreateAccounts();
        accounts = derivedAccounts;
        wallet.saveAccounts();
        if (!derivedAccounts) throw new Error('Failed to derive accounts.');

        console.info(`Derived ${derivedAccounts.length} accounts.`);

        // Create and start nodes
        for (let i = 0; i < NUM_NODES; i++) {
            const role = ['validator'];
            const node = await factory.createNode(derivedAccounts[i], role);
            nodes.push(node);
            node.start();
        }

        await new Promise(resolve => setTimeout(resolve, 500000)); // Wait for nodes to start

    });

    after(async function () {
        console.info('Cleaning up test environment...');
        for (const node of nodes) {
            await factory.stopNode(node.id);
        }
    });

    it('should synchronize all nodes after initial block creation', async function () {
        try {
            console.info('Starting sync test...');
            await new Promise(resolve => setTimeout(resolve, 5000000)); // Wait for nodes to start

        } catch (error) {
            console.error('Test failed:', error);
            throw error;
        }
    });

    async function waitForP2PNetworkReady(nodes, maxAttempts = 300, interval = 6000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.p2pNetwork.getConnectedPeers().length;
                return peerCount >= Math.min(NUM_NODES - 1, node.p2pNetwork.options.maxPeers);
            });

            if (allNodesConnected) {
                console.info('P2P network is ready');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('P2P network failed to initialize within the expected time');
    }

    async function waitForMinerWithBalance(nodes, minBalance, maxAttempts = 60, interval = 5000) {
        const miners = nodes.filter(node => node.role === 'miner');
        const randomValidator = nodes.find(node => node.role === 'validator');
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const miner of miners) {
                console.debug(`Checking balance for miner ${miner.id}`);
                const balance = randomValidator.utxoCache.getBalanceAndUTXOs(miner.account.address).balance;
                console.debug(`Miner ${miner.id} balance: ${balance}`);
                if (balance >= minBalance) {
                    console.info(`Miner ${miner.id} has accumulated sufficient balance`);
                    return miner;
                }
            }

            console.warn(`Waiting for a miner to accumulate balance. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return null;
    }

    async function waitForSync(nodes, timeout = 60000) { // Increased timeout to 60 seconds
        const start = Date.now();
        console.warn('Waiting for nodes to sync... Node IDs: ' + nodes.map(node => node.id).join(', '));

        while (Date.now() - start < timeout) {
            // start syncing all nodes
            for (const node of nodes) {
                await node.syncWithKnownPeers();
            }
            await new Promise(resolve => setTimeout(resolve, SYNC_CHECK_INTERVAL));
            const heightMap = new Map();
            let allSynced = true;

            for (const node of nodes) {
                const height = node.getStatus().currentBlockHeight;
                if (!heightMap.has(height)) {
                    heightMap.set(height, []);
                }
                heightMap.get(height).push(node.id);
            }

            if (heightMap.size === 1) {
                console.info('All nodes synced at height:', Array.from(heightMap.keys())[0]);
                return;
            }

            // If not all synced, print debug information
            console.warn('Nodes not in sync. Current state:');
            for (const [height, nodeIds] of heightMap.entries()) {
                console.error(`  Height ${height}: Nodes ${nodeIds.join(', ')}`);
            }

            // Check for any nodes that are significantly behind
            const maxHeight = Math.max(...heightMap.keys());
            const minHeight = Math.min(...heightMap.keys());
            if (maxHeight - minHeight > 5) { // Arbitrary threshold, adjust as needed
                console.error(`Large height discrepancy detected. Max height: ${maxHeight}, Min height: ${minHeight}`);

                // display difference
            }

            await new Promise(resolve => setTimeout(resolve, SYNC_CHECK_INTERVAL));
        }

        // If we've reached this point, sync has failed
        console.error('Sync failed. Final state:');
        for (const node of nodes) {
            console.error(`  Node ${node.id}: Height ${node.getStatus().currentBlockHeight}`);
        }
        throw new Error('Nodes failed to sync within the timeout period');
    }

    function partitionNetwork(nodes) {
        const validators = nodes.filter(node => node.role === 'validator');
        const miners = nodes.filter(node => node.role === 'miner');
        const otherNodes = nodes.filter(node => node.role !== 'validator' && node.role !== 'miner');

        // Ensure we have at least two validators to split
        if (validators.length < 2) {
            throw new Error('Not enough validators to create a meaningful partition');
        }

        const midpointValidators = Math.floor(validators.length / 2);
        const midpointMiners = Math.floor(miners.length / 2);
        const midpointOthers = Math.floor(otherNodes.length / 2);

        const partition1 = [
            ...validators.slice(0, midpointValidators),
            ...miners.slice(0, midpointMiners),
            ...otherNodes.slice(0, midpointOthers)
        ];

        const partition2 = [
            ...validators.slice(midpointValidators),
            ...miners.slice(midpointMiners),
            ...otherNodes.slice(midpointOthers)
        ];

        console.log(`Partition 1: ${partition1.length} nodes (${partition1.filter(n => n.role === 'validator').length} validators)`);
        console.log(`Partition 2: ${partition2.length} nodes (${partition2.filter(n => n.role === 'validator').length} validators)`);

        return [partition1, partition2];
    }

    async function simulateNetworkPartition(partition1, partition2) {
        for (const node1 of partition1) {
            for (const node2 of partition2) {
                await node1.p2pNetwork.node.hangUp(node2.p2pNetwork.node.peerId);
                await node2.p2pNetwork.node.hangUp(node1.p2pNetwork.node.peerId);
            }
        }
    }

    async function reuniteNetwork(partition1, partition2) {
        for (const node1 of partition1) {
            for (const node2 of partition2) {
                const multiaddr = node2.p2pNetwork.node.getMultiaddrs()[0];
                await node1.p2pNetwork.node.dial(multiaddr);
            }
        }
    }
    async function sendRandomTransaction(node, accounts) {
        const sender = accounts[Math.floor(Math.random() * accounts.length)];
        const recipient = accounts[Math.floor(Math.random() * accounts.length)];
        const amount = Math.floor(Math.random() * TRANSACTION_AMOUNT) + 1;

        const tx = await Transaction_Builder.createTransfer(sender, [{ recipientAddress: recipient.address, amount }]);
        const signedTx = await sender.signTransaction(tx);
        await node.p2pBroadcast('new_transaction', signedTx);
    }

    async function createBlocksInPartition(partition, count) {
        const validatorNode = partition.find(node => node.role === 'validator');
        for (let i = 0; i < count; i++) {
            await validatorNode.createBlockCandidateAndBroadcast();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for mining
        }
    }
});