'use strict';
import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

const testParams = {
    useDevArgon2: true,
    nbOfAccounts: 100,
    addressType: 'W',
}

/** Simple user to user transaction
 * @param {Node} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} receiverAccountIndex
 */
async function userSendToUser(node, accounts, senderAccountIndex = 1, receiverAccountIndex = 2) {
    const senderAccount = accounts[senderAccountIndex];
    const receiverAddress = accounts[receiverAccountIndex].address;

    const amountToSend = 1_000_000;
    const { signedTxJSON, error } = await contrast.Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAddress);
    if (signedTxJSON) {
        //console.log(`SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAddress} | txID: ${JSON.parse(signedTxJSON).id}`);
        node.addTransactionJSONToMemPool(signedTxJSON);
    } else {
        console.log(error);
    }
}
/** All users send to the next user
* @param {Node} node
* @param {Account[]} accounts
* @param {number} nbOfUsers
 */
async function userSendToNextUser(node, accounts) {
    let startTime = Date.now();

    const signedTxsJSON = [];
    for (let i = 0; i < accounts.length; i++) {
        const senderAccount = accounts[i];
        const receiverAccount = i === accounts.length - 1 ? accounts[0] : accounts[i + 1];

        const amountToSend = Math.floor(Math.random() * (1_000) + 1000);
        const { signedTxJSON, error } = await contrast.Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAccount.address);
        if (signedTxJSON) {
            signedTxsJSON.push(signedTxJSON);
            //console.log(`[TEST] SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAccount.address}`);
            //console.log(`[TEST] Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
        } else {
            console.log(error);
        }
    }
    const timeToCreateAndSignAllTxs = Date.now() - startTime; startTime = Date.now();

    for (let i = 0; i < signedTxsJSON.length; i++) {
        node.addTransactionJSONToMemPool(signedTxsJSON[i]);
    }
    const timeToPushAllTxsToMempool = Date.now() - startTime;

    console.log(`[TEST-USTNU] NbTxs: ${accounts.length} | timeToCreate: ${(timeToCreateAndSignAllTxs / 1000).toFixed(2)}s | timeToPush: ${(timeToPushAllTxsToMempool / 1000).toFixed(2)}s`);
}
/** User send to all other accounts
* @param {Node} node
* @param {Account[]} accounts
* @param {number} senderAccountIndex
 */
async function userSendToAllOthers(node, accounts, senderAccountIndex = 1) {
    try {
        //const startTime = Date.now();
        const senderAccount = accounts[senderAccountIndex];
        const transfers = [];
        for (let i = 0; i < accounts.length; i++) {
            if (i === senderAccountIndex) { continue; }
            const amount = Math.floor(Math.random() * (1_000_000) + 1_100_000);
            const transfer = { recipientAddress: accounts[i].address, amount };
            transfers.push(transfer);
        }
        const transaction = await contrast.Transaction_Builder.createTransferTransaction(senderAccount, transfers);
        const signedTx = await senderAccount.signTransaction(transaction);
        const signedTxJSON = contrast.Transaction_Builder.getTransactionJSON(signedTx)
    
        if (signedTxJSON) {
            //console.log(`[TEST] SEND: ${senderAccount.address} -> rnd() -> ${transfers.length} users`);
            //console.log(`[TEST] Submit transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
            const fee = JSON.parse(signedTxJSON)
            if (fee <= 0) {
                console.log('[TEST] Transaction fee is invalid.');};
                
            node.addTransactionJSONToMemPool(signedTxJSON);
        } else {
            console.log(error);
        }
    } catch (error) {
        console.log(`[TEST-USTAO] Can't send to all others: ${error.message}`);
    }
    //console.log(`[TEST-USTAO] NbTxs: ${transfers.length} | Time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
}
/** User stakes in VSS
 * @param {Node} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} amountToStake
 */
async function userStakeInVSS(node, accounts, senderAccountIndex = 1, amountToStake = 1_000_000) {
    const senderAccount = accounts[senderAccountIndex];
    const stakingAddress = accounts[senderAccountIndex].address;
    
    const transaction = await contrast.Transaction_Builder.createStakingNewVssTransaction(senderAccount, stakingAddress, amountToStake);
    const signedTx = await senderAccount.signTransaction(transaction);
    const signedTxJSON = contrast.Transaction_Builder.getTransactionJSON(signedTx);
    if (signedTxJSON) {
        //console.log(`[TEST] STAKE: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToStake)}`);
        //console.log(`[TEST] Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
        node.addTransactionJSONToMemPool(signedTxJSON);
    } else {
        console.log(error);
    }
}
/**
 * @param {Node} node
 * @param {Account[]} accounts
 */
function refreshAllBalances(node, accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const { spendableBalance, balance, UTXOs } = node.utxoCache.getBalanceSpendableAndUTXOs(accounts[i].address);
        accounts[i].setBalanceAndUTXOs(balance, UTXOs);
    }
}

