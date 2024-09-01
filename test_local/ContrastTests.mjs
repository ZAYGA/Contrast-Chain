'use strict';
import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

const testParams = {
    useDevArgon2: true,
    nbOfAccounts: 400,
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
        node.broadcastTransaction(signedTxJSON);
    } else {
        console.log(error);
    }
}
/** All users send to the next user
* @param {Node} node
* @param {Account[]} accounts
* @param {number} nbOfUsers
 */
async function userSendToNextUser(node, accounts, validatorNode = false) {
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
    const timeToCreateAndSignAllTxs = Date.now() - startTime;
    startTime = Date.now();

    for (let i = 0; i < signedTxsJSON.length; i++) {
        /*if (validatorNode) { 
            validatorNode.addTransactionJSONToMemPool(signedTxsJSON[i]);
            continue;
        }*/
        await node.broadcastTransaction(signedTxsJSON[i]);
        //node.addTransactionJSONToMemPool(signedTxsJSON[i]);
    }
    const timeToPushAllTxsToMempool = Date.now() - startTime;

    console.log(`[TEST-USTNU] NbTxs: ${accounts.length} | timeToCreate: ${(timeToCreateAndSignAllTxs / 1000).toFixed(2)}s | timeToBroadcast: ${(timeToPushAllTxsToMempool / 1000).toFixed(2)}s`);
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
                console.log('[TEST] Transaction fee is invalid.');
            };

            node.broadcastTransaction(signedTxJSON);
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
        node.broadcastTransaction(signedTxJSON);
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

/**
 * @param {Account[]} accounts
 * @param {WebSocketServer} wss
 */
async function nodeSpecificTest(accounts, wss) {
    if (!contrast.utils.isNode) { return; }

    //#region init nodes
    const factory = new NodeFactory();
    const useDevArgon2 = testParams.useDevArgon2;

    const minerNode = await factory.createNode(accounts[1], 'miner');
    minerNode.miner.useDevArgon2 = useDevArgon2;
    minerNode.memPool.useDevArgon2 = useDevArgon2;
    await minerNode.start();

    // Create validator node
    const validatorNode = await factory.createNode(accounts[0], 'validator');
    await contrast.localStorage_v1.loadBlockchainLocally(validatorNode);

    validatorNode.useDevArgon2 = useDevArgon2;
    validatorNode.memPool.useDevArgon2 = useDevArgon2;
    await validatorNode.start();

    await waitForP2PNetworkReady([validatorNode, minerNode]);

    minerNode.miner.startWithWorker(); // TODO : dont forget this one

    await validatorNode.createBlockCandidateAndBroadcast();

    console.log('[TEST] Node & Miner => Initialized. - start mining');
    //#endregion

    await new Promise(resolve => setTimeout(resolve, 1000));

    /*let msgWeight = 1_000;
    for (let i = 0; i < msgWeight; i++) {
        const heavyMessageUint8 = new Uint8Array(msgWeight);
        heavyMessageUint8[i] = Math.floor(Math.random() * 256);
        console.log(`[TEST] heavy msg bytes: ${heavyMessageUint8.length}`);
        minerNode.broadcastTest(heavyMessageUint8);
        await new Promise(resolve => setTimeout(resolve, 1000));

        msgWeight += 1_000;
    }

    while(true) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }*/
    // Loop and spent different transactions
    const lastBlockIndexAndTime = { index: 0, time: Date.now() };
    let txsTaskDoneThisBlock = {};
    for (let i = 0; i < 1_000_000; i++) {
        if (validatorNode.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            //inerNode.miner.pushCandidate(validatorNode.blockCandidate); // debug only
            lastBlockIndexAndTime.index = validatorNode.blockCandidate.index;
            txsTaskDoneThisBlock = {}; // reset txsTaskDoneThisBlock

            wss.clients.forEach(function each(client) { // wss broadcast - utxoCache
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ utxoCache: validatorNode.utxoCache }));
                }
            });

            /*const timeDiff = Date.now() - lastBlockIndexAndTime.time;
            console.log(`[TEST] New block: ${node.blockCandidate.index} | Time: ${timeDiff}ms`);
            lastBlockIndexAndTime.time = Date.now();*/
        }
        await new Promise(resolve => setTimeout(resolve, 100));

        refreshAllBalances(validatorNode, accounts);

        // user send to multiple users
        if (validatorNode.blockCandidate.index > 7 && (validatorNode.blockCandidate.index - 1) % 7 === 0 && !txsTaskDoneThisBlock['userSendToAllOthers']) {
            try {
                txsTaskDoneThisBlock['userSendToAllOthers'] = true;
                await userSendToAllOthers(minerNode, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        // user stakes in VSS
        if (validatorNode.blockCandidate.index > 14 && validatorNode.blockCandidate.index < 25 && !txsTaskDoneThisBlock['userStakeInVSS']) {
            try {
                txsTaskDoneThisBlock['userStakeInVSS'] = true;
                const senderAccountIndex = validatorNode.blockCandidate.index - 25;
                await userStakeInVSS(minerNode, accounts, senderAccountIndex);
            } catch (error) {
                console.error(error);
            }
        }

        // simple user to user transactions
        if (validatorNode.blockCandidate.index > 1 && (validatorNode.blockCandidate.index - 1) % 8 === 0 && !txsTaskDoneThisBlock['userSendToUser']) {
            try {
                txsTaskDoneThisBlock['userSendToUser'] = true;
                await userSendToUser(minerNode, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        // users Send To Next Users
        if (validatorNode.blockCandidate.index > 40 && (validatorNode.blockCandidate.index - 1) % 6 === 0 && !txsTaskDoneThisBlock['userSendToNextUser']) {
            try {
                txsTaskDoneThisBlock['userSendToNextUser'] = true;
                await userSendToNextUser(minerNode, accounts, validatorNode);
            } catch (error) {
                console.error(error);
            }
        }

        // wss broadcast - mempool
        /*if (validatorNode.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            wss.clients.forEach(function each(client) {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ memPool: validatorNode.memPool }));
                }
            });
        }*/

        await validatorNode.callStack.breathe();
    }

    console.log('[TEST] Node test completed. - stop mining');
}
/** @param {WebSocketServer} wss */
export async function test(wss) {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    const wallet = new contrast.Wallet("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);
    const restored = await wallet.restore();
    if (!restored) { console.error('Failed to restore wallet.'); return; }
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