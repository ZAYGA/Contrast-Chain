'use strict';
import contrast from '../src/contrast.mjs';
import { NodeFactory } from '../src/node-factory.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
* @typedef {import("../src/node.mjs").Node} Node
*/

const testParams = {
    useDevArgon2: false, // true => 100txs processProposal: ~7sec | false => 100txs processProposal: ~5.8sec
    nbOfAccounts: 200,
    addressType: 'W',

    nbOfMiners: 1,
    nbOfValidators: 0,
    nbOfMultiNodes: 1,

    txsSeqs: {
        userSendToAllOthers: { active: false, start: 5, end: 100000, interval: 4},
        stakeVss: { active: false, start: 15, end: 25, interval: 1 },
        simpleUserToUser: { active: false, start: 2, end: 100000, interval: 2 },
        userSendToNextUser: { active: false, start: 40, end: 100000, interval: 6 }
    }
}

/** Simple user to user transaction
 * @param {Node} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} receiverAccountIndex
 */
async function userSendToUser(node, accounts, senderAccountIndex = 0, receiverAccountIndex = 2) {
    const senderAccount = accounts[senderAccountIndex];
    const receiverAddress = accounts[receiverAccountIndex].address;

    const amountToSend = 100_000;
    const { signedTx, error } = await contrast.Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAddress);
    if (signedTx) {
        //console.log(`SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAddress} | txID: ${signedTx.id}`);
        await node.p2pBroadcast('new_transaction', signedTx);
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
        const { signedTx, error } = await contrast.Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAccount.address);
        if (signedTx) {
            signedTxsJSON.push(signedTx);
            //console.log(`[TEST] SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAccount.address}`);
            //console.log(`[TEST] Pushing transaction: ${signedTx.id} to mempool.`);
        } else {
            console.log(error);
        }
    }
    const timeToCreateAndSignAllTxs = Date.now() - startTime;
    startTime = Date.now();

    for (let i = 0; i < signedTxsJSON.length; i++) {
        await node.p2pBroadcast('new_transaction', signedTxsJSON[i]);
    }
    const timeToPushAllTxsToMempool = Date.now() - startTime;

    console.log(`[TEST-USTNU] NbTxs: ${accounts.length} | timeToCreate: ${(timeToCreateAndSignAllTxs / 1000).toFixed(2)}s | timeToBroadcast: ${(timeToPushAllTxsToMempool / 1000).toFixed(2)}s`);
}
/** User send to all other accounts
* @param {Node} node
* @param {Account[]} accounts
* @param {number} senderAccountIndex
 */
