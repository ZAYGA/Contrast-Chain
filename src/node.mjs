import localStorage_v1 from '../storage/local-storage-management.mjs';
import { Validation } from './validation.mjs';
import { CallStack } from './callstack.mjs';
import { Vss } from './vss.mjs';
import { MemPool } from './memPool.mjs';
import { UtxoCache } from './utxoCache.mjs';
import { BlockData, Block } from './block.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Miner } from './miner.mjs';
import utils from './utils.mjs';

/**
* @typedef {import("./account.mjs").Account} Account
*/

export class Node {
    /** @param {Account} validatorAccount */
    constructor(validatorAccount) {
        /** @type {string} */
        this.id = validatorAccount.address;
        /** @type {CallStack} */
        this.callStack = CallStack.buildNewStack(['Conflicting UTXOs', 'Invalid block index:']);

        /** @type {Account} */
        this.validatorAccount = validatorAccount;
        /** @type {BlockData} */
        this.blockCandidate = null;

        /** @type {Vss} */
        this.vss = new Vss();
        /** @type {MemPool} */
        this.memPool = new MemPool();
        /** @type {UtxoCache} */
        this.utxoCache = new UtxoCache();
        /** @type {Miner} */
        this.miner = new Miner(validatorAccount);
    }

    /** @param {Account} validatorAccount */
    static async load(validatorAccount, saveBlocksInfo = false) {
        const node = new Node(validatorAccount);

        const lastBlockData = await localStorage_v1.loadBlockchainLocally(node, saveBlocksInfo);
        
        // TODO: mempool digest mempool from other validator node
        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        if (lastBlockData) { await node.vss.calculateRoundLegitimacies(lastBlockData.hash); }
        const myLegitimacy = node.vss.getAddressLegitimacy(node.validatorAccount.address);
        node.blockCandidate = await node.#createBlockCandidate(lastBlockData, myLegitimacy);

        return node;
    }
    /** @param {BlockData} minerBlockCandidate */
    submitPowProposal(minerBlockCandidate) {
        this.callStack.push(() => this.#blockProposal(minerBlockCandidate));
    }
    /** 
     * should be used with the callstack
     * @param {BlockData} minerBlockCandidate
     */
    async #blockProposal(minerBlockCandidate) { // TODO: WILL NEED TO USE BRANCHES
        if (!minerBlockCandidate) { throw new Error('Invalid block candidate'); }
        if (minerBlockCandidate.index !== this.blockCandidate.index) { throw new Error(`Invalid block index: ${minerBlockCandidate.index} - current candidate: ${this.blockCandidate.index}`); }
        
        //TODO : VALIDATE THE BLOCK
        // TODO verify if coinBase Tx release the correct amount of coins
        const { hex, bitsArrayAsString } = await Block.getMinerHash(minerBlockCandidate);
        const hashConfInfo = utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, minerBlockCandidate);

        if (minerBlockCandidate.hash !== hex) { throw new Error('Invalid hash'); }
        
        const blockDataCloneToSave = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        if (this.blockCandidate.index <= 100) { localStorage_v1.saveBlockDataLocally(this.id, blockDataCloneToSave, 'json'); }
        const saveResult = localStorage_v1.saveBlockDataLocally(this.id, blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        
        const newStakesOutputs = await this.utxoCache.digestConfirmedBlock(blockDataCloneToDigest);
        if (newStakesOutputs.length > 0) { this.vss.newStakes(newStakesOutputs); }

        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.UTXOsByPath);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.utxoCache.getBalanceAndUTXOs(address);
        //console.log(`[Node] Height: ${minerBlockCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        console.log(`[Node] H:${minerBlockCandidate.index} -> diff: ${hashConfInfo.difficulty} + timeDiffAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} = finalDiff: ${hashConfInfo.finalDifficulty} | zeros: ${hashConfInfo.zeros} | adjust: ${hashConfInfo.adjust}`);
        // -------------------------------------------

        this.callStack.push(async () => {
            await this.vss.calculateRoundLegitimacies(minerBlockCandidate.hash);
            const myLegitimacy = this.vss.getAddressLegitimacy(this.validatorAccount.address);
            if (myLegitimacy === undefined) { throw new Error(`No legitimacy for ${this.validatorAccount.address}, can't create a candidate`); }

            const newBlockCandidate = await this.#createBlockCandidate(minerBlockCandidate, myLegitimacy);
            this.blockCandidate = newBlockCandidate; // Can be sent to the network
        }, true);

        return true;
    }
    /** 
     * @param {string} signedTxJSON
     * @param {false | string} replaceExistingTxID
     */
    async addTransactionJSONToMemPool(signedTxJSON, replaceExistingTxID = false) {
        if (typeof signedTxJSON !== 'string') { throw new Error('Invalid transaction'); }

        const signedTansaction = Transaction_Builder.transactionFromJSON(signedTxJSON);
        this.memPool.submitTransaction(this.callStack, this.utxoCache.UTXOsByPath, signedTansaction, replaceExistingTxID);

        // not working with the callstack //TODO: fix
        //this.callStack.push(() => { this.memPool.pushTransaction(this.utxoCache.UTXOsByPath, signedTansaction, replaceExistingTxID) });
    }

    // TODO: Fork management
    // Private methods
    /**
     * @param {BlockData | undefined} lastBlockData
     * @param {number} myLegitimacy
     */
    async #createBlockCandidate(lastBlockData, myLegitimacy) {
        //console.log(`[Node] Creating block candidate from lastHeight: ${lastBlockData.index}`);
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();
        if (Txs.length > 1) {
            console.log(`[Height:${lastBlockData.index}] ${Txs.length} transactions in the block candidate`);
        }

        // Create the block candidate, genesis block if no lastBlockData
        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, myLegitimacy, 'ContrastGenesisBlock', Txs, Date.now());
        if (lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.utxoCache.blockMiningData);
            const clone = Block.cloneBlockData(lastBlockData);
            const supply = clone.supply + clone.coinBase;
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(clone.index + 1, supply, coinBaseReward, newDifficulty, myLegitimacy, clone.hash, Txs, Date.now());
        }

        // Add the PoS reward transaction
        const posRewardAddress = this.validatorAccount.address;
        const posStakedAddress = this.validatorAccount.address;
        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, posRewardAddress, posStakedAddress);
        const signedPosFeeTx = await this.validatorAccount.signTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        return blockCandidate;
    }
}