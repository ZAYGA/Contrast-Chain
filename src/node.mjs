import localStorage_v1 from '../storage/local-storage-management.mjs';
import { Validation } from './validation.mjs';
import { CallStack } from './callstack.mjs';
import { Vss } from './vss.mjs';
import { MemPool } from './memPool.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Miner } from './miner.mjs';
import P2PNetwork from './p2p.mjs';
import utils from './utils.mjs';

/**
* @typedef {import("./account.mjs").Account} Account
* @typedef {import("./transaction.mjs").Transaction} Transaction
*/

export class Node {
    /** @param {Account} account */
    constructor(account, role = 'validator', p2pOptions = {}) {
        /** @type {string} */
        this.id = account.address;
        /** @type {string} */
        this.role = role; // 'miner' or 'validator'
        /** @type {CallStack} */
        this.callStack = CallStack.buildNewStack(['Conflicting UTXOs', 'Invalid block index:', 'UTXOs(one at least) are spent']);
        /** @type {P2PNetwork} */
        this.p2pNetwork = new P2PNetwork({
            role: this.role,
            ...p2pOptions
        });

        /** @type {Account} */
        this.account = account;
        /** @type {BlockData} */
        this.blockCandidate = null;

        /** @type {Vss} */
        this.vss = new Vss();
        /** @type {MemPool} */
        this.memPool = new MemPool();
        /** @type {UtxoCache} */
        this.utxoCache = new UtxoCache();
        /** @type {Miner} */
        this.miner = new Miner(account, this.p2pNetwork);

        this.useDevArgon2 = false;
        this.considerDefinitiveAfter = 6; // in blocks
        this.confirmedBlocks = [];
        this.utxoCacheSnapshots = [];
        this.lastBlockData = null;
    }

    /** 
     * @param {Account} account
     * @param {string} role
     * @param {Object<string, any>} p2pOptions
     * @param {boolean} saveBlocksInfo
     */
    static async load(account, role, p2pOptions = {}, saveBlocksInfo = false) {
        const node = new Node(account, role, p2pOptions);
        return node;
    }
    async start() {
        await this.p2pNetwork.start();
        // Set the event listeners
        //this.p2pNetwork.subscribe('new_transaction', this.handleNewTransaction.bind(this));
        //this.p2pNetwork.subscribe('new_block_proposal', this.handleNewBlockFromValidator.bind(this));
        //this.p2pNetwork.subscribe('new_block_pow', this.handleNewBlockFromMiners.bind(this));

        const topicsToSubscribe = ['new_transaction', 'new_block_proposal', 'new_block_pow'];
        await this.p2pNetwork.subscribeMultipleTopics(topicsToSubscribe, this.p2pHandler.bind(this));

        console.info(`Node ${this.id.toString()} , ${this.role.toString()} started`);
    }
    async stop() {
        await this.p2pNetwork.stop();
        if (this.miner) { this.miner.terminate(); }
        console.log(`Node ${this.id} (${this.role}) => stopped`);
    }
    async createBlockCandidateAndBroadcast() {
        if (this.role === 'validator') {
            this.blockCandidate = await this.#createBlockCandidate();
            this.broadcastCandidate(this.blockCandidate);
        }
    } // Work as a "init"

    /** @param {BlockData} minerCandidate */
    async #validateBlockProposal(minerCandidate) {
        try {
            // verify the height
            const lastBlockIndex = this.lastBlockData ? this.lastBlockData.index : -1;

            if (minerCandidate.index <= lastBlockIndex) { console.log(`Rejected block proposal, older index: ${minerCandidate.index} <= ${lastBlockIndex}`); return false; }
            if (minerCandidate.index > lastBlockIndex + 1) { console.log(`Rejected block proposal, higher index: ${minerCandidate.index} > ${lastBlockIndex + 1}`); return false; }

            // verify the hash
            const { hex, bitsArrayAsString } = await Block.getMinerHash(minerCandidate, this.useDevArgon2);
            if (minerCandidate.hash !== hex) { return 'Hash invalid!'; }
            const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, minerCandidate);
            if (!hashConfInfo.conform) { return 'Hash not conform!'; }

            // control coinBase Amount
            const coinBaseAmount = minerCandidate.Txs[0].outputs[0].amount;
            const expectedCoinBase = Block.calculateNextCoinbaseReward(minerCandidate);
            if (coinBaseAmount !== expectedCoinBase) { return `Invalid coinbase amount: ${coinBaseAmount} - expected: ${expectedCoinBase}`; }

