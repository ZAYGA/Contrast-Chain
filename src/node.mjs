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
        this.miner = new Miner(account, this.validPowCallback.bind(this));

        this.p2pNetwork = new P2PNetwork({
            role: this.role,
            ...p2pOptions
        });
   
        this.useDevArgon2 = false;
        this.considerDefinitiveAfter = 6; // in blocks
        this.confirmedBlocks = [];
        this.utxoCacheSnapshots = [];
        this.lastBlockData = null;
    }

    /** @param {Account} account */
    static async load(account, role, p2pOptions = {}, saveBlocksInfo = false) {
        const node = new Node(account, role, p2pOptions);
        return node;
    }
    async start() {
        await this.p2pNetwork.start();
        this.setupEventListeners();
        console.info(`Node ${this.id.toString()} , ${this.role.toString()} started`);
    }
    async startMining() {
        if (this.role === 'miner') {
            this.miner.startWithWorker();
        }
    }
    async createBlockCandidateAndBroadcast() {
        if (this.role === 'validator') {
            this.blockCandidate = await this.createBlockCandidate();
            this.broadcastBlockProposal(this.blockCandidate);
        }
    }
    
    async stop() {
        await this.p2pNetwork.stop();
        if (this.role === 'miner') {
            // Implement miner stopping logic if necessary
        }
        console.log(`Node ${this.id} (${this.role}) stopped`);
    }
    setupEventListeners() {
        this.p2pNetwork.on('peer:connect', (peerId) => {
            console.log(`Node ${this.id} connected to peer ${peerId}`);
        });

        this.p2pNetwork.on('peer:disconnect', (peerId) => {
            console.log(`Node ${this.id} disconnected from peer ${peerId}`);
        });

        this.p2pNetwork.subscribe('new_transaction', this.handleNewTransaction.bind(this));
        this.p2pNetwork.subscribe('new_block_proposal', this.handleNewBlockFromValidator.bind(this));
        this.p2pNetwork.subscribe('new_block_pow', this.handleNewBlockFromMiners.bind(this));
    }
    async handleNewTransaction(message) {
        try {
            await this.addTransactionJSONToMemPool(message.transaction);
            console.log(`Node ${this.id} received new transaction`);
        } catch (error) {
            console.error(`Node ${this.id} failed to process new transaction:`, error);
        }
    }
    async handleNewBlockFromValidator(message) {
        try {
            if (this.role === 'miner') {
                this.miner.pushCandidate(message.blockProposal);
            } 
            console.log(`Node ${this.id} received new block proposal`);
        } catch (error) {
            console.error(`Node ${this.id} failed to process new block proposal:`, error);
        }
    }
    async handleNewBlockFromMiners(message) {
        if (this.role === 'validator') {
            try {
                await this.#processPowBlock(message.blockPow);
            } catch (error) {
                console.error(`Error processing PoW block:`, error);
            } 
        }
    }



    /** @param {BlockData} minerBlockCandidate */
    submitPowProposal(minerBlockCandidate) {
        this.callStack.push(() => this.#processPowBlock(minerBlockCandidate));
    }
    /** @param {BlockData} minerBlockCandidate */
    async #validateBlockProposal(blockData) {
        try {
            // verify the hash
            const { hex, bitsArrayAsString } = await Block.getMinerHash(blockData, this.useDevArgon2);
            if (blockData.hash !== hex) { throw new Error('Invalid hash'); }
            const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, blockData);
    
            // control coinBase Amount
            const coinBaseAmount = blockData.Txs[0].outputs[0].amount;
            const expectedCoinBase = Block.calculateNextCoinbaseReward(blockData);
            if (coinBaseAmount !== expectedCoinBase) { throw new Error(`Invalid coinbase amount: ${coinBaseAmount} - expected: ${expectedCoinBase}`); }
    
            // double spend control
            Validation.isFinalizedBlockDoubleSpending(this.utxoCache.UTXOsByPath, blockData);
    
            // verify the transactions
            for (let i = 0; i < blockData.Txs.length; i++) {
                const tx = blockData.Txs[i];
                const isCoinBase = Transaction_Builder.isCoinBaseOrFeeTransaction(tx, i);
                const txValidation = await Validation.fullTransactionValidation(this.utxoCache.UTXOsByPath, tx, isCoinBase, this.useDevArgon2);
                if (!txValidation.success) {
                    const error = txValidation;
                    throw new Error(`Invalid transaction: ${tx.id} - ${error}`); }
            }
            this.lastBlockData = blockData;
            return hashConfInfo;
        } catch (error) {
            return false;
        }
    }

    /** 
     * should be used with the callstack
     * @param {BlockData} minerBlockCandidate
     */
    async #processPowBlock(minerBlockCandidate) {
        console.log(`[NODE] Processing PoW block: ${minerBlockCandidate.index} | ${minerBlockCandidate.hash}`);
        const startTime = Date.now();
        // verify the height
        if (!minerBlockCandidate) { throw new Error('Invalid block candidate'); }
        let index = -1;

        if (this.lastBlockData) { index = this.lastBlockData.index; }
        //const blockIsTooOld = index === 0 || this.lastBlockData === null ? false : minerBlockCandidate.index <= index;
        //const blockIsAhead = index === 0 && this.lastBlockData === null ? false : minerBlockCandidate.index > index + 1;
        const blockIsTooOld = minerBlockCandidate.index <= index;
        const blockIsAhead = minerBlockCandidate.index > index + 1;

        if (blockIsTooOld) { console.log(`Rejected block proposal, older index: ${minerBlockCandidate.index} < ${this.blockCandidate.index}`); return false; }
        if (blockIsAhead) { throw new Error(`minerBlock's index is higher than the current block candidate: ${minerBlockCandidate.index} > ${this.blockCandidate.index} -> NEED TO SYNC`); }

        const hashConfInfo = await this.#validateBlockProposal(minerBlockCandidate);
        if (!hashConfInfo) { return false; }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification

        let newStakesOutputs;
        try {
            console.log(`[NODE] Block Proposal accepted: blockIndex: ${minerBlockCandidate.index} | legitimacy: ${minerBlockCandidate.legitimacy}`);
            newStakesOutputs = await this.utxoCache.digestConfirmedBlocks([blockDataCloneToDigest]);
        } catch (error) {
            console.warn(`[NODE] Block Proposal rejected: blockIndex: ${minerBlockCandidate.index} | legitimacy: ${minerBlockCandidate.legitimacy} | ${error.message}
----------------------
-> Rollback UTXO cache
----------------------`);
            this.utxoCache.rollbackUtxoCacheSnapshot(this.utxoCacheSnapshots.pop());
            return false;
        }
        if (newStakesOutputs.length > 0) { this.vss.newStakes(newStakesOutputs); }   

        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.UTXOsByPath);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);

        this.#digestBlock(minerBlockCandidate); // will store the block in ram, and save older blocks if ahead enough
        this.utxoCacheSnapshots.push(this.utxoCache.getUtxoCacheSnapshot());
        if (this.utxoCacheSnapshots.length > this.considerDefinitiveAfter) { this.utxoCacheSnapshots.shift(); }

        // simple log for debug ----------------------
        //const powMinerTx = minerBlockCandidate.Txs[0];
        //const address = powMinerTx.outputs[0].address;
        //const { balance, UTXOs } = this.utxoCache.getBalanceAndUTXOs(address);
        //console.log(`[NODE] Height: ${minerBlockCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);

        const timeBetweenPosPow = ((minerBlockCandidate.timestamp - minerBlockCandidate.posTimestamp) / 1000).toFixed(2);
        console.log(`[NODE] H:${minerBlockCandidate.index} -> diff: ${hashConfInfo.difficulty} + timeDiffAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} = finalDiff: ${hashConfInfo.finalDifficulty} | zeros: ${hashConfInfo.zeros} | adjust: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | proposalTreat: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

        this.callStack.push(async () => {
            await this.vss.calculateRoundLegitimacies(minerBlockCandidate.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.account.address}, can't create a candidate`); }

            const newBlockCandidate = await this.createBlockCandidate();
            this.blockCandidate = newBlockCandidate;
            //console.log(`[NODE] New block candidate created: ${newBlockCandidate.index} | ${newBlockCandidate.hash}`);
            this.broadcastBlockProposal(newBlockCandidate);
        }, true);
        
        return true;
    }

    /** @param {BlockData} minerBlockCandidate */
    #digestBlock(minerBlockCandidate) {
        const blockDataCloneToStore = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        this.confirmedBlocks.push(blockDataCloneToStore); // store the block in ram
        
        if (this.confirmedBlocks.length <= this.considerDefinitiveAfter) { return; }

        // save the block in local storage definitively
        const blockToDefinitivelySave = this.confirmedBlocks.shift();
        if (this.blockCandidate.index <= 200) { localStorage_v1.saveBlockDataLocally(this.id, blockToDefinitivelySave, 'json'); }
        const saveResult = localStorage_v1.saveBlockDataLocally(this.id, blockToDefinitivelySave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }
    }

    /** 
     * @param {string} signedTxJSON
     * @param {false | string} replaceExistingTxID
     */
    async addTransactionJSONToMemPool(signedTxJSON, replaceExistingTxID = false) {
        if (typeof signedTxJSON !== 'string') { throw new Error('Invalid transaction'); }

        const signedTransaction = Transaction_Builder.transactionFromJSON(signedTxJSON);
        //await this.memPool.pushTransaction(this.utxoCache.UTXOsByPath, signedTransaction, replaceExistingTxID);
        this.memPool.submitTransaction(this.callStack, this.utxoCache.UTXOsByPath, signedTransaction, replaceExistingTxID);
    }

    /**
     * @param {BlockData | undefined} lastBlockData
     * @param {number} myLegitimacy
     */
    async createBlockCandidate() {
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();
        
        const myLegitimacy = this.vss.getAddressLegitimacy(this.account.address);
        let index = 0;
        if (this.lastBlockData) { index = this.lastBlockData.index; }
        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, myLegitimacy, 'ContrastGenesisBlock', Txs, Date.now());
        if (this.lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.utxoCache.blockMiningData);
            const clone = Block.cloneBlockData(this.lastBlockData);
            const supply = clone.supply + clone.coinBase;
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(index + 1, supply, coinBaseReward, newDifficulty, myLegitimacy, clone.hash, Txs, Date.now());
        }

        // Add the PoS reward transaction
        const posRewardAddress = this.account.address;
        const posStakedAddress = this.account.address;
        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, posRewardAddress, posStakedAddress);
        const signedPosFeeTx = await this.account.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        if (blockCandidate.Txs.length > 3) {
            console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        }
        this.blockCandidate = blockCandidate;
        return blockCandidate;
    }
    /** @param {Transaction} */
    async broadcastTransaction(transaction) {
        console.log(`[NODE] Broadcasting transaction: ${transaction.id}`);
        await this.p2pNetwork.broadcast('new_transaction', { transaction });
    }

    async broadcastBlockProposal(blockProposal) {
        await this.p2pNetwork.broadcast('new_block_proposal', { blockProposal });
    }

    async broadcastBlockPow(blockPow) {
        console.log(`[NODE] Broadcasting block PoW: ${blockPow.index} | ${blockPow.hash}`);
        await this.p2pNetwork.broadcast('new_block_pow', { blockPow });
    }

    validPowCallback(validBlockCandidate) {
        this.broadcastBlockPow(validBlockCandidate);
    }

    getNodeStatus() {
        return {
            id: this.id,
            role: this.role,
            currentBlockHeight: this.blockCandidate ? this.blockCandidate.index : 0,
            memPoolSize: Object.keys(this.memPool.transactionsByID).length,
            peerCount: this.p2pNetwork.getConnectedPeers().length,
        };
    }
}