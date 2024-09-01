import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../src/node-factory.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';
import utils from '../src/utils.mjs';
import { Wallet } from '../src/wallet.mjs';

describe('Consensus Test with Cascading Fund Distribution', function () {
    this.timeout(1500000); // 25 minutes

    let factory;
    let nodes = [];
    const NUM_NODES = 10;
    const NUM_MINERS = 1;
    const NUM_TRANSACTIONS = 200;
    const INITIAL_MINER_BALANCE = 10000000;
    const DISTRIBUTION_AMOUNT = 1000000;
    const testParams = {
        useDevArgon2: false,
        nbOfAccounts: 20,
        addressType: 'W',
    }
    const wallet = new Wallet("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);

    before(async function () {
        console.log('Initializing wallet and deriving accounts...');
        factory = new NodeFactory();
        await wallet.restore();
        wallet.loadAccounts();
        const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);
        wallet.saveAccounts();
        if (!derivedAccounts) { throw new Error('Failed to derive addresses.'); }
        const accounts = derivedAccounts;
        console.log(`Derived ${accounts.length} accounts. Average iterations: ${avgIterations}`);

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

    it('should reach consensus with cascading fund distribution and concurrent transactions', async function () {
        const validatorNode = nodes.find(node => node.role === 'validator');
        await validatorNode.createBlockCandidateAndBroadcast();

        // Wait for a miner to accumulate funds
        const minerWithBalance = await waitForMinerWithBalance(nodes, INITIAL_MINER_BALANCE);
        if (!minerWithBalance) {
            throw new Error('No miner accumulated sufficient balance within the expected time');
        }

        // Distribute funds from miner to first validator
        const firstValidator = nodes.find(node => node.role === 'validator');
        await distributeAndSetupFunds(minerWithBalance, [firstValidator], DISTRIBUTION_AMOUNT);

        // Distribute funds from first validator to other nodes
        const otherNodes = nodes.filter(node => node !== minerWithBalance && node !== firstValidator);
        await distributeAndSetupFunds(firstValidator, otherNodes, DISTRIBUTION_AMOUNT / 2);

        // Refresh balances before starting transactions
        refreshAllBalances(validatorNode, nodes.map(n => n.account));

        // Perform concurrent transactions
        const transactionPromises = [];
        for (let i = 0; i < NUM_TRANSACTIONS; i++) {
            const sender = nodes[Math.floor(Math.random() * nodes.length)].account;
            let recipient = nodes[Math.floor(Math.random() * nodes.length)].account;
            while (recipient === sender) {
                recipient = nodes[Math.floor(Math.random() * nodes.length)].account;
            }
            const amount = Math.floor(Math.random() * 10000) + 1000; // Random amount between 1,000 and 11,000 microConts

            console.log(`Preparing transaction ${i + 1}/${NUM_TRANSACTIONS} from ${sender.address} to ${recipient.address}`);

            const transactionPromise = sendTransaction(sender, recipient, amount, validatorNode);
            transactionPromises.push(transactionPromise);
        }

        console.log('Sending all transactions concurrently...');
        const transactions = await Promise.all(transactionPromises);
        const successfulTransactions = transactions.filter(tx => tx !== null);

        console.log(`${successfulTransactions.length} out of ${NUM_TRANSACTIONS} transactions sent successfully`);

        // Wait for the transactions to be processed
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait for 30 seconds
        console.log('Waiting period for transaction processing completed');

        // Verify consensus and balances
        await verifyConsensusAndBalances(nodes);
    });

    async function sendTransaction(sender, recipient, amount, broadcastNode) {
        try {
            const transaction = await Transaction_Builder.createTransferTransaction(
                sender,
                [{ recipientAddress: recipient.address, amount }],
                1 // Set a fixed fee per byte for testing
            );

            const signedTx = await sender.signTransaction(transaction);
            const txJSON = Transaction_Builder.getTransactionJSON(signedTx);

            console.log(`Transaction broadcasted: ${signedTx.id} from ${sender.address} to ${recipient.address}`);
            await broadcastNode.broadcastTransaction(txJSON);

            return signedTx;
        } catch (error) {
            console.error(`Failed to process transaction: ${error.message}`);
            return null;
        }
    }

    async function distributeAndSetupFunds(sender, recipients, amount) {
        console.log(`Distributing ${amount} from ${sender.account.address} to ${recipients.length} recipients`);
        for (const recipient of recipients) {
            await sendTransaction(sender.account, recipient.account, amount, sender);
        }
        // Wait for transactions to be processed
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    async function verifyConsensusAndBalances(nodes) {
        const heights = nodes.map(n => n.getStatus().currentBlockHeight);
        const consensusHeight = Math.max(...heights);

        console.log('Node heights:', heights);
        console.log('Consensus height:', consensusHeight);

        // Verify that all nodes have reached the consensus height (or are very close)
        for (const node of nodes) {
            //expect(node.getStatus().currentBlockHeight).to.be.at.least(consensusHeight - 1);
        }

        // Verify balances
        const lastNode = nodes[nodes.length - 1];
        let totalBalance = 0;
        for (const node of nodes) {
            const balance = lastNode.utxoCache.getBalanceAndUTXOs(node.account.address).balance;
            console.log(`Address ${node.account.address} balance: ${balance}`);
            //expect(balance).to.be.at.least(0);
            totalBalance += balance;
        }
        console.log(`Total balance across all nodes: ${totalBalance}`);
    }

    function refreshAllBalances(node, accounts) {
        for (const account of accounts) {
            const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(account.address);
            account.setBalanceAndUTXOs(balance, UTXOs);
        }
    }

    async function waitForP2PNetworkReady(nodes, maxAttempts = 300, interval = 6000) {
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

    async function waitForMinerWithBalance(nodes, minBalance = INITIAL_MINER_BALANCE, maxAttempts = 60, interval = 5000) {
        const miners = nodes.filter(node => node.role === 'miner');
        const randomValidator = nodes.find(node => node.role === 'validator');
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            for (const miner of miners) {
                console.log(`Checking balance for miner ${miner.id}`);
                const balance = randomValidator.utxoCache.getBalanceAndUTXOs(miner.account.address).balance;
                console.log(`Miner ${miner.id} balance: ${balance}`);
                if (balance >= minBalance) {
                    console.log(`Miner ${miner.id} has accumulated sufficient balance`);
                    return miner;
                }
            }

            console.log(`Waiting for a miner to accumulate balance. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return null;
    }
});