            // double spend control
            Validation.isFinalizedBlockDoubleSpending(this.utxoCache.utxosByAnchor, minerCandidate);

            // verify the transactions
            for (let i = 0; i < minerCandidate.Txs.length; i++) {
                const tx = minerCandidate.Txs[i];
                const isCoinBase = Transaction_Builder.isCoinBaseOrFeeTransaction(tx, i);
                const txValidation = await Validation.fullTransactionValidation(this.utxoCache.utxosByAnchor, tx, isCoinBase, this.useDevArgon2);
                if (!txValidation.success) {
                    const error = txValidation;
                    return `Invalid transaction: ${tx.id} - ${error}`;
                }
            }

            return hashConfInfo;
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    /** @param {BlockData} minerCandidate */
    async #digestPowProposal(minerCandidate) {
        if (!minerCandidate) { throw new Error('Invalid block candidate'); }
        if (this.role !== 'validator') { throw new Error('Only validator can process PoW block'); }

        //console.log(`[NODE] Processing PoW block: ${minerCandidate.index} | ${minerCandidate.hash}`);
        const startTime = Date.now();
        
        const hashConfInfo = await this.#validateBlockProposal(minerCandidate);
        if (!hashConfInfo.conform) { return false; }

        const blockDataCloneToDigest = Block.cloneBlockData(minerCandidate); // clone to avoid modification
        try {
            const newStakesOutputs = await this.utxoCache.digestConfirmedBlocks([blockDataCloneToDigest]);
            //console.log(`[NODE -- VALIDATOR] digestPowProposal accepted: blockIndex: ${minerCandidate.index} | legitimacy: ${minerCandidate.legitimacy}`);
            if (newStakesOutputs.length > 0) { this.vss.newStakes(newStakesOutputs); }
        } catch (error) {
            if (error.message !== "Invalid total of balances") { throw error; }
            console.warn(`[NODE -- VALIDATOR] digestPowProposal rejected: blockIndex: ${minerCandidate.index} | legitimacy: ${minerCandidate.legitimacy}
----------------------
|| ${error.message} || ==> Rollback UTXO cache
----------------------`);
            this.utxoCache.rollbackUtxoCacheSnapshot(this.utxoCacheSnapshots.pop());
            return false;
        }

