'use strict';
import { Transaction_Builder } from './src/index.mjs';
import contrast from './src/contrast.mjs';
/**
* @typedef {import("./src/account.mjs").Account} Account
* @typedef {import("./src/node.mjs").FullNode} FullNode
*/

const testParams = {
    nbOfAccounts: 10,
    addressType: 'W',
    testTxEachNbBlock: 10
}

/** Simple user to user transaction
 * @param {FullNode} node
 * @param {Account[]} accounts
 * @param {number} senderAccountIndex
 * @param {number} receiverAccountIndex
 */
async function userSendToUser(node, accounts, senderAccountIndex = 1, receiverAccountIndex = 2) {
    const senderAccount = accounts[senderAccountIndex];
    const receiverAddress = accounts[receiverAccountIndex].address;

    const amountToSend = 1_000_000;
    const { signedTxJSON, error } = await Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAddress);
    if (signedTxJSON) {
        console.log(`SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAddress}`);
        console.log(`Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
        node.addTransactionJSONToMemPool(signedTxJSON);
    } else {
        console.log(error);
    }
}
/** All users send to the next user
* @param {FullNode} node
* @param {Account[]} accounts
* @param {number} nbOfUsers
 */
async function userSendToNextUser(node, accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const senderAccount = accounts[i];
        const receiverAccount = i === accounts.length - 1 ? accounts[0] : accounts[i + 1];

        const amountToSend = Math.floor(Math.random() * (1_000) + 1000);
        const { signedTxJSON, error } = await Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAccount.address);
        if (signedTxJSON) {
            console.log(`[TEST] SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAccount.address}`);
            console.log(`[TEST] Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
            node.addTransactionJSONToMemPool(signedTxJSON);
        } else {
            console.log(error);
        }
    }
}
/** User send to all other accounts
* @param {FullNode} node
* @param {Account[]} accounts
* @param {number} senderAccountIndex
 */
async function userSendToAllOthers(node, accounts, senderAccountIndex = 1) {
    const senderAccount = accounts[senderAccountIndex];
    const transfers = [];
    for (let i = 2; i < accounts.length; i++) {
        const amount = Math.floor(Math.random() * (1_000_000 - 1000) + 1000);
        const transfer = { recipientAddress: accounts[i].address, amount };
        transfers.push(transfer);
    }
    const transaction = Transaction_Builder.createTransferTransaction(senderAccount, transfers);
    const signedTx = await senderAccount.signAndReturnTransaction(transaction);
    signedTx.id = await Transaction_Builder.hashTxToGetID(signedTx);
    const signedTxJSON = Transaction_Builder.getTransactionJSON(signedTx)

    if (signedTxJSON) {
        console.log(`[TEST] SEND: ${senderAccount.address} -> rnd() -> ${transfers.length} users`);
        console.log(`[TEST] Submit transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
        const fee = JSON.parse(signedTxJSON)
        if (fee <= 0) {
            console.log('[TEST] Transaction fee is invalid.');};
            
        node.addTransactionJSONToMemPool(signedTxJSON);
    } else {
        console.log(error);
    }
}
/**
 * @param {FullNode} node
 * @param {Account[]} accounts
 */
function refreshAllBalances(node, accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const { balance, UTXOs } = node.hotData.getBalanceAndUTXOs(accounts[i].address);
        accounts[i].setBalanceAndUTXOs(balance, UTXOs);
    }
}
/** @param {Account[]} accounts */
async function nodeSpecificTest(accounts) {
    if (!contrast.utils.isNode) { return; }

    /** @type {FullNode} */
    const node = await contrast.FullNode.load(accounts[0]);
    if (!node) { console.error('Failed to load FullNode.'); return; }

    const miner = new contrast.Miner(accounts[1]);
    if (!miner) { console.error('Failed to load Miner.'); return; }

    for (let i = 0; i < 1_000_000; i++) {
        refreshAllBalances(node, accounts);

        // user Send To Next User
        if (node.blockCandidate.index > 2 && (node.blockCandidate.index - 1) % 5 === 0) {
            /*try {
                await userSendToNextUser(node, accounts);
            } catch (error) {
                console.error(error);
            }*/
        } // Disabled

        // user send to multiple users
        if (node.blockCandidate.index > 2 && (node.blockCandidate.index - 1) % 7 === 0) {
            try {
                await userSendToAllOthers(node, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        // simple user to user transactions
        if (node.blockCandidate.index > 2 && (node.blockCandidate.index - 1) % testParams.testTxEachNbBlock === 0) { // TRANSACTION TEST
            try {
                await userSendToUser(node, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        try { // JUST MINING
            // like we receive a block from network
            const blockCandidateClone = contrast.Block.cloneBlockData(node.blockCandidate);

            const { validBlockCandidate } = await miner.minePow(blockCandidateClone);
            if (!validBlockCandidate) { throw new Error('Not valid nonce.'); }

            node.submitPowProposal(validBlockCandidate);
        } catch (error) {
            const errorIncludesPOWerror = error.message.includes('unlucky--'); // mining invalid nonce/hash
            const errorSkippingLog = ['Not valid nonce.'];
            if (errorIncludesPOWerror === false && errorSkippingLog.includes(error.message) === false) { console.error(error.stack); }
        }

        await node.callStack.breathe();
    }

    console.log('[TEST] Node test completed. - stop mining');
}
async function test() {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    const wallet = await contrast.Wallet.restore("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00");
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

    nodeSpecificTest(derivedAccounts);
}; test();