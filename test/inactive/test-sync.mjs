import { expect } from 'chai';
import { multiaddr } from 'multiaddr';
import sinon from 'sinon';
import { NodeFactory } from '../../src/node-factory.mjs';
import { Wallet } from '../../src/wallet.mjs';

describe('SyncHandler', function () {
    this.timeout(120000); // Increase timeout for longer tests

    const NUM_NODES = 5; // Increased number of nodes for more complex scenarios
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
        if (!derivedAccounts) throw new Error('Failed to derive accounts.');

        console.info(`Derived ${derivedAccounts.length} accounts.`);

        // Create and start nodes with different roles
        for (let i = 0; i < NUM_NODES; i++) {
            const role = 'validator';
            const listenAddress = '/ip4/0.0.0.0/tcp/0';
            const node = await factory.createNode(derivedAccounts[i], [role], { listenAddress });
            nodes.push(node);
            node.start();
        }

        await waitForP2PNetworkReady(nodes);
    });

    after(async function () {
        console.info('Cleaning up test environment...');

    });

    it('should connect nodes successfully', async function () {
        const connectedPeers = nodes.map(node => node.p2pNetwork.getConnectedPeers().length);
        connectedPeers.forEach((peerCount, index) => {
            expect(peerCount).to.be.at.least(NUM_NODES - 1, `Node ${index} should be connected to at least ${NUM_NODES - 1} peers`);
        });
    });

    it('should send and receive small messages to a random kown peer', async function () {
        const sender = nodes[0];
        const receiver = nodes[1];
        const message = {
            type: 'test',
            data: 'Hello, world!'
        };

        const response = await sender.p2pNetwork.sendMessage(receiver.p2pNetwork.p2pNode.getMultiaddrs()[0], message);
        expect(response).to.deep.equal({
            data: 'Hello, world!',
            type: 'test'
        });
    });


    it('should handle large messages (simulating a large block)', async function () {
        const largeBlock = {
            type: 'block',
            index: 1000000,
            data: 'x'.repeat(5000000) // 5MB of data
        };
        const sender = nodes[1];
        const receiver = nodes[2];

        const response = await sender.p2pNetwork.sendMessage(receiver.p2pNetwork.p2pNode.getMultiaddrs()[0], largeBlock);
        expect(response).to.deep.equal({
            status: 'received',
            echo: largeBlock
        });
    });

    it('should handle multiple messages in quick succession', async function () {
        const blocks = Array.from({ length: 20 }, (_, i) => ({
            type: 'block',
            index: i,
            data: `Block data ${i}`.repeat(1000) // ~10KB per block
        }));
        const sender = nodes[0];
        const receiver = nodes[1];

        const responses = await Promise.all(blocks.map(block =>
            sender.p2pNetwork.sendMessage(receiver.p2pNetwork.p2pNode.getMultiaddrs()[0], block)
        ));

        responses.forEach((response, i) => {
            expect(response).to.deep.equal({
                status: 'received',
                echo: blocks[i]
            });
        });
    });


    async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.p2pNetwork.getConnectedPeers().length;
                return peerCount >= NUM_NODES - 1;
            });

            if (allNodesConnected) {
                console.info('P2P network is ready');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('P2P network failed to initialize within the expected time');
    }
});