async function userSendToAllOthers(node, accounts, senderAccountIndex = 0) {
    try {
        //const startTime = Date.now();
        const senderAccount = accounts[senderAccountIndex];
        const transfers = [];
        for (let i = 0; i < accounts.length; i++) {
            if (i === senderAccountIndex) { continue; }
            const amount = Math.floor(Math.random() * (100_000) + 100_000); // from 100k to 200k
            const transfer = { recipientAddress: accounts[i].address, amount };
            transfers.push(transfer);
        }
        const transaction = await contrast.Transaction_Builder.createTransferTransaction(senderAccount, transfers);
        const signedTx = await senderAccount.signTransaction(transaction);

        if (signedTx) {
            //console.log(`[TEST] SEND: ${senderAccount.address} -> rnd() -> ${transfers.length} users`);
            //console.log(`[TEST] Submit transaction: ${signedTx.id} to mempool.`);
            await node.p2pBroadcast('new_transaction', signedTx);
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
async function userStakeInVSS(node, accounts, senderAccountIndex = 0, amountToStake = 100_000) {
    const senderAccount = accounts[senderAccountIndex];
    const stakingAddress = senderAccount.address;

    const transaction = await contrast.Transaction_Builder.createStakingNewVssTransaction(senderAccount, stakingAddress, amountToStake);
    const signedTx = await senderAccount.signTransaction(transaction);
    if (signedTx) {
        //console.log(`[TEST] STAKE: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToStake)}`);
        //console.log(`[TEST] Pushing transaction: ${signedTx.id} to mempool.`);
        await node.p2pBroadcast('new_transaction', signedTx);
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
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initMinerNode(factory, account, listenAddress = '/ip4/0.0.0.0/tcp/0') { // /ip4/0.0.0.0/tcp/7777
    const minerNode = await factory.createNode(account, 'miner', { listenAddress });
    minerNode.miner.useDevArgon2 = testParams.useDevArgon2;
    minerNode.memPool.useDevArgon2 = testParams.useDevArgon2;
    await minerNode.start();

    return minerNode;
}
/**
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initValidatorNode(factory, account, listenAddress = '/ip4/0.0.0.0/tcp/0') { // /ip4/0.0.0.0/tcp/0
    const validatorNode = await factory.createNode(account, 'validator', { listenAddress });
    //await contrast.localStorage_v1.loadBlockchainLocally(validatorNode);

    validatorNode.useDevArgon2 = testParams.useDevArgon2;
    validatorNode.memPool.useDevArgon2 = testParams.useDevArgon2;
    await validatorNode.start();

    return validatorNode;
}
/**
 * @param {NodeFactory} factory
 * @param {Account} account
 */
async function initMultiNode(factory, account, listenAddress = '/ip4/0.0.0.0/tcp/7777') {
    const multiNode = await factory.createNode(account, ['validator', 'miner'], { listenAddress });
    await multiNode.start();

    return multiNode;
}
/**
 * @param {Account[]} accounts
 * @param {WebSocketServer} wss
 */
async function nodeSpecificTest(accounts, wss) {
    if (!contrast.utils.isNode) { return; }

    //#region init nodes
    const totalOfNodesToInit = testParams.nbOfMiners + testParams.nbOfValidators + testParams.nbOfMultiNodes;
    const listenAddress = totalOfNodesToInit > 1 ? '/ip4/0.0.0.0/tcp/0' : '/ip4/0.0.0.0/tcp/7777' // ugly
    const factory = new NodeFactory();
    const nodesPromises = [];
    for (let i = 0; i < testParams.nbOfMiners; i++) {
        nodesPromises.push(initMinerNode(factory, accounts[i], listenAddress));
    }
    for (let i = testParams.nbOfMiners; i < testParams.nbOfValidators + testParams.nbOfMiners; i++) {
        nodesPromises.push(initValidatorNode(factory, accounts[i], listenAddress));
    }
    for (let i = testParams.nbOfMiners + testParams.nbOfValidators; i < testParams.nbOfMultiNodes + testParams.nbOfMiners + testParams.nbOfValidators; i++) {
        nodesPromises.push(initMultiNode(factory, accounts[i], listenAddress));
    }

    const nodes = await Promise.all(nodesPromises);

    await waitForP2PNetworkReady(nodes);

    let minerNode;
    let validatorNode;
    for (const node of nodes) {
        //if (node.roles.includes('miner')) { if (!minerNode) { minerNode = node; } }
        //if (node.roles.includes('validator')) { if (!validatorNode) { validatorNode = node; } }
        if (node.roles.includes('miner')) { node.miner.startWithWorker(); if (!minerNode) { minerNode = node; } }
        if (node.roles.includes('validator')) { node.createBlockCandidateAndBroadcast(); if (!validatorNode) { validatorNode = node; } }
    }

    console.log('[TEST] Nodes Initialized. - start mining');
    //#endregion

    await new Promise(resolve => setTimeout(resolve, 1000));

    // while (true) { await new Promise(resolve => setTimeout(resolve, 1000)); }
    
    /* TEST OF HEAVY MESSAGES NETWORKING OVER P2P
    let msgWeight = 1_000;
    while(true) {
        const aBigObject = {}
        //const heavyMessageUint8 = new Uint8Array(msgWeight);
        for (let i = 0; i < msgWeight; i++) {
            aBigObject[i] = Math.floor(Math.random() * 256);
            //heavyMessageUint8[i] = Math.floor(Math.random() * 256);
        }
        const msgPackStartTimestamp = Date.now();
        const heavyMessageUint8 = contrast.utils.compression.msgpack_Zlib.rawData.toBinary_v1(aBigObject);
        console.log(`[TEST] heavy msg bytes: ${heavyMessageUint8.length} - compressed in: ${Date.now() - msgPackStartTimestamp}ms`);
        await minerNode.p2pNetwork.broadcast('test', heavyMessageUint8);
        msgWeight += 10;
        await new Promise(resolve => setTimeout(resolve, 100));
    }*/

    // Loop and spent different transactions
    const lastBlockIndexAndTime = { index: 0, time: Date.now() };
    let txsTaskDoneThisBlock = {};
    for (let i = 0; i < 1_000_000; i++) {
        if (validatorNode.blockCandidate.index > lastBlockIndexAndTime.index) { // new block only
            lastBlockIndexAndTime.index = validatorNode.blockCandidate.index;
            // delete txsTaskDoneThisBlock if the operation is done(value=true)
            for (let key in txsTaskDoneThisBlock) {
                if (txsTaskDoneThisBlock.hasOwnProperty(key) && txsTaskDoneThisBlock[key] === true) {
                    delete txsTaskDoneThisBlock[key];
                }
            }

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

        // user send to all others
        if (testParams.txsSeqs.userSendToAllOthers.active && validatorNode.blockCandidate.index >= testParams.txsSeqs.userSendToAllOthers.start && (validatorNode.blockCandidate.index - 1) % testParams.txsSeqs.userSendToAllOthers.interval === 0 && !txsTaskDoneThisBlock['userSendToAllOthers']) {
            try {
                txsTaskDoneThisBlock['userSendToAllOthers'] = false;
                await userSendToAllOthers(minerNode, accounts);
                txsTaskDoneThisBlock['userSendToAllOthers'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // user stakes in VSS
        if (testParams.txsSeqs.stakeVss.active && validatorNode.blockCandidate.index >= testParams.txsSeqs.stakeVss.start && validatorNode.blockCandidate.index < testParams.txsSeqs.stakeVss.end && !txsTaskDoneThisBlock['userStakeInVSS']) {
            try {
                txsTaskDoneThisBlock['userStakeInVSS'] = false;
                const senderAccountIndex = validatorNode.blockCandidate.index - testParams.txsSeqs.stakeVss.start;
                txsTaskDoneThisBlock['userStakeInVSS'] = true;
                await userStakeInVSS(minerNode, accounts, senderAccountIndex);
            } catch (error) {
                console.error(error);
            }
        }

        // simple user to user transactions
        if (testParams.txsSeqs.simpleUserToUser.active && validatorNode.blockCandidate.index >= testParams.txsSeqs.simpleUserToUser.start && (validatorNode.blockCandidate.index - 1) % testParams.txsSeqs.simpleUserToUser.interval === 0 && !txsTaskDoneThisBlock['userSendToUser']) {
            try {
                txsTaskDoneThisBlock['userSendToUser'] = false;
                await userSendToUser(minerNode, accounts);
                txsTaskDoneThisBlock['userSendToUser'] = true;
            } catch (error) {
                console.error(error);
            }
        }

        // users Send To Next Users
        if (testParams.txsSeqs.userSendToNextUser.active && validatorNode.blockCandidate.index >= testParams.txsSeqs.userSendToNextUser.start && (validatorNode.blockCandidate.index - 1) % testParams.txsSeqs.userSendToNextUser.interval === 0 && !txsTaskDoneThisBlock['userSendToNextUser']) {
            try {
                txsTaskDoneThisBlock['userSendToNextUser'] = false;
                await userSendToNextUser(minerNode, accounts, validatorNode);
                txsTaskDoneThisBlock['userSendToNextUser'] = true;
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

        //await validatorNode.callStack.breathe();
    }

    console.log('[TEST] Node test completed. - stop mining');
}
/** @param {WebSocketServer} wss */
export async function test(wss) {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    const wallet = new contrast.Wallet("00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00", testParams.useDevArgon2);
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