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
*/

export class Node {
    /** @param {Account} validatorAccount */
    constructor(validatorAccount, p2pOptions = {}) {
        /** @type {string} */
        this.id = validatorAccount.address;
        /** @type {CallStack} */
        this.callStack = CallStack.buildNewStack(['Conflicting UTXOs', 'Invalid block index:', 'UTXOs(one at least) are spent']);

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

        this.p2pNetwork = new P2PNetwork({
            role: 'validator',
            ...p2pOptions
        });
   
        this.devmode = false;
    }

    /** @param {Account} validatorAccount */
    static async load(validatorAccount, p2pOptions = {}, saveBlocksInfo = false) {
        const node = new Node(validatorAccount, p2pOptions);

        const lastBlockData = await localStorage_v1.loadBlockchainLocally(node, saveBlocksInfo);
        
        // TODO: mempool digest mempool from other validator node
        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        if (lastBlockData) { await node.vss.calculateRoundLegitimacies(lastBlockData.hash); }
        const myLegitimacy = node.vss.getAddressLegitimacy(node.validatorAccount.address);
        node.blockCandidate = await node.#createBlockCandidate(lastBlockData, myLegitimacy);

        return node;
    }

    async start() {
        await this.p2pNetwork.start();
        this.setupEventListeners();
        console.log(`Node ${this.id} started`);
    }

    async stop() {
        await this.p2pNetwork.stop();
        console.log(`Node ${this.id} stopped`);
    }

    setupEventListeners() {
        this.p2pNetwork.on('peer:connect', (peerId) => {
            console.log(`Node ${this.id} connected to peer ${peerId}`);
        });

        this.p2pNetwork.on('peer:disconnect', (peerId) => {
            console.log(`Node ${this.id} disconnected from peer ${peerId}`);
        });

        this.p2pNetwork.subscribe('new_transaction', async (message) => {
            try {
                await this.addTransactionJSONToMemPool(message.transaction);
                console.log(`Node ${this.id} received new transaction`);
            } catch (error) {
                console.error(`Node ${this.id} failed to process new transaction:`, error);
            }
        });

        this.p2pNetwork.subscribe('new_block_proposal', async (message) => {
            try {
                await this.submitPowProposal(message.blockProposal);
                console.log(`Node ${this.id} received new block proposal`);
            } catch (error) {
                console.error(`Node ${this.id} failed to process new block proposal:`, error);
            }
        });
    }

    /** @param {BlockData} minerBlockCandidate */
    submitPowProposal(minerBlockCandidate) {
        this.callStack.push(() => this.#blockProposal(minerBlockCandidate));
    }

    /** @param {BlockData} blockData */
    async #validateBlockProposal(blockData) {
        try {
            // verify the height
            if (!blockData) { throw new Error('Invalid block candidate'); }
            if (blockData.index !== this.blockCandidate.index) { throw new Error(`Invalid block index: ${blockData.index} - current candidate: ${this.blockCandidate.index}`); }
    
            // verify the hash
            const { hex, bitsArrayAsString } = await Block.getMinerHash(blockData, this.devmode);
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
                const txValidation = await Validation.fullTransactionValidation(this.utxoCache.UTXOsByPath, tx, isCoinBase, this.devmode);
                if (!txValidation.success) {
                    const error = txValidation;
                    throw new Error(`Invalid transaction: ${tx.id} - ${error}`); }
            }
    
            return hashConfInfo;
        } catch (error) {
            console.warn(`[NODE] Block Proposal rejected: blockIndex: ${blockData.index} | legitimacy: ${blockData.legitimacy} | ${error.message}`);
            return false;
        }
    }
    /** 
     * should be used with the callstack
     * @param {BlockData} minerBlockCandidate
     */
    async #blockProposal(minerBlockCandidate) { // TODO: WILL NEED TO USE BRANCHES
        const startTime = Date.now();
        const hashConfInfo = await this.#validateBlockProposal(minerBlockCandidate);
        if (!hashConfInfo) { return false; }

        const blockDataCloneToSave = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        if (this.blockCandidate.index <= 200) { localStorage_v1.saveBlockDataLocally(this.id, blockDataCloneToSave, 'json'); }
        const saveResult = localStorage_v1.saveBlockDataLocally(this.id, blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        
        const newStakesOutputs = await this.utxoCache.digestConfirmedBlocks([blockDataCloneToDigest]);
        if (newStakesOutputs.length > 0) { this.vss.newStakes(newStakesOutputs); }

        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.utxoCache.UTXOsByPath);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.utxoCache.getBalanceAndUTXOs(address);
        //console.log(`[NODE] Height: ${minerBlockCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        const timeBetweenPosPow = ((minerBlockCandidate.timestamp - minerBlockCandidate.posTimestamp) / 1000).toFixed(2);
        console.log(`[NODE] H:${minerBlockCandidate.index} -> diff: ${hashConfInfo.difficulty} + timeDiffAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} = finalDiff: ${hashConfInfo.finalDifficulty} | zeros: ${hashConfInfo.zeros} | adjust: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s | proposalTreat: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        //console.log(`[NODE] H:${minerBlockCandidate.index} -> diff: ${hashConfInfo.difficulty} + timeDiffAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} = finalDiff: ${hashConfInfo.finalDifficulty} | zeros: ${hashConfInfo.zeros} | adjust: ${hashConfInfo.adjust} | timeBetweenPosPow: ${timeBetweenPosPow}s`);
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

        const signedTransaction = Transaction_Builder.transactionFromJSON(signedTxJSON);
        this.memPool.submitTransaction(this.callStack, this.utxoCache.UTXOsByPath, signedTransaction, replaceExistingTxID);

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
        const startTime = Date.now();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch();

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

        if (blockCandidate.Txs.length > 3) {
            //console.info(`(Height:${blockCandidate.index}) => ${blockCandidate.Txs.length} txs, block candidate created in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
        }
        return blockCandidate;
    }

    async broadcastTransaction(transaction) {
        await this.p2pNetwork.broadcast('new_transaction', { transaction });
    }

    async broadcastBlockProposal(blockProposal) {
        await this.p2pNetwork.broadcast('new_block_proposal', { blockProposal });
    }
}