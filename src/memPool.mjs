import { Validation } from './validation.mjs';
import { Transaction_Builder, Transaction, TransactionIO } from './transaction.mjs';
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

        this.useDevArgon2 = false;
    }

    /** 
     * @param {Transaction} transaction
     * @param {Transaction} collidingTx
     */
    #addMempoolTransaction(transaction, collidingTx = false) {
        if (collidingTx) { this.#removeMempoolTransaction(collidingTx); }

        // sorted by feePerByte
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);

        // sorted by anchor
        for (let i = 0; i < transaction.inputs.length; i++) {
            const anchor = transaction.inputs[i].anchor;
            this.transactionByPath[anchor] = transaction;
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

        // remove from: sorted by anchor
        const collidingTx = this.#caughtTransactionsUTXOCollision(transaction);
        for (let i = 0; i < collidingTx.inputs.length; i++) {
            const anchor = collidingTx.inputs[i].anchor;
            if (!this.transactionByPath[anchor]) { throw new Error(`Transaction not found in mempool: ${anchor}`); }
            delete this.transactionByPath[anchor];
        }

        // remove from: sorted by transaction ID
        delete this.transactionsByID[transaction.id];

        //console.log(`[MEMPOOL] transaction: ${transaction.id} removed`);
    }
    /** 
     * - Remove transactions that are using UTXOs that are already spent
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     */
    clearTransactionsWhoUTXOsAreSpent(utxosByAnchor) {
        const knownAnchors = Object.keys(this.transactionByPath);
        
        for (let i = 0; i < knownAnchors.length; i++) {
            const anchor = knownAnchors[i];
            if (!this.transactionByPath[anchor]) { continue; } // already removed
            if (utxosByAnchor[anchor]) { continue; } // not spent

            const transaction = this.transactionByPath[anchor];
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
    digestFinalizedBlockTransactions(Txs) {
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
            const anchor = transaction.inputs[i].anchor;
            if (anchor === undefined) { throw new Error('Invalid UTXO'); }
            if (!this.transactionByPath[anchor]) { continue; }

            return this.transactionByPath[anchor];
        }

        return false;
    }
    /** 
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     */
    static transactionUTXOsAreNotSpent(utxosByAnchor, transaction) {
        for (let i = 0; i < transaction.inputs.length; i++) {
            if (!utils.anchor.isValid(transaction.inputs[i].anchor)) { throw new Error('Invalid UTXO'); }
            if (!utxosByAnchor[transaction.inputs[i].anchor]) { return false; }
        }

        return true;
    }
    /**
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    submitTransaction(callStack, utxosByAnchor, transaction, replaceExistingTxID) { // DEPRECATED
        callStack.push(() => this.pushTransaction(utxosByAnchor, transaction, replaceExistingTxID));
    }
    /**
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction[]} transactions
     * @param {false[] | string[]} replaceExistingTxID
     */
    async pushTransactions(utxosByAnchor, transactions, replaceExistingTxID) {
    }
    /**
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     * @param {false | string} replaceExistingTxID
     */
    async pushTransaction(utxosByAnchor, transaction, replaceExistingTxID) {
        const timings = { start: Date.now(), first: 0, second: 0 };
        const isCoinBase = false;

        // First control format of : amount, address, rule, version, TxID
        Validation.isConformTransaction(transaction, isCoinBase);

        // Second control : input > output
        const fee = Validation.calculateRemainingAmount(transaction, isCoinBase);

        // Calculate fee per byte
        transaction.byteWeight = Transaction_Builder.getWeightOfTransaction(transaction);
        transaction.feePerByte = (fee / transaction.byteWeight).toFixed(6);

        const identicalIDTransaction = this.transactionsByID[transaction.id];
        const collidingTx = identicalIDTransaction ? identicalIDTransaction : this.#caughtTransactionsUTXOCollision(transaction);
        if (collidingTx) { // reject the transaction if it collides with the mempool and "replaceExistingTxID" is not set
            //TODO: active in production
            if (!replaceExistingTxID) { throw new Error(`Conflicting UTXOs with: ${collidingTx.id}`); }
            if (replaceExistingTxID !== collidingTx.id) { throw new Error('Invalid replaceExistingTxID'); }
            if (transaction.feePerByte <= collidingTx.feePerByte) { throw new Error('New transaction fee is not higher than the existing one'); }
        }

        if (!MemPool.transactionUTXOsAreNotSpent(utxosByAnchor, transaction)) { throw new Error('UTXOs(one at least) are spent'); }
        timings.first = Date.now() - timings.start;

        // Third validation: medium computation cost.
        await Validation.controlTransactionHash(transaction);

        // Fourth validation: low computation cost.
        await Validation.controlTransactionOutputsRulesConditions(transaction);

        // Fifth validation: medium computation cost.
        await Validation.controlAllWitnessesSignatures(transaction);
        
        // Sixth validation: high computation cost.
        await Validation.addressOwnershipConfirmation(utxosByAnchor, transaction, this.useDevArgon2);
        timings.second = Date.now() - timings.start;
        console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${timings.second}ms (first: ${timings.first}ms)`);

        this.#addMempoolTransaction(transaction, collidingTx);
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
    }
}