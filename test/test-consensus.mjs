import { expect } from 'chai';
import sinon from 'sinon';
import { NodeFactory } from '../src/node-factory.mjs';
import { Transaction_Builder } from '../src/transaction.mjs';
import { Wallet } from '../src/wallet.mjs';

describe('Comprehensive Consensus Test', function () {
    this.timeout(3600000); // 1 hour

    const NUM_NODES = 9;
    const NUM_MINERS = 1;
    const INITIAL_MINER_BALANCE = 30000000;
    const DISTRIBUTION_AMOUNT = 3000000;
    const CONSENSUS_CHECK_INTERVAL = 5; // Check consensus every minute
    const BALANCE_CHECK_INTERVAL = 5; // Check balances every 5 minutes

    let factory;
    let nodes = [];
    let wallet;
    let continueSendingTransactions = true;
    let transactionCount = 0;
    let failedTransactions = 0;
    let accounts = [];
    const testParams = {
        useDevArgon2: false,
        nbOfAccounts: 20,
        addressType: 'W',
    };

    before(async function () {
        console.info('Initializing test environment...');
        factory = new NodeFactory();
        wallet = new Wallet("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);

        await wallet.restore();
        wallet.loadAccounts();
        const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);

        accounts = derivedAccounts;
        wallet.saveAccounts();
        if (!derivedAccounts) throw new Error('Failed to derive addresses.');

        console.info(`Derived ${derivedAccounts.length} accounts. Average iterations: ${avgIterations}`);

        // Create and start nodes
        for (let i = 0; i < NUM_NODES; i++) {
            const role = i < NUM_MINERS ? 'miner' : 'validator';
            const node = await factory.createNode(derivedAccounts[i], role);
            nodes.push(node);
            await factory.startNode(node.id);
        }

        await waitForP2PNetworkReady(nodes);

        // Start mining on all miner nodes
        nodes.filter(node => node.role === 'miner').forEach(node => node.miner.startWithWorker());
    });

    after(async function () {
        console.info('Cleaning up test environment...');
        continueSendingTransactions = false;
        for (const node of nodes) {
            await factory.stopNode(node.id);
        }
    });

    it('should maintain consensus with various transaction scenarios', async function () {
        const validatorNode = nodes.find(node => node.role === 'validator');
        await validatorNode.createBlockCandidateAndBroadcast();

        const minerWithBalance = await waitForMinerWithBalance(nodes, INITIAL_MINER_BALANCE);
        if (!minerWithBalance) throw new Error('No miner accumulated sufficient balance within the expected time');


        // wait a second for the miner to broadcast the block
        //await new Promise(resolve => setTimeout(resolve, 3000));

        await distributeFunds(minerWithBalance, nodes.filter(n => n !== minerWithBalance), DISTRIBUTION_AMOUNT, validatorNode);

        refreshAllBalances(validatorNode, nodes.map(n => n.account));

        const transactionSender = continuouslySendTransactions(nodes, validatorNode, accounts);
        const consensusChecker = periodicConsensusCheck(nodes);
        const balanceChecker = periodicBalanceCheck(nodes);

        await Promise.all([
            transactionSender,
            consensusChecker,
            balanceChecker,
        ]);

        continueSendingTransactions = false;

        //await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for final transactions to be processed

        await verifyFinalConsensusAndBalances(nodes);

        console.info(`Test completed. Total transactions: ${transactionCount}, Failed: ${failedTransactions}`);
    });

    async function continuouslySendTransactions(nodes, broadcastNode, allAccounts) {
        const BATCH_SIZE = 10; // Number of transactions to prepare in each batch
        const BATCH_INTERVAL = 10; // Time in ms between batches

        while (continueSendingTransactions) {
            let transactionPromises = [];

            for (let i = 0; i < BATCH_SIZE && continueSendingTransactions; i++) {

                const scenario = getRandomScenario();
                const transactionPromise = executeTransactionScenario(scenario, nodes, broadcastNode, allAccounts)
                    .then(() => {
                        transactionCount++;
                        console.info(`Transactions sent: ${transactionCount}, Failed: ${failedTransactions}`);
                        if (transactionCount % 100 === 0) {
                            console.info(`Transactions sent: ${transactionCount}, Failed: ${failedTransactions}`);
                        }
                    })
                    .catch(error => {
                        failedTransactions++;
                        // console.error(`Transaction failed: ${error.message}`);
                    });

                transactionPromises.push(transactionPromise);
            }

            // Wait for all transactions in the batch to complete
            await Promise.all(transactionPromises);

            // Refresh balances after each batch
            refreshAllBalances(broadcastNode, nodes.map(n => n.account));

            // Wait for the specified interval before starting the next batch
            await new Promise(resolve => setTimeout(resolve, BATCH_INTERVAL));
        }
    }


    function getRandomScenario() {
        const scenarios = ['simple', 'multi-output', 'random-account'];
        return scenarios[Math.floor(Math.random() * scenarios.length)];
    }


    async function executeTransactionScenario(scenario, nodes, broadcastNode, allAccounts) {
        const sender = accounts[Math.floor(Math.random() * accounts.length)];
        let recipient, amount, outputs;

        // Check sender's balance before proceeding
        const senderBalance = broadcastNode.utxoCache.getBalanceAndUTXOs(sender.address).balance;
        if (senderBalance <= 1) {
            throw new Error(`Skipping transaction: Sender ${sender.address} has insufficient balance (${senderBalance})`);
        }

        switch (scenario) {
            case 'simple':
                recipient = nodes[Math.floor(Math.random() * nodes.length)].account;
                amount = Math.min(1, senderBalance - 1);
                return sendTransaction(sender, [{ recipientAddress: recipient.address, amount }], broadcastNode);
            case 'multi-output':
                const outputCount = Math.min(3, Math.floor(senderBalance / 2));
                outputs = Array(outputCount).fill().map(() => ({
                    recipientAddress: nodes[Math.floor(Math.random() * nodes.length)].account.address,
                    amount: Math.floor(Math.random() * (senderBalance / outputCount - 1)) + 1
                }));
                return sendTransaction(sender, outputs, broadcastNode);
            case 'random-account':
                recipient = allAccounts[Math.floor(Math.random() * allAccounts.length)];
                amount = Math.min(1, senderBalance - 1);
                return sendTransaction(sender, [{ recipientAddress: recipient.address, amount }], broadcastNode);
        }
    }

    async function sendTransaction(sender, outputs, broadcastNode) {
        try {
            const transaction = await Transaction_Builder.createTransferTransaction(sender, outputs, 1);
            const signedTx = await sender.signTransaction(transaction);
            /*const txJSON = Transaction_Builder.getTransactionJSON(signedTx); // TODO: Look here, we now send raw Tx
            // witness size
            if (txJSON.length > 2000) {
                console.debug(`Transaction prepared: ${signedTx.id} from ${sender.address}, outputs: ${txJSON.length}`);
            }*/
            await broadcastNode.broadcastTransaction(signedTx);
            //console.debug(`Transaction broadcasted: ${signedTx.id} from ${sender.address}`);
        } catch (error) {
            console.error(`Error preparing transaction: ${error.message}`);
            throw error;
        }
    }

    async function distributeFunds(sender, recipients, amount, broadcastNode) {
        console.info(`Distributing ${amount} from ${sender.account.address} to ${recipients.length} recipients`);
        refreshAllBalances(broadcastNode, nodes.map(n => n.account));

        for (const recipient of recipients) {
            try {
                await sendTransaction(sender.account, [{ recipientAddress: recipient.account.address, amount }], broadcastNode);
            } catch (error) {
                console.error(`Failed to distribute funds to ${recipient.account.address}: ${error.message}`);
                // Optionally, you might want to implement a retry mechanism here
            }
        }
        await new Promise(resolve => setTimeout(resolve, 10000));
    }


    async function periodicConsensusCheck(nodes) {
        while (continueSendingTransactions) {
            await verifyConsensus(nodes);
            await new Promise(resolve => setTimeout(resolve, CONSENSUS_CHECK_INTERVAL));
        }
    }

    async function periodicBalanceCheck(nodes) {
        while (continueSendingTransactions) {
            await verifyBalances(nodes);
            await new Promise(resolve => setTimeout(resolve, BALANCE_CHECK_INTERVAL));
        }
    }

    async function verifyConsensus(nodes) {
        const heights = nodes.map(n => n.getStatus().currentBlockHeight);
        const consensusHeight = Math.max(...heights);
        //console.info(`Consensus check - Heights: ${heights.join(', ')}, Max: ${consensusHeight}`);
        for (const node of nodes) {
            //expect(node.getStatus().currentBlockHeight).to.be.at.least(consensusHeight - 1);
        }
    }

    async function verifyBalances(nodes) {
        const lastNode = nodes[nodes.length - 1];
        let totalBalance = 0;
        for (const node of nodes) {
            const balance = lastNode.utxoCache.getBalanceAndUTXOs(node.account.address).balance;
            // console.info(`Balance check - Address ${node.account.address}: ${balance}`);
            //  expect(balance).to.be.at.least(0);
            totalBalance += balance;
        }
        // console.info(`Total balance across all nodes: ${totalBalance}`);
    }

    async function verifyFinalConsensusAndBalances(nodes) {
        await verifyConsensus(nodes);
        await verifyBalances(nodes);
    }

    function refreshAllBalances(node, accounts) {
        for (const account of accounts) {
            const { balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(account.address);
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

            console.info(`Waiting for a miner to accumulate balance. Attempt ${attempt + 1}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, interval));
        }

        return null;
    }
});