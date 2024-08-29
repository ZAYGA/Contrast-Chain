import localStorage_v1 from '../storage/local-storage-management.mjs';
import { Vss } from './vss.mjs';
import { Validation } from './validation.mjs';
import { Transaction, TransactionIO, Transaction_Builder, TxIO_Builder } from './transaction.mjs';
import { BlockMiningData, BlockData, Block } from './block.mjs';
import { CallStack } from './callstack.mjs';
import utils from './utils.mjs';

/**
* @typedef {import("../src/account.mjs").Account} Account
*/

/** Used by MemPool
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 */
class MemPool { // Store transactions that are not yet included in a block
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {Object<string, Transaction>} */
        this.transactionByPath = {};
    }

    /** @param {Transaction} transaction */
    #addMempoolTransaction(transaction) {
        // sorted by feePerByte
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);

        // sorted by utxoPath
        for (let i = 0; i < transaction.inputs.length; i++) {
            const utxoPath = transaction.inputs[i].utxoPath;
            this.transactionByPath[utxoPath] = transaction;
        }

        // sorted by transaction ID
        this.transactionsByID[transaction.id] = transaction;

        //console.log(`[MEMPOOL] transaction: ${transaction.id} added`);
    }
    /** @param {Transaction} transaction */
    #removeMempoolTransaction(transaction) {
        // remove from: sorted by feePerByte
        const txFeePerByte = transaction.feePerByte;
        if (!this.transactionsByFeePerByte[txFeePerByte]) { throw new Error('Transaction not found in mempool'); }

        const txIndex = this.transactionsByFeePerByte[txFeePerByte].findIndex(tx => tx.id === transaction.id);
        if (txIndex === -1) { throw new Error('Transaction not found in mempool'); }

        this.transactionsByFeePerByte[txFeePerByte].splice(txIndex, 1);
        if (this.transactionsByFeePerByte[txFeePerByte].length === 0) { delete this.transactionsByFeePerByte[txFeePerByte]; }

        // remove from: sorted by utxoPath
        const collidingTx = this.#caughtTransactionsUTXOCollision(transaction);
        for (let i = 0; i < collidingTx.inputs.length; i++) {
            const utxoPath = collidingTx.inputs[i].utxoPath;
            if (!this.transactionByPath[utxoPath]) { throw new Error(`Transaction not found in mempool: ${utxoPath}`); }
            delete this.transactionByPath[utxoPath];
        }

        // remove from: sorted by transaction ID
        delete this.transactionsByID[transaction.id];

        //console.log(`[MEMPOOL] transaction: ${transaction.id} removed`);
    }
    /** 
     * - Remove transactions that are using UTXOs that are already spent
     * @param {Object<string, TransactionIO>} UTXOsByPath - from hotData
     */
    clearTransactionsWhoUTXOsAreSpent(UTXOsByPath) {
        const knownUtxoPaths = Object.keys(this.transactionByPath);
        
        for (let i = 0; i < knownUtxoPaths.length; i++) {
            const utxoPath = knownUtxoPaths[i];
            if (!this.transactionByPath[utxoPath]) { continue; } // already removed
            if (UTXOsByPath[utxoPath]) { continue; } // not spent

            const transaction = this.transactionByPath[utxoPath];
            this.#removeMempoolTransaction(transaction);
        }
    }
    // -------------------------------------

    getMostLucrativeTransactionsBatch() {
        const maxTotalBytes = utils.blockchainSettings.maxBlockSize;
        const totalBytesTrigger = maxTotalBytes * 0.98;
        const transactions = [];
        let totalBytes = 0;

        const feePerBytes = Object.keys(this.transactionsByFeePerByte).sort((a, b) => b - a);
        for (let i = 0; i < feePerBytes.length; i++) {
            const feePerByte = feePerBytes[i];
            const txs = this.transactionsByFeePerByte[feePerByte];
            for (let j = 0; j < txs.length; j++) {
                const tx = txs[j];
                const txWeight = tx.byteWeight;
                if (totalBytes + txWeight > maxTotalBytes) { continue; }

                const clone = Transaction_Builder.cloneTransaction(tx);
                delete clone.feePerByte;
                delete clone.byteWeight;

                transactions.push(clone);
                totalBytes += txWeight;
            }

            if (totalBytes > totalBytesTrigger) { break; }
        }

        return transactions;
    }
    /**
     * - Remove the transactions included in the block from the mempool
     * @param {Transaction[]} Txs
     */
    digestBlockTransactions(Txs) {
        if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }

        // remove the transactions included in the block that collide with the mempool
        for (let i = 0; i < Txs.length; i++) {
            if (Transaction_Builder.isCoinBaseOrFeeTransaction(Txs[i], i)) { continue; }

            const confirmedTx = Txs[i];
            const collidingTx = this.#caughtTransactionsUTXOCollision(confirmedTx);
            if (!collidingTx) { continue; }
            
            if (confirmedTx.id === collidingTx.id) {
                console.log(`[MEMPOOL] transaction: ${confirmedTx.id} confirmed!`); }
            this.#removeMempoolTransaction(collidingTx);
        }
    }
    /** @param {Transaction} transaction */
    #caughtTransactionsUTXOCollision(transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            const utxoPath = transaction.inputs[i].utxoPath;
            if (utxoPath === undefined) { throw new Error('Invalid UTXO'); }
            if (!this.transactionByPath[utxoPath]) { continue; }

            return this.transactionByPath[utxoPath];
        }

        return false;
    }
    /** 
     * @param {Object<string, TransactionIO>} UTXOsByPath - from hotData
     * @param {Transaction} transaction
     */
    #transactionUTXOsAreNotSpent(UTXOsByPath, transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            if (!utils.utxoPath.isValidUtxoPath(transaction.inputs[i].utxoPath)) { throw new Error('Invalid UTXO'); }
            if (!UTXOsByPath[transaction.inputs[i].utxoPath]) { return false; }
        }

        return true;
    }
    /**
     * @param {Object<string, TransactionIO>} UTXOsByPath - from hotData
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    submitTransaction(callStack, UTXOsByPath, transaction, replaceExistingTxID) { // DEPRECATED
        callStack.push(() => this.pushTransaction(UTXOsByPath, transaction, replaceExistingTxID));
    }
    /**
     * @param {Object<string, TransactionIO>} UTXOsByPath - from hotData
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async pushTransaction(UTXOsByPath, transaction, replaceExistingTxID) {
        const startTime = Date.now();
        const isCoinBase = false;

        // First control format of : amount, address, rule, version, TxID
        Validation.isConformTransaction(transaction, isCoinBase);

        // Second control : input > output
        const fee = Validation.calculateRemainingAmount(transaction, isCoinBase);

        // Calculate fee per byte
        const TxWeight = Transaction_Builder.getWeightOfTransaction(transaction);
        //console.log(`[MEMPOOL] weight: ${TxWeight} bytes`);

        const feePerByte = fee / TxWeight;
        transaction.byteWeight = TxWeight;
        transaction.feePerByte = feePerByte.toFixed(6);

        // Manage the mempool inclusion and collision
        let txInclusionFunction = () => {
            this.#addMempoolTransaction(transaction);
        };

        const identicalIDTransaction = this.transactionsByID[transaction.id];
        const collidingTx = identicalIDTransaction ? identicalIDTransaction : this.#caughtTransactionsUTXOCollision(transaction);
        if (collidingTx) {
            //TODO: active in production
            if (!replaceExistingTxID) { throw new Error(`Conflicting UTXOs with: ${collidingTx.id}`); }
            if (replaceExistingTxID !== collidingTx.id) { throw new Error('Invalid replaceExistingTxID'); }
            if (transaction.feePerByte <= collidingTx.feePerByte) { throw new Error('New transaction fee is not higher than the existing one'); }

            txInclusionFunction = () => {
                this.#removeMempoolTransaction(collidingTx);
                this.#addMempoolTransaction(transaction);
            };
        }

        if (!this.#transactionUTXOsAreNotSpent(UTXOsByPath, transaction)) {
            throw new Error('UTXOs(one at least) are spent'); }

        // Third validation: medium computation cost.
        await Validation.controlTransactionHash(transaction);

        // Fourth validation: low computation cost.
        await Validation.controlTransactionOutputsRulesConditions(transaction);

        // Fifth validation: medium computation cost.
        await Validation.controlAllWitnessesSignatures(transaction);

        // Sixth validation: high computation cost.
        await Validation.addressOwnershipConfirmation(UTXOsByPath, transaction);

        txInclusionFunction();
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
    }
}

export class HotData { // Used to store, addresses's UTXOs and balance.
    constructor() {
        /** @type {Object<string, TransactionIO[]>} */
        this.addressesUTXOs = {};
        /** @type {Object<string, number>} */
        this.addressesBalances = {};
        /** @type {Object<string, TransactionIO>} */
        this.UTXOsByPath = {};

        /** @type {BlockMiningData[]} */
        this.blockMiningData = [];
        /** @type {Vss} */
        this.vss = new Vss();

        /** @type {Object<string, object>} */
        this.branches = {};
    }

    #calculateTotalOfBalances() {
        const addresses = Object.keys(this.addressesBalances);
        return addresses.reduce((a, b) => a + this.addressesBalances[b], 0);
    }
    /**
     * Will add or remove the amount from the address balance
     * @param {string} address 
     * @param {number} amount 
     */
    #changeBalance(address, amount) {
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }
        if (amount === 0) { return; }
        if (this.addressesBalances[address] === undefined) { this.addressesBalances[address] = 0; }

        this.addressesBalances[address] += amount;
        // console.log(`Balance of ${address} changed by ${amount} => ${this.addressesBalances[address]}`);
    }
    /**
     * @param {Transaction} transaction 
     * @param {number} TxIndexInTheBlock
     */
    #digestTransactionInputs(transaction, TxIndexInTheBlock) {
        if ( Transaction_Builder.isCoinBaseOrFeeTransaction(transaction, TxIndexInTheBlock) ) { return } // coinbase -> no input

        const TxInputs = transaction.inputs;
        TxIO_Builder.checkMalformedUtxoPaths(TxInputs);
        TxIO_Builder.checkDuplicateUtxoPaths(TxInputs);

        for (let i = 0; i < TxInputs.length; i++) {
            const utxoPath = TxInputs[i].utxoPath;
            const { address, amount } = this.UTXOsByPath[utxoPath];

            this.#removeUTXO(address, utxoPath);
            this.#changeBalance(address, -amount);
        }

        return true;
    }
    /**
     * @param {string} address
     * @param {string} utxoPath
     */
    #removeUTXO(address, utxoPath) {
        // remove from addressesUTXOs
        if (this.addressesUTXOs[address] === undefined) { throw new Error(`${address} has no UTXOs`); }

        const addressUtxoIndex = this.addressesUTXOs[address].findIndex(utxoInArray => utxoInArray.utxoPath === utxoPath);
        if (addressUtxoIndex === -1) { throw new Error(`${address} isn't owning UTXO: ${utxoPath}`); }

        this.addressesUTXOs[address].splice(addressUtxoIndex, 1);
        if (this.addressesUTXOs[address].length === 0) { delete this.addressesUTXOs[address]; }

        // remove from UTXOsByPath
        delete this.UTXOsByPath[utxoPath];
        // console.log(`[HotData]=> UTXO removed: ${utxoBlockHeight} - ${utxoTxID} - ${vout} | owner: ${address}`);
    }
    /**
     * @param {number} blockIndex
     * @param {Transaction} transaction
     */
    #digestTransactionOutputs(blockIndex, transaction) {
        const TxID = transaction.id;
        const TxOutputs = transaction.outputs;
        for (let i = 0; i < TxOutputs.length; i++) {
            const { address, amount } = TxOutputs[i];
            if (amount === 0) { continue; } // no need to add UTXO with 0 amount

            // UXTO would be used as input, then we set blockIndex, utxoTxID, and vout
            const utxoPath = utils.utxoPath.from_TransactionInputReferences(blockIndex, TxID, i);
            if (!utils.utxoPath.isValidUtxoPath(utxoPath)) { throw new Error(`Invalid UTXO utxoPath: ${utxoPath}`); }
            
            // output become ouput -> set UTXO's utxoPath
            TxOutputs[i].utxoPath = utxoPath;

            if (this.addressesUTXOs[address] === undefined) { this.addressesUTXOs[address] = []; }
            this.addressesUTXOs[address].push(TxOutputs[i]);
            this.UTXOsByPath[utxoPath] = TxOutputs[i];
            this.#changeBalance(address, amount);

            const rule = TxOutputs[i].rule;
            if (rule === "sigOrSlash") {
                this.vss.newStake(TxOutputs[i]); // for now we only create new range
            }
        }
    }

    // Public methods
    /** @param {string} address */
    getBalanceAndUTXOs(address) {
        // clone values to avoid modification
        /** @type {number} */
        const balance = this.addressesBalances[address] ? JSON.parse(JSON.stringify(this.addressesBalances[address])) : 0;
        const UTXOs = [];
        if (this.addressesUTXOs[address]) {
            for (let i = 0; i < this.addressesUTXOs[address].length; i++) {
                const clone = TxIO_Builder.cloneTxIO(this.addressesUTXOs[address][i]);
                delete clone.address;
                UTXOs.push(clone);
            }
        }
        return { balance, UTXOs };
    }
    /** @param {string} address */
    getBalanceSpendableAndUTXOs(address) {
        // clone values to avoid modification
        const { balance, UTXOs } = this.getBalanceAndUTXOs(address);
        let spendableBalance = balance;

        for (let i = 0; i < UTXOs.length; i++) {
            const rule =  UTXOs[i].rule;
            if (rule === "sigOrSlash") {
                spendableBalance -= UTXOs[i].amount;
                UTXOs.splice(i, 1);
                i--;
            }
        }

        return { spendableBalance, balance, UTXOs };
    }
    /**
    * @param {number} blockIndex
    * @param {Transaction[]} Txs
    */
    digestBlockTransactions(blockIndex, Txs) {
        if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }
        //console.log(`Digesting block ${blockIndex} with ${Txs.length} transactions`);

        for (let i = 0; i < Txs.length; i++) {
            const transaction = Txs[i];
            this.#digestTransactionInputs(transaction, i); // Reverse function's call ?
            this.#digestTransactionOutputs(blockIndex, transaction);
        }
    }
    /** @param {BlockData[]} chainPart */
    async digestChainPart(chainPart) {
        for (let i = 0; i < chainPart.length; i++) {
            const blockData = chainPart[i];
            await this.digestConfirmedBlock(blockData);
        }
    }
    /** @param {BlockData} blockData */
    async digestConfirmedBlock(blockData) {
        const Txs = blockData.Txs;
        this.digestBlockTransactions(blockData.index, Txs);

        const supplyFromBlock = blockData.supply;
        const coinBase = blockData.coinBase;
        const totalSupply = supplyFromBlock + coinBase;
        const totalOfBalances = this.#calculateTotalOfBalances();

        const currencySupply = utils.convert.number.formatNumberAsCurrency(totalSupply);
        const currencyBalances = utils.convert.number.formatNumberAsCurrency(totalOfBalances);

        if (totalOfBalances !== totalSupply) {
            console.info(`supplyFromBlock+coinBase: ${currencySupply} - totalOfBalances: ${currencyBalances}`);
            throw new Error('Invalid total of balances'); 
        }

        this.blockMiningData.push({ index: blockData.index, difficulty: blockData.difficulty, timestamp: blockData.timestamp });
    }

    digestBlockProposal(blockData) {}
}