        //console.log(`[NODE] Block ${minerCandidate.index} | ${minerCandidate.hash} processed in ${(Date.now() - startTime) / 1000}s`);
        
        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.utxosByAnchor);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);
        
        this.#digestConfirmedBlock(minerCandidate); // will store the block in ram, and save older blocks if ahead enough
        //console.log(`[NODE] Block ${minerCandidate.index} | ${minerCandidate.hash} processed in ${(Date.now() - startTime) / 1000}s`);
        
        this.utxoCacheSnapshots.push(this.utxoCache.getUtxoCacheSnapshot());
        if (this.utxoCacheSnapshots.length > this.considerDefinitiveAfter) { this.utxoCacheSnapshots.shift(); }

        /*simple log for debug ----------------------
        const powMinerTx = minerCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.utxoCache.getBalanceAndUTXOs(address);
        console.log(`[NODE] Height: ${minerCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        */
        const timeBetweenPosPow = ((minerCandidate.timestamp - minerCandidate.posTimestamp) / 1000).toFixed(2);
        console.info(`[NODE] H:${minerCandidate.index} -> ( diff: ${hashConfInfo.difficulty} + timeAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} ) = finalDiff: ${hashConfInfo.finalDifficulty} | z: ${hashConfInfo.zeros} | a: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | processProposal: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        //console.log(`[NODE] Calculating new block candidate after PoW block: ${minerCandidate.index} | ${minerCandidate.hash}`);

        this.blockCandidate = await this.#createBlockCandidate();
        this.broadcastCandidate(this.blockCandidate);

        return true;
    }
    /** @param {BlockData} minerCandidate */
    #digestConfirmedBlock(minerCandidate) {
        // store clones to avoid modification
        this.lastBlockData = Block.cloneBlockData(minerCandidate);
        this.confirmedBlocks.push(Block.cloneBlockData(minerCandidate));
        if (this.confirmedBlocks.length <= this.considerDefinitiveAfter) { return; }

        // save the block in local storage definitively
        const blockToDefinitivelySave = this.confirmedBlocks.shift();
        if (this.blockCandidate.index <= 1000) { localStorage_v1.saveBlockDataLocally(this.id, blockToDefinitivelySave, 'json'); }
        const saveResult = localStorage_v1.saveBlockDataLocally(this.id, blockToDefinitivelySave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }
    }
    async #createBlockCandidate() {
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, 0, 'ContrastGenesisBlock', Txs, Date.now());
        if (this.lastBlockData) {
            await this.vss.calculateRoundLegitimacies(this.lastBlockData.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.account.address}, can't create a candidate`); }

            const newDifficulty = utils.mining.difficultyAdjustment(this.utxoCache.blockMiningData);
            const clone = Block.cloneBlockData(this.lastBlockData);
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(this.lastBlockData.index + 1, clone.supply + clone.coinBase, coinBaseReward, newDifficulty, myLegitimacy, clone.hash, Txs, Date.now());
        }

        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, this.account.address, this.account.address);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        if (blockCandidate.Txs.length > 3) console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${(Date.now() - startTime)}ms`);

        return blockCandidate;
    }

    /**
     * @param {string} topic 
     * @param {object} message 
     */
    async p2pHandler(topic, message) {
        const data = message;
        try {
            switch (topic) {
                case 'new_transaction':
                    if (this.role !== 'validator') { break; }
                    this.addTransactionJSONToMemPool(data);
                    break;
                case 'new_block_proposal':
                    if (this.role !== 'miner') { break; }
                    this.miner.pushCandidate(data);
                    break;
                case 'new_block_pow':
                    if (this.role !== 'validator') { break; }
                    //await this.#processPowBlock(message.blockPow); NO !!
                    this.submitPowProposal(data);
                    break;
                default:
                    console.error(`[P2P-HANDLER] ${topic} -> Unknown topic`);
            }
        } catch (error) {
            console.error(`[P2P-HANDLER] ${topic} -> Failed! `, error);
        }
    }
    /**
     * @param {string} signedTxJSON
     * @param {false | string} replaceExistingTxID
     */
    addTransactionJSONToMemPool(signedTxJSON, replaceExistingTxID = false) {
        if (typeof signedTxJSON !== 'string') { throw new Error('Invalid transaction'); }

        const signedTransaction = Transaction_Builder.transactionFromJSON(signedTxJSON);
        this.memPool.submitTransaction(this.callStack, this.utxoCache.utxosByAnchor, signedTransaction, replaceExistingTxID);
    }
    /** @param {BlockData} minerCandidate */
    submitPowProposal(minerCandidate) {
        this.callStack.push(() => this.#digestPowProposal(minerCandidate));
    }

    /**
     * @param {string} topic 
     * @param {*} message 
     */
    async p2pBroadcaster(topic, message) { // Waiting for P2P developper : sinon.psy() would be broken ?
        await this.p2pNetwork.broadcast(topic, message);
    }

    // I'll be happy if we replace that by one function with a switch case
    /** @param {Transaction} transaction */
    async broadcastTransaction(transaction) {
        //console.log(`[NODE] Broadcasting transaction: ${transaction.id}`);
        //await this.p2pNetwork.broadcast('new_transaction', { transaction });
        await this.p2pNetwork.broadcast('new_transaction', transaction);
    }
    /** @param {BlockData} blockProposal */
    async broadcastCandidate(blockProposal) {
        const clone = Block.cloneBlockData(blockProposal);
        await this.p2pNetwork.broadcast('new_block_proposal', clone);
    }
    /** @param {BlockData} blockPow */
    async broadcastBlockPow(blockPow) {
        //console.log(`[NODE] Broadcasting block PoW: ${blockPow.index} | ${blockPow.hash}`);
        //await this.p2pNetwork.broadcast('new_block_pow', { blockPow });
        await this.p2pNetwork.broadcast('new_block_pow', blockPow);
    }

    getStatus() {
        return {
            id: this.id,
            role: this.role,
            currentBlockHeight: this.blockCandidate ? this.blockCandidate.index : 0,
            memPoolSize: Object.keys(this.memPool.transactionsByID).length,
            peerCount: this.p2pNetwork.getConnectedPeers().length,
        };
    }
}