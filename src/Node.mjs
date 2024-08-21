import storage from './storage.mjs';
//import { BlockData, Block, Transaction, Transaction_Builder, Validation, TransactionIO, TxIO_Builder } from './index.mjs';
import { Validation } from './Validation.mjs';
import { Transaction, Transaction_Builder } from './Transaction.mjs';
import { BlockData, Block } from './Block.mjs';
import { TransactionIO, TxIO_Builder } from './TxIO.mjs';
import utils from './utils.mjs';

/**
 * An object that associates utxoTxID to arrays of TransactionIO.
 * @typedef {{ [utxoTxID: string]: TransactionIO[] }} ReferencedUTXOs
 */

/**
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 * @typedef {{ [utxoTxID: string]: Transaction }} ReferencedTransactions
 */
class MemPool {
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {ReferencedTransactions[]} */
        this.referencedTransactionsByBlock = [];

        /** @type {function[]} */
        this.callStack = [];
        /** @type {string = 'idle' | 'active' | 'pausing' | 'paused'} */
        this.state = 'idle';
    }

    async stackLoop(delayMS = 20) {
        this.state = 'active';

        while (true) {
            await new Promise(resolve => setTimeout(resolve, delayMS));

            if (this.state === 'idle' && this.callStack.length === 0) { continue; }
            if (this.state === 'paused') { continue; }
            if (this.state === 'pausing') { this.state = 'paused'; continue; }
            if (this.state === 'idle') { this.state = 'active'; }

            const functionToCall = this.callStack.shift();
            if (!functionToCall) { this.state = 'idle'; continue; }
            try {
                await functionToCall();
            } catch (error) {
                const errorSkippingLog = ['Conflicting UTXOs'];
                if (!errorSkippingLog.includes(error.message)) { console.error(error.stack); }
            }
        }
    }
    async pauseStackAndAwaitPaused() {
        if (this.state === 'paused') { return; }

        this.pauseStackLoop();
        while (this.state !== 'paused') {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }
    pauseStackLoop() {
        this.state = 'pausing';
    }
    resumeStackLoop() {
        this.state = 'active';
    }
    /** Add a function to the stack
     * @param {function} func
     * @param {boolean} firstPlace
     */
    addFunctionToStack(func, firstPlace = false) {
        if (firstPlace) { 
            this.callStack.unshift(func);
        } else {
            this.callStack.push(func);
        }
    }
    /** @param {Transaction} transaction */
    #addTransactionToTransactionsByFeePerByte(transaction) {
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);
    }
    /** @param {Transaction} collidingTx */
    #removeTxFromTransactionsByFeePerByte(collidingTx) {
        const feePerByte = collidingTx.feePerByte;
        if (!this.transactionsByFeePerByte[collidingTx.feePerByte]) { throw new Error('Transaction not found in mempool'); }

        const txIndex = this.transactionsByFeePerByte[feePerByte].findIndex(tx => tx.id === collidingTx.id);
        if (txIndex === -1) { throw new Error('Transaction not found in mempool'); }

        this.transactionsByFeePerByte[feePerByte].splice(txIndex, 1);
        if (this.transactionsByFeePerByte[feePerByte].length === 0) { delete this.transactionsByFeePerByte[feePerByte]; }
    }
    /** @param {Transaction} transaction */
    #addTransactionToReferencedTransactions(transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            const { utxoBlockHeight, utxoTxID } = transaction.inputs[i];
            if (!this.referencedTransactionsByBlock[utxoBlockHeight]) { this.referencedTransactionsByBlock[utxoBlockHeight] = {}; }
            this.referencedTransactionsByBlock[utxoBlockHeight][utxoTxID] = transaction;
        }
    }
    /** @param {Transaction} collidingTx */
    #removeTxFromReferencedTransactions(collidingTx) {
        // remove all references to the colliding transaction
        for (let i = 0; i < collidingTx.inputs.length; i++) {
            const { utxoBlockHeight, utxoTxID } = collidingTx.inputs[i];
            if (!this.referencedTransactionsByBlock[utxoBlockHeight]) { continue; }
            delete this.referencedTransactionsByBlock[utxoBlockHeight][utxoTxID];
        }
    }
    #fullyAddTransactionToMempool(transaction) {
        this.#addTransactionToTransactionsByFeePerByte(transaction);
        this.#addTransactionToReferencedTransactions(transaction);
        this.transactionsByID[transaction.id] = transaction;
    }
    #fullyRemoveTransactionFromMempool(transaction) {
        this.#removeTxFromTransactionsByFeePerByte(transaction);
        this.#removeTxFromReferencedTransactions(transaction);
        delete this.transactionsByID[transaction.id];
    }
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

            const tx = Txs[i];
            const collidingTx = this.#caughtTransactionsUTXOCollision(tx);
            if (!collidingTx) { continue; }
            
            this.#fullyRemoveTransactionFromMempool(collidingTx);
        }
    }
    /** 
     * - Remove transactions that are using UTXOs that are already spent
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
     */
    clearTransactionsWhoUTXOsAreSpent(referencedUTXOsByBlock) {
        for (let i = 0; i < this.referencedTransactionsByBlock.length; i++) {
            const referencedTransactions = this.referencedTransactionsByBlock[i];
            if (!referencedTransactions) { continue; }

            for (let j = 0; j < referencedTransactions.length; j++) {
                const transaction = referencedTransactions[j];

                for (let k = 0; k < transaction.inputs.length; k++) {
                    const { utxoBlockHeight, utxoTxID, vout } = transaction.inputs[k];
                    if (utxoBlockHeight === undefined || !utxoTxID || vout === undefined) { throw new Error('Invalid UTXO'); }

                    if (!referencedUTXOsByBlock[utxoBlockHeight]) { this.#fullyRemoveTransactionFromMempool(transaction); continue; }
                    if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { this.#fullyRemoveTransactionFromMempool(transaction); continue; }
                    if (!referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout]) { this.#fullyRemoveTransactionFromMempool(transaction); continue; }
                }
            }
        }
    }
    /**
     * @param {Transaction} transaction
     */
    #caughtTransactionsUTXOCollision(transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            const { utxoBlockHeight, utxoTxID, vout } = transaction.inputs[i];
            if (utxoBlockHeight === undefined || !utxoTxID || vout === undefined) { throw new Error('Invalid UTXO'); }
            if (!this.referencedTransactionsByBlock[utxoBlockHeight]) { continue; }
            if (!this.referencedTransactionsByBlock[utxoBlockHeight][utxoTxID]) { continue; }

            const existingTx = this.referencedTransactionsByBlock[utxoBlockHeight][utxoTxID];
            for (let i = 0; i < existingTx.inputs.length; i++) {
                const existingTxInputs = existingTx.inputs[i];
                if (existingTxInputs.vout !== vout) { continue; }
                if (existingTxInputs.utxoTxID !== utxoTxID) { continue; } // not necessary but better
                if (existingTxInputs.utxoBlockHeight !== utxoBlockHeight) { continue; } // not necessary but better
                return existingTx;
            }
        }

        return false;
    }
    /** 
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock - from hotData
     * @param {Transaction} transaction
     */
    #transactionUTXOsAreNotSpent(referencedUTXOsByBlock, transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            const { utxoBlockHeight, utxoTxID, vout } = transaction.inputs[i];
            if (utxoBlockHeight === undefined || !utxoTxID || vout === undefined) { throw new Error('Invalid UTXO'); }

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
        this.addFunctionToStack(() => this.#pushTransaction(referencedUTXOsByBlock, transaction, replaceExistingTxID));
    }
    /**
     * should be used with the callstack
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock - from hotData
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async #pushTransaction(referencedUTXOsByBlock, transaction, replaceExistingTxID) {
        const startTime = Date.now();
        const isCoinBase = false;

        // First control format of : amount, address, script, version, TxID
        Validation.isConformTransaction(transaction, isCoinBase);

        // Second control : input > output
        const fee = Validation.calculateRemainingAmount(transaction, isCoinBase);

        // Calculate fee per byte
        const TxWeight = Transaction_Builder.getWeightOfTransaction(transaction);
        const feePerByte = fee / TxWeight;
        transaction.byteWeight = TxWeight;
        transaction.feePerByte = feePerByte;

        // Manage the mempool inclusion and collision
        let txInclusionFunction = () => {
            this.#fullyAddTransactionToMempool(transaction);
        };

        const identicalIDTransaction = this.transactionsByID[transaction.id];
        const collidingTx = identicalIDTransaction ? identicalIDTransaction : this.#caughtTransactionsUTXOCollision(transaction);
        if (collidingTx) {
            if (!replaceExistingTxID) { throw new Error('Conflicting UTXOs'); }
            if (replaceExistingTxID !== collidingTx.id) { throw new Error('Invalid replaceExistingTxID'); }
            if (transaction.feePerByte <= collidingTx.feePerByte) { throw new Error('New transaction fee is not higher than the existing one'); }

            txInclusionFunction = () => {
                this.#fullyRemoveTransactionFromMempool(collidingTx);
                this.#fullyAddTransactionToMempool(transaction);
            };
        }

        if (!this.#transactionUTXOsAreNotSpent(referencedUTXOsByBlock, transaction)) {
            throw new Error('UTXOs(one at least) are spent'); }

        // Third validation: medium computation cost.
        await Validation.controlTransactionHash(transaction);

        // Fourth validation: medium computation cost.
        await Validation.executeTransactionInputsScripts(referencedUTXOsByBlock, transaction);

        // Fifth validation: high computation cost.
        await Validation.addressOwnershipConfirmation(referencedUTXOsByBlock, transaction);

        txInclusionFunction();
        console.log(`Transaction pushed in mempool in ${Date.now() - startTime}ms`);
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
            
            TxIO_Builder.checkMissingTxID(TxInputs);

            const { utxoBlockHeight, utxoTxID, vout } = this.getUTXOReferenceIFromReferenced(TxInputs[i]);
            const { address, amount } = this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];

            this.#removeUTXO(address, utxoBlockHeight, utxoTxID, vout);
            this.#changeBalance(address, -amount);
        }

        return true;
    }
    /** @param {TransactionIO} utxo */
    #setReferencedUTXO(utxo) {
        const { utxoBlockHeight, utxoTxID, vout } = utxo;
        if (utxoBlockHeight === undefined || !utxoTxID || vout === undefined) { throw new Error('Invalid UTXO'); }

        if (!this.referencedUTXOsByBlock[utxoBlockHeight]) { this.referencedUTXOsByBlock[utxoBlockHeight] = {}; }
        if (!this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]) { this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID] = []; }
        this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID].push(utxo);
    }
    /**
     * @param {number} utxoBlockHeight
     * @param {string} utxoTxID
     * @param {number} vout
     */
    #deleteCorrespondingUTXOFromReferenced(utxoBlockHeight, utxoTxID, vout) {
        this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID].splice(vout, 1);
        if (this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID].length === 0) { delete this.referencedUTXOsByBlock[utxoBlockHeight][utxoTxID]; }
    }
    /**
     * @param {string} address
     * @param {number} utxoBlockHeight
     * @param {string} utxoTxID
     * @param {number} vout
     */
    #deleteUTXOFromaddressUTXOs(address, utxoBlockHeight, utxoTxID, vout) {
        if (this.addressesUTXOs[address] === undefined) { throw new Error(`${address} has no UTXOs`); }

        const addressUtxoIndex = this.addressesUTXOs[address].findIndex(utxoInArray =>
            utxoInArray.utxoTxID === utxoTxID && utxoInArray.utxoBlockHeight === utxoBlockHeight && utxoInArray.vout === vout);
        if (addressUtxoIndex === -1) { throw new Error(`${address} isn't owning UTXO: ${utxoTxID}`); }

        this.addressesUTXOs[address].splice(addressUtxoIndex, 1);
        if (this.addressesUTXOs[address].length === 0) { delete this.addressesUTXOs[address]; }
    }
    /**
     * @param {string} address
     * @param {number} utxoBlockHeight
     * @param {string} utxoTxID
     * @param {number} vout
     */
    #removeUTXO(address, utxoBlockHeight, utxoTxID, vout) {
        this.#deleteUTXOFromaddressUTXOs(address, utxoBlockHeight, utxoTxID, vout);
        this.#deleteCorrespondingUTXOFromReferenced(utxoBlockHeight, utxoTxID, vout);
        console.log(`[HotData]=> UTXO removed: ${utxoBlockHeight} - ${utxoTxID} - ${vout} | owner: ${address}`);
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
            TxOutputs[i].utxoBlockHeight = blockIndex;
            TxOutputs[i].utxoTxID = TxID;
            TxOutputs[i].vout = i;
            
            const { address, amount } = TxOutputs[i];
            if (amount === 0) { continue; } // no need to add UTXO with 0 amount

            if (this.addressesUTXOs[address] === undefined) { this.addressesUTXOs[address] = []; }
            this.addressesUTXOs[address].push(TxOutputs[i]);
            this.#setReferencedUTXO(TxOutputs[i]);
            this.#changeBalance(address, amount);
        }
    }

    // Public methods
    /** @param {TransactionIO} input */
    getUTXOReferenceIFromReferenced(input) {
        const { utxoBlockHeight, utxoTxID, vout } = input;
        if (utxoBlockHeight === undefined || !utxoTxID || vout === undefined) { throw new Error('Invalid UTXO'); }

        const referencedUTXOs = this.referencedUTXOsByBlock[utxoBlockHeight];
        if (!referencedUTXOs) { throw new Error('UTXO not found in referencedUTXOsByBlock'); }

        const utxos = referencedUTXOs[utxoTxID];
        if (!utxos) { 
            throw new Error('UTXO not found in referencedUTXOsByBlock'); }
        if (!utxos[vout]) { throw new Error('UTXO not found in referencedUTXOsByBlock'); }

        return { utxoBlockHeight, utxoTxID, vout };
    }
    /** @param {string} address */
    getBalanceAndUTXOs(address) {
        // clone values to avoid modification
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
    /** @param {BlockData[]} chain */
    digestChain(chain) {
        for (let i = 0; i < chain.length; i++) {
            const blockData = chain[i];
            this.digestBlock(blockData);
        }
    }
    /** @param {BlockData} blockData */
    digestBlock(blockData) {
        const Txs = blockData.Txs;
        this.digestBlockTransactions(blockData.index, Txs);

        const supplyFromBlock = blockData.supply;
        const coinBase = blockData.coinBase;
        const totalSupply = supplyFromBlock + coinBase;
        const totalOfBalances = this.#calculateTotalOfBalances();

        const currencySupply = utils.convert.number.formatNumberAsCurrency(totalSupply);
        const currencyBalances = utils.convert.number.formatNumberAsCurrency(totalOfBalances);
        //console.log(`supplyFromBlock+coinBase: ${readableSupply} - totalOfBalances: ${readableBalances}`);
        if (totalOfBalances !== totalSupply) { 
            console.info(`supplyFromBlock+coinBase: ${currencySupply} - totalOfBalances: ${currencyBalances}`);
            throw new Error('Invalid total of balances'); 
        }
    }
}
export class FullNode {
    /** @param {Account} validatorAccount */
    constructor(validatorAccount, chain) {
        /** @type {Account} */
        this.validatorAccount = validatorAccount;
        /** @type {BlockData[]} */
        this.chain = chain || [];
        /** @type {BlockData} */
        this.blockCandidate = null;

        this.memPool = new MemPool();
        this.hotData = new HotData();

        /** @type {function[]} */
        this.callStack = [];
        /** @type {string = 'idle' | 'active' | 'pausing' | 'paused'} */
        this.state = 'idle';
    }
    async #stackLoop(delayMS = 20) {
        this.state = 'active';

