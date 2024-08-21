'use strict';
import { Transaction_Builder } from './src/index.mjs';
import contrast from './src/contrast.mjs';
/**
* @typedef {import("./src/Account.mjs").Account} Account
* @typedef {import("./src/Node.mjs").FullNode} FullNode
*/

const testParams = {
    nbOfAccounts: 10,
    addressType: 'W',
    testTxEachNbBlock: 10
}

/**
* @param {FullNode} node
* @param {Account[]} accounts
* @param {number} nbOfUsers
 */
async function userSendToNextUser(node, accounts) {
    for (let i = 0; i < accounts.length; i++) {
        const senderAccount = accounts[i];
        const receiverAccount = i === accounts.length - 1 ? accounts[0] : accounts[i + 1];

        const amountToSend = Math.floor(Math.random() * (1_000_000 - 1000) + 1000);
        const { signedTxJSON, error } = await Transaction_Builder.createAndSignTransferTransaction(senderAccount, amountToSend, receiverAccount.address);
        if (signedTxJSON) {
            console.log(`SEND: ${senderAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAccount.address}`);
            console.log(`Pushing transaction: ${JSON.parse(signedTxJSON).id.slice(0, 12)}... to mempool.`);
            node.addTransactionJSONToMemPool(signedTxJSON);
        } else {
            console.log(error);
        }
    }
}
/**
* @param {FullNode} node
* @param {Account[]} accounts
 */
async function account1SendToAllOthers(node, accounts) {
    const senderAccount = accounts[1];
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
        console.log(`SEND: ${senderAccount.address} -> ${transfers.length} users`);
        console.log(`Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
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
    const validatorAccount = accounts[0];
    const minerAccount = accounts[1];
    const receiverAccount = accounts[2];

    if (!contrast.utils.isNode) { return; }

    /** @type {FullNode} */
    const node = await contrast.FullNode.load(validatorAccount);
    if (!node) { console.error('Failed to load FullNode.'); return; }

    const miner = new contrast.Miner(minerAccount);
    if (!miner) { console.error('Failed to load Miner.'); return; }

    for (let i = 0; i < 1_000_000; i++) {
        if (node.blockCandidate.index > 2 && (node.blockCandidate.index - 1) % 7 === 0) {
            try {
                refreshAllBalances(node, accounts);
                await account1SendToAllOthers(node, accounts);
            } catch (error) {
                console.error(error);
            }
        }

        if (node.blockCandidate.index > 2 && (node.blockCandidate.index - 1) % testParams.testTxEachNbBlock === 0) { // TRANSACTION TEST
            const { balance, UTXOs } = node.hotData.getBalanceAndUTXOs(minerAccount.address); // should be provided by network
            minerAccount.setBalanceAndUTXOs(balance, UTXOs);

            const amountToSend = 1_000_000;
            const { signedTxJSON, error } = await Transaction_Builder.createAndSignTransferTransaction(minerAccount, amountToSend, receiverAccount.address);
            if (signedTxJSON) {
                console.log(`SEND: ${minerAccount.address} -> ${contrast.utils.convert.number.formatNumberAsCurrency(amountToSend)} -> ${receiverAccount.address}`);
                console.log(`Pushing transaction: ${JSON.parse(signedTxJSON).id} to mempool.`);
                node.addTransactionJSONToMemPool(signedTxJSON);
            } else {
                console.log(error);
            }
        }

        try { // JUST MINING
            // like we receive a block from network
            const blockCandidateClone = contrast.Block.cloneBlockData(node.blockCandidate);

            const { validBlockCandidate } = await miner.minePow(blockCandidateClone);
            if (!validBlockCandidate) { throw new Error('Not valid nonce.'); }

            node.submitPowProposal(validBlockCandidate);
            // verify the block as FullNode
            /*const blockProposalSucceed = await node.blockProposal(validBlockCandidate);
            if (!blockProposalSucceed) { throw new Error('Block proposal rejected.'); }
    
            if (validBlockCandidate.hash !== node.blockCandidate.prevHash) { throw new Error('Fatal error: Block proposal accepted but prevHash does not match.'); }*/
        } catch (error) {
            const errorIncludesPOWerror = error.message.includes('unlucky--'); // mining invalid nonce/hash
            const errorSkippingLog = ['Not valid nonce.'];
            if (errorIncludesPOWerror === false && errorSkippingLog.includes(error.message) === false) { console.error(error.stack); }

            /*const errorRequieringReturn = [
                'Fatal error: Block proposal accepted but prevHash does not match.',
                'Block proposal rejected.'
            ];
            if (errorRequieringReturn.includes(error.message)) { return; }*/
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('Node test completed. - stop mining');
}
async function test() {
    const timings = { walletRestore: 0, deriveAccounts: 0, startTime: Date.now(), checkPoint: Date.now() };

    const wallet = await contrast.Wallet.restore("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00");
    if (!wallet) { console.error('Failed to restore wallet.'); return; }
    timings.walletRestore = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.loadAccountsGenerationSequences();
    
    const { derivedAccounts, avgIterations } = await wallet.deriveAccounts(testParams.nbOfAccounts, testParams.addressType);
    if (!derivedAccounts) { console.error('Failed to derive addresses.'); return; }
    timings.deriveAccounts = Date.now() - timings.checkPoint; timings.checkPoint = Date.now();

    wallet.saveAccountsGenerationSequences();
    
    console.log(`account0 address: [ ${contrast.utils.addressUtils.formatAddress(derivedAccounts[0].address, ' ')} ]`);
    
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