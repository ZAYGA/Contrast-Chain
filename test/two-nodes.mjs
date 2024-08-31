import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../src/node-factory.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';
import utils from '../src/utils.mjs';

describe('Two-Node Mining Test', function () {
    this.timeout(60000); // Increase timeout for mining operations

    let factory;
    let validatorNode;
    let minerNode;
    const mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";

    before(async function () {
        factory = new NodeFactory();
        const accounts = await factory.initialize(mnemonicHex, 2, 'W');

        // Create validator node
        validatorNode = await factory.createNode(accounts[0], 'validator');


        // Create miner node
        minerNode = await factory.createNode(accounts[1], 'miner');


        // Start both nodes
        await factory.startNode(validatorNode.id);
        await factory.startNode(minerNode.id);

        // Wait for the P2P network to be ready
        await waitForP2PNetworkReady([validatorNode, minerNode]);

        minerNode.miner.startWithWorker();
    });

    after(async function () {
        // Stop both nodes
        await factory.stopNode(validatorNode.id);
        await factory.stopNode(minerNode.id);
    });

    it('should create a block candidate, mine it, and reach consensus', async function () {
        // Spy on the broadcastBlockProposal method of the validator node
        const broadcastSpy = sinon.spy(validatorNode, 'broadcastBlockProposal');

        // Spy on the submitPowProposal method of the validator node
        const submitPowSpy = sinon.spy(validatorNode, 'submitPowProposal');

        // Create a block candidate in the validator node
        const blockCandidate = await validatorNode.createBlockCandidate();
        console.log('Block candidate created:', JSON.stringify(blockCandidate, null, 2));

        // Manually trigger the broadcast of the block candidate
        await validatorNode.broadcastBlockProposal(blockCandidate);

        // Check if the broadcastBlockProposal method was called
        expect(broadcastSpy.calledOnce).to.be.true;

        // Wait for the miner to mine the block and broadcast it
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Check if the submitPowProposal method was called on the validator node
        expect(submitPowSpy.calledOnce).to.be.true;

        // Verify that both nodes have reached consensus on the new block
        expect(validatorNode.getStatus().currentBlockHeight).to.equal(1);
        expect(minerNode.getStatus().currentBlockHeight).to.equal(1);

        // Clean up spies
        broadcastSpy.restore();
        submitPowSpy.restore();
    });

    async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.p2pNetwork.getConnectedPeers().length;
                return peerCount >= 1; // We only need one connection in this test
            });

            if (allNodesConnected) {
                console.log('P2P network is ready');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('P2P network failed to initialize within the expected time');
    }
});