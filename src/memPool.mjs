import { Validation } from './validation.mjs';
import { Transaction_Builder, Transaction } from './transaction.mjs';
import utils from './utils.mjs';
/**
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 */

export class MemPool { // Store transactions that are not yet included in a block
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {Object<string, Transaction>} */
        this.transactionByPath = {};

        this.devmode = false;
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
     * @param {Object<string, TransactionIO>} UTXOsByPath - from utxoCache
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
     * @param {Object<string, TransactionIO>} UTXOsByPath - from utxoCache
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
     * @param {Object<string, TransactionIO>} UTXOsByPath - from utxoCache
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    submitTransaction(callStack, UTXOsByPath, transaction, replaceExistingTxID) { // DEPRECATED
        callStack.push(() => this.pushTransaction(UTXOsByPath, transaction, replaceExistingTxID));
    }
    /**
     * @param {Object<string, TransactionIO>} UTXOsByPath - from utxoCache
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async pushTransaction(UTXOsByPath, transaction, replaceExistingTxID) {
        const isCoinBase = false;

        // First control format of : amount, address, rule, version, TxID
        Validation.isConformTransaction(transaction, isCoinBase);

        // Second control : input > output
        const fee = Validation.calculateRemainingAmount(transaction, isCoinBase);

        // Calculate fee per byte
        transaction.byteWeight = Transaction_Builder.getWeightOfTransaction(transaction);
        transaction.feePerByte = (fee / transaction.byteWeight).toFixed(6);

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
        await Validation.addressOwnershipConfirmation(UTXOsByPath, transaction, this.devmode);

        txInclusionFunction();
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
    }
}