export class FullNode {
    /** @param {Account} validatorAccount */
    constructor(validatorAccount) {
        this.callStack = CallStack.buildNewStack(['Conflicting UTXOs', 'Invalid block index:']);

        /** @type {Account} */
        this.validatorAccount = validatorAccount;
        /** @type {BlockData} */
        this.blockCandidate = null;

        this.memPool = new MemPool();
        this.hotData = new HotData();
    }

    /** @param {Account} validatorAccount */
    static async load(validatorAccount, saveBlocksInfo = false) {
        const node = new FullNode(validatorAccount);

        const lastBlockData = await localStorage_v1.loadBlockchainLocally(node, saveBlocksInfo);
        
        // TODO: mempool digest mempool from other validator node
        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        if (lastBlockData) { await node.hotData.vss.calculateRoundLegitimacies(lastBlockData.hash); }
        const myLegitimacy = node.hotData.vss.getAddressLegitimacy(node.validatorAccount.address);
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
        if (this.blockCandidate.index < 2000) { localStorage_v1.saveBlockDataLocally(blockDataCloneToSave, 'json'); }
        const saveResult = localStorage_v1.saveBlockDataLocally(blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        
        await this.hotData.digestConfirmedBlock(blockDataCloneToDigest);
        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.hotData.UTXOsByPath);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.hotData.getBalanceAndUTXOs(address);
        //console.log(`[FullNode] Height: ${minerBlockCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        console.log(`[FullNode] H:${minerBlockCandidate.index} -> diff: ${hashConfInfo.difficulty} + timeDiffAdj: ${hashConfInfo.timeDiffAdjustment} + leg: ${hashConfInfo.legitimacy} = finalDiff: ${hashConfInfo.finalDifficulty} | zeros: ${hashConfInfo.zeros} | adjust: ${hashConfInfo.adjust}`);
        // -------------------------------------------

        this.callStack.push(async () => {
            await this.hotData.vss.calculateRoundLegitimacies(minerBlockCandidate.hash);
            const myLegitimacy = this.hotData.vss.getAddressLegitimacy(this.validatorAccount.address);
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
        this.memPool.submitTransaction(this.callStack, this.hotData.UTXOsByPath, signedTansaction, replaceExistingTxID);

        // not working with the callstack //TODO: fix
        //this.callStack.push(() => { this.memPool.pushTransaction(this.hotData.UTXOsByPath, signedTansaction, replaceExistingTxID) });
    }

    // TODO: Fork management
    // Private methods
    /**
     * @param {BlockData | undefined} lastBlockData
     * @param {number} myLegitimacy
     */
    async #createBlockCandidate(lastBlockData, myLegitimacy) {
        //console.log(`[FullNode] Creating block candidate from lastHeight: ${lastBlockData.index}`);
        const Txs = this.memPool.getMostLucrativeTransactionsBatch(1000);
        if (Txs.length > 1) {
            console.log(`[Height:${lastBlockData.index}] ${Txs.length} transactions in the block candidate`);
        }

        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, myLegitimacy, 'ContrastGenesisBlock', Txs, Date.now());
        if (lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.hotData.blockMiningData);
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