        while (true) {
            await new Promise(resolve => setTimeout(resolve, delayMS));

            const functionToCall = this.callStack.shift();
            if (!functionToCall) { continue; }
            try {
                await functionToCall();
            } catch (error) {
                const errorSkippingLog = ['Invalid block index:']; // ['Conflicting UTXOs'];
                if (!errorSkippingLog.includes(error.message.slice(0, 20))) { console.error(error.stack); }
            }
        }
    }
    /** Add a function to the stack
     * @param {function} func
     * @param {boolean} firstPlace
     */
    addFunctionToStack(func, firstPlace = false) {
        if (firstPlace) { 
            this.callStack.unshift(func);
        } else {
            this.callStack.push(func);
        }
    }

    /** @param {Account} validatorAccount */
    static async load(validatorAccount, saveBlocksInfo = true) {
        const chain = storage.loadBlockchainLocally('bin');
        const controlChain = storage.loadBlockchainLocally('json');
        FullNode.controlChainIntegrity(chain, controlChain);

        const node = new FullNode(validatorAccount, chain);
        node.hotData.digestChain(chain);
        // TODO: mempool digest mempool from other validator node
        node.memPool.stackLoop(20);

        if (saveBlocksInfo) { // basic informations .csv
            const blocksInfo = node.#getBlocksMiningInfo();
            storage.saveBlockchainInfoLocally(blocksInfo);
        }

        // TODO: Get the Txs from the mempool and add them
        // TODO: Verify the Txs

        const lastBlockData = chain[chain.length - 1] ? chain[chain.length - 1] : undefined;
        node.blockCandidate = await node.#createBlockCandidate(lastBlockData);

        node.#stackLoop(20);
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
        this.addFunctionToStack(() => this.#blockProposal(minerBlockCandidate));
    }
    /** 
     * should be used with the callstack
     * @param {BlockData} minerBlockCandidate
     */
    async #blockProposal(minerBlockCandidate) {
        if (!minerBlockCandidate) { throw new Error('Invalid block candidate'); }
        if (minerBlockCandidate.index !== this.blockCandidate.index) { throw new Error(`Invalid block index: ${minerBlockCandidate.index} - current candidate: ${this.blockCandidate.index}`); }
        
        //TODO : VALIDATE THE BLOCK
        // TODO verify if coinBase Tx release the correct amount of coins
        const { hex, bitsArrayAsString } = await Block.calculateHash(minerBlockCandidate);
        utils.mining.verifyBlockHashConformToDifficulty(bitsArrayAsString, minerBlockCandidate.difficulty);

        if (minerBlockCandidate.hash !== hex) { throw new Error('Invalid hash'); }
        
        const blockDataCloneToSave = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        if (this.chain.length < 2000) { storage.saveBlockDataLocally(blockDataCloneToSave, 'json'); }
        const saveResult = storage.saveBlockDataLocally(blockDataCloneToSave, 'bin');
        if (!saveResult.success) { throw new Error(saveResult.message); }

        const blockDataCloneToDigest = Block.cloneBlockData(minerBlockCandidate); // clone to avoid modification
        this.chain.push(blockDataCloneToDigest);
        
        await this.memPool.pauseStackAndAwaitPaused(); // pause the mempool stack
        this.hotData.digestBlock(blockDataCloneToDigest);
        this.memPool.digestBlockTransactions(blockDataCloneToDigest.Txs);
        this.memPool.clearTransactionsWhoUTXOsAreSpent(this.hotData.referencedUTXOsByBlock);
        this.memPool.resumeStackLoop(); // resume the mempool stack

        // simple log for debug ----------------------
        const powMinerTx = minerBlockCandidate.Txs[0];
        const address = powMinerTx.outputs[0].address;
        const { balance, UTXOs } = this.hotData.getBalanceAndUTXOs(address);
        console.log(`[Height:${minerBlockCandidate.index}] remaining UTXOs for [ ${utils.addressUtils.formatAddress(address, ' ')} ] ${UTXOs.length} utxos - balance: ${utils.convert.number.formatNumberAsCurrency(balance)}`);
        // -------------------------------------------

        this.addFunctionToStack(async () => {
            const newBlockCandidate = await this.#createBlockCandidate(minerBlockCandidate);
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
    /** @param {BlockData | undefined} lastBlockData */
    async #createBlockCandidate(lastBlockData) {
        await this.memPool.pauseStackAndAwaitPaused();
        const Txs = this.memPool.getMostLucrativeTransactionsBatch(1000);
        if (Txs.length > 1) {
            console.log(`[Height:${lastBlockData.index}] ${Txs.length} transactions in the block candidate`);
        }
        this.memPool.resumeStackLoop();

        let blockCandidate = BlockData(0, 0, utils.blockchainSettings.blockReward, 1, 'ContrastGenesisBlock', Txs);
        if (lastBlockData) {
            const newDifficulty = utils.mining.difficultyAdjustment(this.chain);
            const lastBlockData = this.chain[this.chain.length - 1];
            const clone = Block.cloneBlockData(lastBlockData);
            const supply = clone.supply + clone.coinBase;
            const coinBaseReward = Block.calculateNextCoinbaseReward(clone);
            blockCandidate = BlockData(clone.index + 1, supply, coinBaseReward, newDifficulty, clone.hash, Txs);
        }

        const posFeeTx = await Transaction_Builder.createPosRewardTransaction(blockCandidate, this.validatorAccount.address);
        posFeeTx.id = await Transaction_Builder.hashTxToGetID(posFeeTx);
        const signedPosFeeTx = await this.validatorAccount.signAndReturnTransaction(posFeeTx);
        blockCandidate.Txs.unshift(signedPosFeeTx);

        return blockCandidate;
    }
    #getBlocksMiningInfo() {
        const blocksInfo = [];

        for (let i = 0; i < this.chain.length; i++) {
            const block = this.chain[i];

            blocksInfo.push({ 
                blockIndex: block.index,
                coinbaseReward: block.coinBase,
                timestamp: block.timestamp,
                difficulty: block.difficulty,
                timeBetweenBlocks: i === 0 ? 0 : block.timestamp - this.chain[i - 1].timestamp
            });
        }

        return blocksInfo;
    }
}
export class LightNode {
    
}