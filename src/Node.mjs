import storage from './storage.mjs';
import { Vss } from './vss.mjs';
import { Validation } from './validation.mjs';
import { Transaction, TransactionIO, Transaction_Builder, TxIO_Builder } from './transaction.mjs';
import { BlockMiningData, BlockData, Block } from './block.mjs';
import utils from './utils.mjs';

const callStack = utils.CallStack.buildNewStack(['Conflicting UTXOs', 'Invalid block index:']);
/** Used by HotData
 * An object that associates utxoTxID to arrays of TransactionIO.
 * @typedef {{ [utxoTxID: string]: { [vout: string]: TransactionIO} }} ReferencedUTXOs
 */

/** Used by MemPool
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 */
class MemPool {
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {Object<string, Transaction>} */
        this.transactionByPointer = {};
    }

    /** @param {Transaction} transaction */
    #addMempoolTransaction(transaction) {
        // sorted by feePerByte
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);

        // sorted by pointer
        for (let i = 0; i < transaction.inputs.length; i++) {
            const pointer = transaction.inputs[i].pointer;
            this.transactionByPointer[pointer] = transaction;
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

        // remove from: sorted by pointer
        const collidingTx = this.#caughtTransactionsUTXOCollision(transaction);
        for (let i = 0; i < collidingTx.inputs.length; i++) {
            const pointer = collidingTx.inputs[i].pointer;
            if (!this.transactionByPointer[pointer]) { throw new Error(`Transaction not found in mempool: ${pointer}`); }
            delete this.transactionByPointer[pointer];
        }

        // remove from: sorted by transaction ID
        delete this.transactionsByID[transaction.id];

        //console.log(`[MEMPOOL] transaction: ${transaction.id} removed`);
    }
    /** 
     * - Remove transactions that are using UTXOs that are already spent
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
     */
    clearTransactionsWhoUTXOsAreSpent(referencedUTXOsByBlock) {
        const knownPointers = Object.keys(this.transactionByPointer);
        for (let i = 0; i < knownPointers.length; i++) {
            const pointer = knownPointers[i];
            if (!this.transactionByPointer[pointer]) { continue; } // already removed
            if (!this.#isUtxoSpent(referencedUTXOsByBlock, pointer)) { continue; }

            const transaction = this.transactionByPointer[pointer];
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
            const pointer = transaction.inputs[i].pointer;
            if (pointer === undefined) { throw new Error('Invalid UTXO'); }
            if (!this.transactionByPointer[pointer]) { continue; }

            return this.transactionByPointer[pointer];
        }

        return false;
    }
    /** Search if the UTXO is spent in the referencedUTXOsByBlock (hotData)
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock - from hotData
     * @param {string} pointer
     */
    #isUtxoSpent(referencedUTXOsByBlock, pointer) {
        const { utxoBlockHeight, utxoTxID, vout } = utils.pointer.to_height_utxoTxID_vout(pointer);
        if (!referencedUTXOsByBlock[utxoBlockHeight]) { return true; }
        if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { return true; }
        if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout]) { return true; }

        return false;
    }
    /** 
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock - from hotData
     * @param {Transaction} transaction
     */
    #transactionUTXOsAreNotSpent(referencedUTXOsByBlock, transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            if (!utils.pointer.isValidPointer(transaction.inputs[i].pointer)) { throw new Error('Invalid UTXO'); }
            const { utxoBlockHeight, utxoTxID, vout } = utils.pointer.to_height_utxoTxID_vout(transaction.inputs[i].pointer);

            if (!referencedUTXOsByBlock[utxoBlockHeight]) { return false; }
            if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { return false; }
            if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout]) { return false; }
        }

        return true;
    }
    /**
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    submitTransaction(referencedUTXOsByBlock, transaction, replaceExistingTxID) {
        callStack.push(() => this.#pushTransaction(referencedUTXOsByBlock, transaction, replaceExistingTxID));
    }
    /**
     * should be used with the callstack
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock - from hotData
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async #pushTransaction(referencedUTXOsByBlock, transaction, replaceExistingTxID) {
        const startTime = Date.now();
        try {
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
    
            if (!this.#transactionUTXOsAreNotSpent(referencedUTXOsByBlock, transaction)) {
                throw new Error('UTXOs(one at least) are spent'); }
    
            // Third validation: medium computation cost.
            await Validation.controlTransactionHash(transaction);

            // Fourth validation: low computation cost.
            await Validation.controlTransactionOutputsRulesConditions(transaction);
    
            // Fifth validation: medium computation cost.
            await Validation.controlAllWitnessesSignatures(transaction);
            //await Validation.executeTransactionInputsScripts(referencedUTXOsByBlock, transaction); DEPRECATED
    
            // Sixth validation: high computation cost.
            await Validation.addressOwnershipConfirmation(referencedUTXOsByBlock, transaction);
    
            txInclusionFunction();
            console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
        } catch (error) {
            //console.log(`[MEMPOOL] transaction: ${transaction.id} rejected in ${Date.now() - startTime}ms =reason> ${error.message}`);
            throw error;
        }
    }
}

class HotData { // Used to store, addresses's UTXOs and balance.
    constructor() {
        /** @type {Object<string, TransactionIO[]>} */
        this.addressesUTXOs = {};
        /** @type {Object<string, number>} */
        this.addressesBalances = {};
        /** @type {ReferencedUTXOs[]} */
        this.referencedUTXOsByBlock = [];
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
        for (let i = 0; i < TxInputs.length; i++) {
            
            TxIO_Builder.checkMalformedUTXOsPointer(TxInputs);
            TxIO_Builder.checkDuplicateUTXOsPointer(TxInputs);

            const { utxoBlockHeight, utxoTxID, vout } = this.#getUTXOReferenceIFromReferenced(TxInputs[i]);
            const { address, amount } = this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];

            this.#removeUTXO(address, utxoBlockHeight, utxoTxID, vout);
            this.#changeBalance(address, -amount);
        }

        return true;
    }
    /** @param {TransactionIO} input */
    #getUTXOReferenceIFromReferenced(input) {
        if (!utils.pointer.isValidPointer(input.pointer)) { throw new Error('Invalid UTXO pointer'); }
        const { utxoBlockHeight, utxoTxID, vout } = utils.pointer.to_height_utxoTxID_vout(input.pointer);

        if (!this.referencedUTXOsByBlock[utxoBlockHeight]) { throw new Error(`referencedUTXOsByBlock doesn't have block: ${utxoBlockHeight}`); }
        if (!this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { throw new Error(`referencedUTXOsByBlock block: ${utxoBlockHeight} doesn't have tx: ${utxoTxID}`); }
        if (!this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout]) { 
            throw new Error(`referencedUTXOsByBlock block: ${utxoBlockHeight} tx: ${utxoTxID} doesn't have vout ${vout}`); }

        return { utxoBlockHeight, utxoTxID, vout };
    }
    /** @param {TransactionIO} utxo */
    #setReferencedUTXO(utxo) {
        if (!utils.pointer.isValidPointer(utxo.pointer)) { throw new Error('Invalid UTXO pointer'); }
        const { utxoBlockHeight, utxoTxID, vout } = utils.pointer.to_height_utxoTxID_vout(utxo.pointer);

        if (!this.referencedUTXOsByBlock[utxoBlockHeight]) { this.referencedUTXOsByBlock[utxoBlockHeight] = {}; }
        if (!this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID] = {}; }
        this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout] = utxo;
    }
    /**
     * @param {string} address
     * @param {number} utxoBlockHeight
     * @param {string} utxoTxID
     * @param {number} vout
     */
    #removeUTXO(address, utxoBlockHeight, utxoTxID, vout) {
        const pointer = utils.pointer.from_TransactionInputReferences(utxoBlockHeight, utxoTxID, vout);

        // remove from addressesUTXOs
        if (this.addressesUTXOs[address] === undefined) { throw new Error(`${address} has no UTXOs`); }

        const addressUtxoIndex = this.addressesUTXOs[address].findIndex(utxoInArray => utxoInArray.pointer === pointer);
        if (addressUtxoIndex === -1) { throw new Error(`${address} isn't owning UTXO: ${pointer}`); }

        this.addressesUTXOs[address].splice(addressUtxoIndex, 1);
        if (this.addressesUTXOs[address].length === 0) { delete this.addressesUTXOs[address]; }

        // remove from referencedUTXOsByBlock
        delete this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];
        if (Object.keys(this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]).length === 0) { delete this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]; }
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
            // UXTO would be used as input, then we set blockIndex, utxoTxID, and vout
            const pointer = utils.pointer.from_TransactionInputReferences(blockIndex, TxID, i);
            TxOutputs[i].pointer = pointer;
            
            const { address, amount } = TxOutputs[i];
            if (amount === 0) { continue; } // no need to add UTXO with 0 amount

            if (this.addressesUTXOs[address] === undefined) { this.addressesUTXOs[address] = []; }
            this.addressesUTXOs[address].push(TxOutputs[i]);
            this.#setReferencedUTXO(TxOutputs[i]);
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
        for (let i = 0; i < UTXOs.length; i++) {
            const rule =  UTXOs[i].rule;
            if (rule === "sigOrSlash") {
                UTXOs.splice(i, 1);
                i--;
            }
        }

        return { balance, UTXOs };
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
        /** @type {Account} */
        this.validatorAccount = validatorAccount;
        /** @type {BlockData} */
        this.blockCandidate = null;

        this.memPool = new MemPool();
        this.hotData = new HotData();

        this.callStack = callStack;
    }

    /** @param {Account} validatorAccount */
    static async load(validatorAccount, saveBlocksInfo = false) {
        const node = new FullNode(validatorAccount);
        const blocksFolders = storage.getListOfFoldersInBlocksDirectory();
        const nbOfBlocksInStorage = storage.countFilesInBlocksDirectory(blocksFolders, 'bin');
        const progressLogger = new utils.ProgressLogger(nbOfBlocksInStorage);
        
        /** @type {BlockData} */
        let lastBlockData = undefined;
        let blockLoadedCount = 0;
        for (let i = 0; i < blocksFolders.length; i++) {
            const blocksFolder = blocksFolders[i];
            const chainPart = storage.loadBlockchainPartLocally(blocksFolder, 'bin');
            const controlChainPart = storage.loadBlockchainPartLocally(blocksFolder, 'json');
            FullNode.controlChainIntegrity(chainPart, controlChainPart);

            await node.hotData.digestChainPart(chainPart);
            lastBlockData = chainPart[chainPart.length - 1];

            blockLoadedCount += chainPart.length;
            progressLogger.logProgress(blockLoadedCount);

            if (saveBlocksInfo) { // basic informations .csv
                const blocksInfo = node.#getBlocksMiningInfo(chainPart);
                storage.saveBlockchainInfoLocally(blocksInfo);
            }
        }
        // TODO: mempool digest mempool from other validator node
        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        if (lastBlockData) { await node.hotData.vss.calculateRoundLegitimacies(lastBlockData.hash); }
        const myLegitimacy = node.hotData.vss.getAddressLegitimacy(node.validatorAccount.address);
        node.blockCandidate = await node.#createBlockCandidate(lastBlockData, myLegitimacy);

        return node;
    }
    /**
     * @param {BlockData[]} chain
     * @param {BlockData[]} controlChain
     */
    static controlChainIntegrity(chain, controlChain) {
        // Control the chain integrity
        for (let i = 0; i < controlChain.length; i++) {
            const controlBlock = controlChain[i];
            const block = chain[i];
            FullNode.controlObjectEqualValues(controlBlock, block);
        }
    }
    /**
     * @param {object} object1
     * @param {object} object2
     */
    static controlObjectEqualValues(object1, object2) {
        for (const key in object1) {
            const value1 = object1[key];
            const value2 = object2[key];
            if (typeof value1 === 'object') {
                FullNode.controlObjectEqualValues(value1, value2);
            } else if (value1 !== value2) {
                throw new Error(`Control failed - key: ${key}`);
            }
        }
    }
    
    /** @param {BlockData} minerBlockCandidate */
    submitPowProposal(minerBlockCandidate) {
        callStack.push(() => this.#blockProposal(minerBlockCandidate));
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
        const { hex, bitsArrayAsString } = await Block.calculateHash(minerBlockCandidate);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, minerBlockCandidate.difficulty);

        if (minerBlockCandidate.hash !== hex) { throw new Error('Invalid hash'); }
        
        const blockDataCloneToSave = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        if (this.blockCandidate.index < 2000) { storage.saveBlockDataLocally(blockDataCloneToSave, 'json'); }
        const saveResult = storage.saveBlockDataLocally(blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        
        await this.hotData.digestConfirmedBlock(blockDataCloneToDigest);
        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.hotData.referencedUTXOsByBlock);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.hotData.getBalanceAndUTXOs(address);
        console.log(`[FullNode] Height: ${minerBlockCandidate.index} -> remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        // -------------------------------------------

        callStack.push(async () => {
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
        this.memPool.submitTransaction(this.hotData.referencedUTXOsByBlock, signedTansaction, replaceExistingTxID);
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

        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, myLegitimacy, 'ContrastGenesisBlock', Txs);
        if (lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.hotData.blockMiningData);
            const clone = Block.cloneBlockData(lastBlockData);
            const supply = clone.supply + clone.coinBase;
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(clone.index + 1, supply, coinBaseReward, newDifficulty, myLegitimacy, clone.hash, Txs);
        }

        // Add the PoS reward transaction
        const posRewardAddress = this.validatorAccount.address;
        const posStakedAddress = this.validatorAccount.address;
        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, posRewardAddress, posStakedAddress);
        const signedPosFeeTx = await this.validatorAccount.signAndReturnTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        return blockCandidate;
    }
    #getBlocksMiningInfo(chain) { // DEPRECATED
        const blocksInfo = [];

        for (let i = 0; i < chain.length; i++) {
            const block = chain[i];

            blocksInfo.push({ 
                blockIndex: block.index,
                coinbaseReward: block.coinBase,
                timestamp: block.timestamp,
                difficulty: block.difficulty,
                timeBetweenBlocks: i === 0 ? 0 : block.timestamp - chain[i - 1].timestamp
            });
        }

        return blocksInfo;
    }
}