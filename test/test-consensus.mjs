import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../src/node-factory.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';
import utils from '../src/utils.mjs';
import { Wallet } from '../src/wallet.mjs';

describe('Consensus Test', function () {
    this.timeout(300000); // Increase timeout for network operations

    let factory;
    let nodes = [];
    const NUM_NODES = 5;
    const NUM_MINERS = 2;
    const wallet = new Wallet("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", true);
    const testParams = {
        useDevArgon2: true,
        nbOfAccounts: 10,
        addressType: 'W',
    }

    before(async function () {
        console.log('wallet:', wallet);
        factory = new NodeFactory();
        wallet.restore();
        wallet.loadAccounts();

        // const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);
        wallet.loadAccounts();
        // if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
        const accounts = wallet.accountsGenerated.W;
        console.log('accounts:', accounts);

        // Create nodes (mixture of validators and miners)
        for (let i = 0; i < NUM_NODES; i++) {
            const role = i < NUM_MINERS ? 'miner' : 'validator';
            const node = await factory.createNode(accounts[i], role);
            nodes.push(node);
        }

        // Start all nodes
        for (const node of nodes) {
            await factory.startNode(node.id);
        }

        // Wait for the P2P network to be ready
        await waitForP2PNetworkReady(nodes);

        // Start mining on all miner nodes
        for (const nodeInfo of nodes) {
            if (nodeInfo.role === 'miner') {
                nodeInfo.miner.startWithWorker();
            }
        }


    });

    after(async function () {
        // Stop all nodes
        for (const node of nodes) {
            await factory.stopNode(node.id);
        }
    });

    it('should reach consensus on a new block with a valid transaction', async function () {


        // take the first validator node
        // Get a random validator node
        const validatorNode = nodes.find(node => node.role === 'validator');
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('Validator node:', validatorNode);
        validatorNode.createBlockCandidateAndBroadcast();

        // Wait for the transaction to be included in a block and propagated
        await new Promise(resolve => setTimeout(resolve, 6000));

        //await waitForMinersToHaveBalance(nodes);
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
        console.warn('Transaction:', JSON.stringify(transaction, null, 2));

        const signedTx = await sender.signTransaction(transaction);
        console.log('Signed transaction:', JSON.stringify(signedTx, null, 2));

        const txJSON = Transaction_Builder.getTransactionJSON(signedTx);

        // Broadcast the transaction from the first node
        await nodes[0].broadcastTransaction(txJSON);



        // Check if all nodes have reached consensus
        const heights = nodes.map(n => n.getStatus().currentBlockHeight);
        const consensusHeight = Math.max(...heights);

        console.log('Node heights:', heights);
        console.log('Consensus height:', consensusHeight);

        // Verify that all nodes have reached the consensus height
        for (const node of nodes) {
            expect(node.getStatus().currentBlockHeight).to.equal(consensusHeight);
        }

        // Verify that the transaction is included in the blockchain
        const lastNode = nodes[nodes.length - 1];
        const block = await lastNode.utxoCache.getBlockAtHeight(consensusHeight);
        const includedTx = block.Txs.find(tx => tx.id === signedTx.id);
        expect(includedTx).to.exist;

        // Verify the balance change
        const recipientBalance = lastNode.utxoCache.getBalanceAndUTXOs(recipient.address).balance;
        expect(recipientBalance).to.equal(amount);

        const senderBalance = lastNode.utxoCache.getBalanceAndUTXOs(sender.address).balance;
        expect(senderBalance).to.be.lessThan(sender.balance - amount); // Less than because of fees
    });

    async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allNodesConnected = nodes.every(node => {
                const peerCount = node.p2pNetwork.getConnectedPeers().length;
                return peerCount >= Math.min(NUM_NODES - 1, node.p2pNetwork.options.maxPeers);
            });

            if (allNodesConnected) {
                console.log('P2P network is ready');
                return;
            }

            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('P2P network failed to initialize within the expected time');
    }

    async function waitForMinersToHaveBalance(nodes, minBalance = 100000, maxAttempts = 60, interval = 5000) {
        const miners = nodes.filter(node => node.role === 'miner');

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const allMinersHaveBalance = miners.every(miner => {
                const balance = miner.utxoCache.getBalanceAndUTXOs(miner.account.address).balance;
                return balance >= minBalance;
            });

            if (allMinersHaveBalance) {
                console.log('All miners have accumulated sufficient balance');
                return;
            }

            console.log(`Waiting for miners to accumulate balance. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        throw new Error('Miners failed to accumulate sufficient balance within the expected time');
    }
});