import P2PNode from './P2PNode.mjs';
import { MockFullNode } from './MockFullNode.mjs';
import assert from 'assert';
import { EventEmitter } from 'events';

export class P2PNodeTest extends EventEmitter {
    constructor() {
        super();
        this.nodes = [];
    }

    async setup() {
        console.log("=== Setting up test environment ===");
        // Create 3 P2P nodes
        for (let i = 0; i < 3; i++) {
            const port = 8333 + i;
            console.log(`Creating P2P node on port ${port}`);
            const node = new P2PNode(port, [], 100, 2); // maxPeers: 10, banThreshold: 10
            node.setFullNode(new MockFullNode());
            this.nodes.push(node);
        }

        // Start all nodes
        console.log("Starting all nodes...");
        await Promise.all(this.nodes.map(node => node.start()));

        // Connect nodes in a ring
        console.log("Connecting nodes in a ring topology...");
        for (let i = 0; i < this.nodes.length; i++) {
            const nextIndex = (i + 1) % this.nodes.length;
            console.log(`Connecting node ${i} (port ${this.nodes[i].port}) to node ${nextIndex} (port ${this.nodes[nextIndex].port})`);
            await this.nodes[i].networkProtocol.connect('localhost', this.nodes[nextIndex].port);
        }

        // Wait for connections to establish
        console.log("Waiting for connections to establish...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log("=== Test environment setup complete ===\n");
    }

    createBlock(index, prevHash) {
        return {
            index,
            hash: `block${index}`,
            data: `test block ${index}`,
            prevHash,
            timestamp: Date.now(),
            nonce: Math.floor(Math.random() * 1000000)
        };
    }

    async testPeerDiscovery() {
        console.log("=== Running peer discovery test ===");
        for (const node of this.nodes) {
            const peerCount = node.peerManager.peers.size;
            console.log(`Node on port ${node.port} has ${peerCount} peers`);
            assert.strictEqual(peerCount, 2, `Node on port ${node.port} should have 2 peers, but has ${peerCount}`);
        }
        console.log("=== Peer discovery test passed ===\n");
    }

    async testBlockPropagation() {
        console.log("=== Running block propagation test ===");
        const numBlocks = 5;
        let prevHash = 'genesis';
    
        const realPeerId = this.nodes[0].peerManager.peers.keys().next().value;
        if (!realPeerId) {
            throw new Error("No peers connected for block propagation test");
        }
    
        for (let i = 1; i <= numBlocks; i++) {
            const newBlock = this.createBlock(i, prevHash);
            console.log(`Creating and propagating block ${i} with hash ${newBlock.hash}`);
            await this.nodes[0].messageHandler.handleBlock(realPeerId, { block: JSON.stringify(newBlock) });
            prevHash = newBlock.hash;
    
            console.log(`Waiting for block ${i} to propagate...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    
        // Add an additional delay to ensure propagation
        await new Promise(resolve => setTimeout(resolve, 5000));
    
        // Verify all nodes have the complete blockchain
        for (const node of this.nodes) {
            console.log(`Verifying blockchain for node on port ${node.port}`);
            console.log(`Node on port ${node.port} has ${node.fullNode.chain.length} blocks`);
            assert.strictEqual(node.fullNode.chain.length, numBlocks + 1, `Node on port ${node.port} should have ${numBlocks + 1} blocks (including genesis)`);
            for (let i = 1; i <= numBlocks; i++) {
                assert.strictEqual(node.fullNode.chain[i].hash, `block${i}`, `Node on port ${node.port} should have correct block ${i}`);
            }
        }
        console.log("=== Block propagation test passed ===\n");
    }

    async testTransactionPropagation() {
        console.log("=== Running transaction propagation test ===");
        const newTransaction = { id: 'tx1', data: 'test transaction' };
        
        const realPeerId = this.nodes[0].peerManager.peers.keys().next().value;
        if (!realPeerId) {
            throw new Error("No peers connected for transaction propagation test");
        }
    
        console.log(`Propagating transaction ${newTransaction.id} from node 0`);
        await this.nodes[0].messageHandler.handleTransaction(realPeerId, { transaction: JSON.stringify(newTransaction) });
    
        console.log("Waiting for transaction to propagate...");
        await new Promise(resolve => setTimeout(resolve, 2000));
    
        for (const node of this.nodes) {
            const hasTx = node.fullNode.hasTransaction('tx1');
            console.log(`Node on port ${node.port} has transaction: ${hasTx}`);
            assert(hasTx, `Node on port ${node.port} should have the new transaction in mempool`);
        }
        console.log("=== Transaction propagation test passed ===\n");
    }

    async testIntegrity() {
        console.log("=== Running full blockchain consistency test ===");
        const chainLength = this.nodes[0].fullNode.chain.length;
        console.log(`Verifying ${chainLength} blocks across all nodes`);
        for (let i = 0; i < chainLength; i++) {
            const blockHash = this.nodes[0].fullNode.chain[i].hash;
            console.log(`Verifying block ${i} with hash ${blockHash}`);
            for (const node of this.nodes) {
                assert.strictEqual(node.fullNode.chain[i].hash, blockHash, `All nodes should have the same block at index ${i}`);
            }
        }
        console.log("=== Full blockchain consistency test passed ===\n");
    }

    async testPeerBanning() {
        console.log("=== Running peer banning test ===");
        const node = this.nodes[0];
        const peerId = node.peerManager.peers.keys().next().value;
        
        console.log(`Initial peer count: ${node.peerManager.peers.size}`);
        console.log(`Testing with peer: ${peerId}`);
        console.log(`Ban threshold: ${node.peerManager.banThreshold}`);
    
        console.log("Simulating bad behavior...");
        for (let i = 0; i < node.peerManager.banThreshold; i++) {
            node.peerManager.updatePeerScore(peerId, -10);
            console.log(`Updated score, iteration ${i + 1}`);
        }
    
        console.log("Waiting for banning process to complete...");
        await new Promise(resolve => setTimeout(resolve, 100));
    
        console.log(`Final peer count: ${node.peerManager.peers.size}`);
        console.log(`Is peer banned: ${node.peerManager.isBanned(peerId)}`);
    
        assert(!node.peerManager.peers.has(peerId), "Peer should be banned and removed");
        assert(node.peerManager.isBanned(peerId), "Peer should be in the banned list");
    
        console.log("=== Peer banning test passed ===\n");
    }

    async testSync() {
        console.log("=== Running sync test ===");
        const numBlocks = 10;
        let prevHash = 'genesis';
    
        console.log(`Adding ${numBlocks} blocks to node 0`);
        for (let i = 1; i <= numBlocks; i++) {
            const newBlock = this.createBlock(i, prevHash);
            await this.nodes[0].fullNode.addBlock(newBlock);
            prevHash = newBlock.hash;
            console.log(`Added block ${i} with hash ${newBlock.hash} to node 0`);
        }
    
        const node2 = this.nodes[2];
        console.log(`Disconnecting node 2 (port ${node2.port})`);
        node2.peerManager.peers.clear();
    
        console.log(`Reconnecting node 2 to node 0 (port ${this.nodes[0].port})`);
        await node2.networkProtocol.connect('localhost', this.nodes[0].port);
    
        // Implement a sync completion check
        const syncComplete = async () => {
            const targetHeight = numBlocks + 1; // Including genesis block
            const maxAttempts = 30; // Increase the number of attempts
            let attempts = 0;
            while (attempts < maxAttempts) {
                const node2ChainLength = node2.fullNode.chain.length;
                console.log(`Node 2 chain length: ${node2ChainLength}, Target: ${targetHeight}`);
                
                // Log all blocks in Node 2's chain
                node2.fullNode.chain.forEach(block => {
                    console.log(`Node 2 block: Index ${block.index}, Hash ${block.hash}, PrevHash ${block.prevHash}`);
                });
        
                // Log the last block in Node 2's chain
                const lastBlock = node2.fullNode.chain[node2ChainLength - 1];
                console.log(`Node 2 last block: Index ${lastBlock.index}, Hash ${lastBlock.hash}`);
        
                // Request missing blocks if necessary
                if (node2ChainLength < targetHeight) {
                    const peerWithLongerChain = node2.peerManager.getAllPeers().find(peer => peer.bestHeight > node2ChainLength);
                    if (peerWithLongerChain) {
                        console.log(`Requesting missing blocks from peer ${peerWithLongerChain.id}`);
                        node2.networkProtocol.requestMissingBlocks(peerWithLongerChain.id);
                    }
                    else {
                        console.log("No peer with longer chain found");
                    }
                }
                else if (node2ChainLength === targetHeight) {
                    console.log("Sync completed successfully");
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
        
            return false;
        };
    
        console.log("Waiting for sync to complete...");
        const synced = await syncComplete();
    
        if (synced) {
            console.log("Sync completed successfully");
        } else {
            console.log("Sync did not complete in the expected time");
        }
    
        const node2ChainLength = node2.fullNode.chain.length;
        console.log(`Node 2 chain length after sync: ${node2ChainLength}`);
        assert.strictEqual(node2ChainLength, numBlocks + 1, "Node 2 should have synced all blocks");
    
        console.log("=== Sync test passed ===\n");
    }

    async runTests() {
        try {
            //await this.setup();

            // await this.testPeerDiscovery();
            // await this.testBlockPropagation();
            // await this.testTransactionPropagation();
            await this.testConsensusProcess();
            // await this.testPeerBanning();
            // await this.testIntegrity();       
            // await this.testSync();
            // await this.testBloomFilter();

            console.log('=== All tests passed successfully ===');
        } catch (error) {
            console.error('Test failed:', error);
        } finally {
            console.log("\n=== Cleaning up test environment ===");
            for (const node of this.nodes) {
                if (node.networkProtocol.server) {
                    console.log(`Closing server for node on port ${node.port}`);
                    node.networkProtocol.server.close();
                }
                console.log(`Closing peer connections for node on port ${node.port}`);
                for (const peer of node.peerManager.peers.values()) {
                    if (peer.socket) {
                        peer.socket.destroy();
                    }
                }
            }
            console.log("=== Test environment cleaned up ===");
        }
    }
    
    async testConsensusProcess(numValidators = 4, numMiners = 5) {
        console.log("=== Running consensus process test with multiple validators and miners ===");

        const validatorNodes = [];
        const minerNodes = [];

        // Create validator nodes
        for (let i = 0; i < numValidators; i++) {
            const port = 8340 + i * 3;  // Ensure unique ports
            const validator = new P2PNode(port, [], 100, 20, 'Validator');
            validator.setFullNode(new MockFullNode('Validator',validator.networkProtocol));
            validatorNodes.push(validator);
        }

        // Create miner nodes
        for (let i = 0; i < numMiners; i++) {
            const port = 8341 + i * 3;  // Ensure unique ports
            const miner = new P2PNode(port, [], 10, 20, 'Miner');
            miner.setFullNode(new MockFullNode('Miner',miner.networkProtocol));
            minerNodes.push(miner);
        }

        // Start all nodes (validators and miners)
        const allNodes = [...validatorNodes, ...minerNodes];
        await Promise.all(allNodes.map(node => node.start()));

        // Connect nodes to each other in a star topology (validators to miners)
        const connectPromises = [];
        for (let validator of validatorNodes) {
            for (let miner of minerNodes) {
                connectPromises.push(validator.networkProtocol.connect('localhost', miner.port));
            }
            // Connect validators to each other
            for (let otherValidator of validatorNodes) {
                if (validator.port !== otherValidator.port) {
                    connectPromises.push(validator.networkProtocol.connect('localhost', otherValidator.port));
                }
            }
        }
        await Promise.all(connectPromises);

        // Wait for connections to establish
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start consensus process for all nodes
        await Promise.all(allNodes.map(node => node.startConsensusProcess()));

        // Wait for some time to allow consensus to progress
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Verify that blocks have been created and propagated
        for (const node of allNodes) {
            console.log(`Node ${node.port} chain length: ${node.fullNode.chain.length}`);
            assert(node.fullNode.chain.length > 1, `Node ${node.port} should have created blocks`);
        }

        console.log("=== Consensus process test completed ===");
    }

    async testBloomFilter() {
        console.log("=== Running Bloom filter test ===");
        const node = this.nodes[0];
        const testAddress1 = "testAddress123";
        const testAddress2 = "testAddress456";
        const nonExistentAddress = "nonExistentAddress789";
    
        console.log("Setting up mock wallet with addresses");
        node.fullNode.wallet = { getAllAddresses: () => [testAddress1, testAddress2] };
    
        console.log("Initializing and updating Bloom filter");
        node.initializeBloomFilter();
        node.updateBloomFilter();
    
        console.log("Testing Bloom filter contents");
        assert(node.bloomFilter.has(testAddress1), "Bloom filter should contain testAddress1");
        assert(node.bloomFilter.has(testAddress2), "Bloom filter should contain testAddress2");
        assert(!node.bloomFilter.has(nonExistentAddress), "Bloom filter should not contain non-existent address");
    
        console.log("Testing false positive rate");
        let falsePositives = 0;
        const testIterations = 1000;
        for (let i = 0; i < testIterations; i++) {
            const randomAddress = `randomAddress${Math.random().toString(36).substring(7)}`;
            if (node.bloomFilter.has(randomAddress)) {
                falsePositives++;
            }
        }
        const falsePositiveRate = falsePositives / testIterations;
        console.log(`False positive rate: ${falsePositiveRate.toFixed(4)}`);
        assert(falsePositiveRate < 0.1, "False positive rate should be reasonably low");
    
        console.log("Testing peer Bloom filter update");
        const peerId = node.peerManager.peers.keys().next().value;
        if (!peerId) {
            throw new Error("No peers connected for Bloom filter test");
        }
    
        let sentFilterloadMessage = null;
        node.networkProtocol.sendToPeer = (id, message) => {
            if (message.type === 'FILTERLOAD') {
                sentFilterloadMessage = message;
            }
        };
    
        node.updateBloomFilter();

        // wait for the filter to be sent
        await new Promise(resolve => setTimeout(resolve, 1000));

        assert(sentFilterloadMessage, "FILTERLOAD message should have been sent");
        assert(sentFilterloadMessage.filter.bitArray.length > 0, "FILTERLOAD message should contain non-empty bit array");
    
        console.log("Testing mempool request handling");
        const mockTransactions = [
            { id: 'tx1', outputs: [{ address: testAddress1 }] },
            { id: 'tx2', outputs: [{ address: nonExistentAddress }] },
            { id: 'tx3', outputs: [{ address: testAddress2 }] }
        ];
        node.fullNode.getMempoolTransactions = () => mockTransactions;
    
        let sentInvMessage = null;
        node.networkProtocol.sendToPeer = (id, message) => {
            if (message.type === 'INV') {
                sentInvMessage = message;
            }
        };
    
        await node.messageHandler.handleMempool(peerId);
    
        assert(sentInvMessage, "INV message should have been sent");
        assert.strictEqual(sentInvMessage.type, 'INV', "Sent message should be of type INV");
        assert.strictEqual(sentInvMessage.inv.length, 2, "INV should contain 2 relevant transactions");
        assert(sentInvMessage.inv.some(inv => inv.hash === 'tx1'), "INV should contain tx1");
        assert(sentInvMessage.inv.some(inv => inv.hash === 'tx3'), "INV should contain tx3");
        assert(!sentInvMessage.inv.some(inv => inv.hash === 'tx2'), "INV should not contain tx2");
    
        console.log("Testing dynamic address addition");
        const newAddress = "newTestAddress789";
        node.addAddressToBloomFilter(newAddress);
        assert(node.bloomFilter.has(newAddress), "Bloom filter should contain newly added address");
    
        console.log("=== Bloom filter test passed ===\n");
    }

}    

// Run the tests
const test = new P2PNodeTest();
test.runTests();