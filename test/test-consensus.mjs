import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../src/node-factory.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';
import utils from '../src/utils.mjs';

describe('Consensus Test', function() {
    this.timeout(120000); // Increase timeout for network operations

    let factory;
    let nodes = [];
    const NUM_NODES = 5;
    const NUM_MINERS = 2;
    const INITIAL_BALANCE = 1000000; // 1 million microConts
    const mnemonicHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00";

    before(async function() {
        factory = new NodeFactory();
        const accounts = await factory.initialize(mnemonicHex, NUM_NODES, 'W');

        // Create nodes (mixture of validators and miners)
        for (let i = 0; i < NUM_NODES; i++) {
            const role = i < NUM_MINERS ? 'miner' : 'validator';
            const { node, nodeId } = await factory.createNode(accounts[i], role );
            nodes.push({ node, nodeId, account: accounts[i] });
        }

        // Create initial UTXOs for all accounts
        for (const nodeInfo of nodes) {
            const utxo = {
                amount: INITIAL_BALANCE,
                address: nodeInfo.account.address,
                rule: 'sig_v1',
                version: 1,
                utxoPath: `0:${utils.convert.string.toHex(nodeInfo.account.address).slice(0, 8)}:0`
            };
            nodeInfo.account.setBalanceAndUTXOs(INITIAL_BALANCE, [utxo]);
            

            // start mining on all miners nodes 
            if (nodeInfo.node.role === 'miner') {
                await nodeInfo.node.startMining();
            }


            // Add the UTXO to all nodes' UTXO caches
            for (const otherNodeInfo of nodes) {
                otherNodeInfo.node.utxoCache.UTXOsByPath[utxo.utxoPath] = utxo;
                if (!otherNodeInfo.node.utxoCache.addressesUTXOs[nodeInfo.account.address]) {
                    otherNodeInfo.node.utxoCache.addressesUTXOs[nodeInfo.account.address] = [];
                }
                otherNodeInfo.node.utxoCache.addressesUTXOs[nodeInfo.account.address].push(utxo);
                otherNodeInfo.node.utxoCache.addressesBalances[nodeInfo.account.address] = INITIAL_BALANCE;
            }
        }

        // Sync UTXO caches across all nodes
        const masterUTXOCache = JSON.parse(JSON.stringify(nodes[0].node.utxoCache));
        for (let i = 1; i < nodes.length; i++) {
            nodes[i].node.utxoCache = JSON.parse(JSON.stringify(masterUTXOCache));
        }

        // Start all nodes
        for (const node of nodes) {
            await factory.startNode(node.nodeId);
        }

        // Wait for the P2P network to be ready
        await waitForP2PNetworkReady(nodes);
    });

    after(async function() {
        // Stop all nodes
        for (const node of nodes) {
            await factory.stopNode(node.nodeId);
        }
    });

    it('should reach consensus on a new block with a valid transaction', async function() {
        const sender = nodes[0].account;
        const recipient = nodes[1].account;
        const amount = 10000; // 10,000 microConts

        console.log('Sender address:', sender.address);
        console.log('Recipient address:', recipient.address);

        const transaction = await Transaction_Builder.createTransferTransaction(
            sender,
            [{ recipientAddress: recipient.address, amount }],
            1 // Set a fixed fee per byte for testing
        );
        console.log('Transaction:', JSON.stringify(transaction, null, 2));

        const signedTx = await sender.signTransaction(transaction);
        console.log('Signed transaction:', JSON.stringify(signedTx, null, 2));

        const txJSON = Transaction_Builder.getTransactionJSON(signedTx);

        // Broadcast the transaction from the first node
        await nodes[0].node.broadcastTransaction(txJSON);

        

        // get a random validator node
        const validatorNode = nodes.find(node => node.node.role === 'validator');
        console.log('Validator node:', validatorNode.nodeId);
        validatorNode.node.createBlockCandidateAndBroadcast();

        // Wait for the transaction to be included in a block and propagated
        await new Promise(resolve => setTimeout(resolve, 30000));

        // Check if all nodes have reached consensus
        const heights = nodes.map(n => n.node.getNodeStatus().currentBlockHeight);
        const consensusHeight = Math.max(...heights);

        console.log('Node heights:', heights);
        console.log('Consensus height:', consensusHeight);

        // Verify that all nodes have reached the consensus height
        for (const node of nodes) {
            expect(node.node.getNodeStatus().currentBlockHeight).to.equal(consensusHeight);
        }

        // Verify that the transaction is included in the blockchain
        const lastNode = nodes[nodes.length - 1].node;
        const block = await lastNode.utxoCache.getBlockAtHeight(consensusHeight);
        const includedTx = block.Txs.find(tx => tx.id === signedTx.id);
        expect(includedTx).to.exist;

        // Verify the balance change
        const recipientBalance = lastNode.utxoCache.getBalanceAndUTXOs(recipient.address).balance;
        expect(recipientBalance).to.equal(INITIAL_BALANCE + amount);

        const senderBalance = lastNode.utxoCache.getBalanceAndUTXOs(sender.address).balance;
        expect(senderBalance).to.be.lessThan(INITIAL_BALANCE - amount); // Less than because of fees
    });

    async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.node.p2pNetwork.getConnectedPeers().length;
                return peerCount >= Math.min(NUM_NODES - 1, node.node.p2pNetwork.options.maxPeers);
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