async function waitForP2PNetworkReady(nodes, maxAttempts = 30, interval = 1000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const allNodesConnected = nodes.every(node => {
            const peerCount = node.node.p2pNetwork.getConnectedPeers().length;
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

/** 
 * @param {Account[]} accounts
 * @param {WebSocketServer} wss
 */
async function nodeSpecificTest(accounts, wss) {
    if (!contrast.utils.isNode) { return; }

    const factory = new NodeFactory();
    const createdMinerNode = await factory.createNode(accounts[1], 'miner' );
    const validatorNode = { node: createdMinerNode.node, nodeId: accounts[1].address, account: accounts[1] };
    createdMinerNode.node.miner.useDevArgon2 = testParams.useDevArgon2;
    await createdMinerNode.node.start();

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create validator node
    const createdNode = await factory.createNode(accounts[0],  'validator' );
    const node = createdNode.node;
    const minerNode = { node, nodeId: accounts[0].address, account: accounts[0] };
    node.useDevArgon2 = testParams.useDevArgon2;
    node.memPool.useDevArgon2 = testParams.useDevArgon2;
    await node.start();

    await waitForP2PNetworkReady([validatorNode, minerNode]);

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('[TEST] Node & Miner => Initialized. - start mining');
    let lastBlockIndexAndTime = { index: 0, time: Date.now() };
    let txsTaskDoneThisBlock = {};
    
    for (let i = 0; i < 1_000_000; i++) {
        if (node.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            lastBlockIndexAndTime.index = node.blockCandidate.index;
            txsTaskDoneThisBlock = {}; // reset txsTaskDoneThisBlock
            
            wss.clients.forEach(function each(client) { // wss broadcast - utxoCache
                if (client.readyState === 1) {
                    client.send( JSON.stringify({ utxoCache: node.utxoCache }) );
                }
            });

            /*const timeDiff = Date.now() - lastBlockIndexAndTime.time;
            console.log(`[TEST] New block: ${node.blockCandidate.index} | Time: ${timeDiff}ms`);
            lastBlockIndexAndTime.time = Date.now();*/
        }
        await new Promise(resolve => setTimeout(resolve, 100));

        refreshAllBalances(node, accounts);

        miner.pushCandidate(node.blockCandidate);
        
        // user send to multiple users
        if (node.blockCandidate.index > 7 && (node.blockCandidate.index - 1) % 7 === 0 && !txsTaskDoneThisBlock['userSendToAllOthers']) {
            try {
                await userSendToAllOthers(node, accounts);
                txsTaskDoneThisBlock['userSendToAllOthers'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // user stakes in VSS
        if (node.blockCandidate.index > 24 && node.blockCandidate.index < 35 && !txsTaskDoneThisBlock['userStakeInVSS']) {
            try {
                const senderAccountIndex = node.blockCandidate.index - 25;
                await userStakeInVSS(node, accounts, senderAccountIndex);
                txsTaskDoneThisBlock['userStakeInVSS'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // simple user to user transactions
        if (node.blockCandidate.index > 50 && (node.blockCandidate.index - 1) % 8 === 0 && !txsTaskDoneThisBlock['userSendToUser']) {
            try {
                await userSendToUser(node, accounts);
                txsTaskDoneThisBlock['userSendToUser'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // users Send To Next Users
        if (node.blockCandidate.index > 100 && (node.blockCandidate.index - 1) % 5 === 0 && !txsTaskDoneThisBlock['userSendToNextUser']) {
            try {
                await userSendToNextUser(node, accounts);
                txsTaskDoneThisBlock['userSendToNextUser'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // wss broadcast - mempool
        if (node.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            wss.clients.forEach(function each(client) {
                if (client.readyState === 1) {
                    client.send( JSON.stringify({ memPool: node.memPool }) );
                }
            });
        }

        await node.callStack.breathe();
    }

    console.log('[TEST] Node test completed. - stop mining');
}
/** @param {WebSocketServer} wss */
export async function test(wss) {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    const wallet = await contrast.Wallet.restore("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);
    if (!wallet) { console.error('Failed to restore wallet.'); return; }
    timings.walletRestore = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.loadAccounts();
    
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    timings.deriveAccounts = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.saveAccounts();
    
    console.log(`[TEST] account0 address: [ ${contrast.utils.addressUtils.formatAddress(derivedAccounts[0].address, ' ')} ]`);
    
    console.log(
`__Timings -----------------------
| -- walletRestore: ${timings.walletRestore}ms
| -- deriveAccounts(${testParams.nbOfAccounts}): ${timings.deriveAccounts}ms
| -- deriveAccountsAvg: ~${(timings.deriveAccounts / testParams.nbOfAccounts).toFixed(2)}ms
| -- deriveAccountAvgIterations: ${avgIterations}
| -- total: ${Date.now() - timings.startTime}ms
---------------------------------`
    );

    nodeSpecificTest(derivedAccounts, wss);
};