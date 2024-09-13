import { TxValidation } from './validation.mjs';
import { Transaction_Builder, Transaction, UTXO } from './transaction.mjs';
import utils from './utils.mjs';
/**
 * @typedef {{ [feePerByte: string]: Transaction[] }} TransactionsByFeePerByte
 * @typedef {import('./block.mjs').BlockData} BlockData
 */

export class MemPool { // Store transactions that are not yet included in a block
    constructor() {
        /** @type {Object<string, Transaction>} */
        this.transactionsByID = {};
        /** @type {TransactionsByFeePerByte} */
        this.transactionsByFeePerByte = {};
        /** @type {Object<string, Transaction>} */
        this.transactionByAnchor = {};

        this.maxPubKeysToRemember = 1_000_000; // ~45MB
        this.knownPubKeysAddresses = {}; // used to avoid excessive address ownership confirmation
        this.useDevArgon2 = false;
    }

    /**
     * @param {Transaction} transaction
     * @param {Transaction} collidingTx
     */
    #addMempoolTransaction(transaction, collidingTx = false) {
        if (collidingTx) { this.#removeMempoolTransaction(collidingTx); }
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM

        // sorted by feePerByte
        const feePerByte = transaction.feePerByte;
        this.transactionsByFeePerByte[feePerByte] = this.transactionsByFeePerByte[feePerByte] || [];
        this.transactionsByFeePerByte[feePerByte].push(transaction);

        // sorted by anchor
        for (const input of transaction.inputs) { this.transactionByAnchor[input] = transaction; }

        // sorted by transaction ID
        this.transactionsByID[transaction.id] = transaction;

        //console.log(`[MEMPOOL] transaction: ${transaction.id} added`);
    }
    /** @param {Transaction} transaction */
    #removeMempoolTransaction(transaction) {
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM

        // remove from: sorted by feePerByte
        const txFeePerByte = transaction.feePerByte;
        if (!this.transactionsByFeePerByte[txFeePerByte]) { throw new Error('Transaction not found in mempool'); }

        const txIndex = this.transactionsByFeePerByte[txFeePerByte].findIndex(tx => tx.id === transaction.id);
        if (txIndex === -1) { throw new Error('Transaction not found in mempool'); }

        this.transactionsByFeePerByte[txFeePerByte].splice(txIndex, 1);
        if (this.transactionsByFeePerByte[txFeePerByte].length === 0) { delete this.transactionsByFeePerByte[txFeePerByte]; }

        // remove from: sorted by anchor
        const collidingTx = this.#caughtTransactionsAnchorsCollision(transaction);
        for (const input of collidingTx.inputs) {
            if (!this.transactionByAnchor[input]) { throw new Error(`Transaction not found in mempool: ${input}`); }
            delete this.transactionByAnchor[input];
        }

        // remove from: sorted by transaction ID
        delete this.transactionsByID[transaction.id];

        //console.log(`[MEMPOOL] transaction: ${transaction.id} removed`);
    }
    /** -> Use when a new block is accepted
     * - Remove transactions that are using UTXOs that are already spent
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
     */
    clearTransactionsWhoUTXOsAreSpent(utxosByAnchor) {
        for (const anchor in this.transactionByAnchor) {
            if (!this.transactionByAnchor[anchor]) { continue; } // already removed
            if (utxosByAnchor[anchor]) { continue; } // not spent

            const transaction = this.transactionByAnchor[anchor];
            this.#removeMempoolTransaction(transaction);
        }
    }
    cleanupknownPubKeysAddressesIfNecessary() {
        const keys = Object.keys(this.knownPubKeysAddresses);
        const nbOfKnownPubKeys = keys.length;
        if (nbOfKnownPubKeys < this.maxPubKeysToRemember * 1.1) { return; }

        const nbOfKeysToDelete = nbOfKnownPubKeys - this.maxPubKeysToRemember;
        for (let i = 0; i < nbOfKeysToDelete; i++) {
            delete this.knownPubKeysAddresses[keys[i]];
        }
    }
    // -------------------------------------
    getMostLucrativeTransactionsBatch() {
        const maxTotalBytes = utils.SETTINGS.maxBlockSize;
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

                const clone = Transaction_Builder.clone(tx);
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
     * @param {BlockData[]} blocksData
     */
    digestFinalizedBlocksTransactions(blocksData) {
        for (const blockData of blocksData) {
            const Txs = blockData.Txs;
            if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }

            // remove the transactions included in the block that collide with the mempool
            for (const tx of Txs) {
                if (Transaction_Builder.isMinerOrValidatorTx(tx)) { continue; }

                const collidingTx = this.#caughtTransactionsAnchorsCollision(tx);
                if (!collidingTx) { continue; }

                if (tx.id === collidingTx.id) {
                    console.log(`[MEMPOOL] transaction: ${tx.id} confirmed!`);
                }
                this.#removeMempoolTransaction(collidingTx);
            }
        }
    }
    /** @param {Transaction} transaction */
    #caughtTransactionsAnchorsCollision(transaction) {
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM
        for (const input of transaction.inputs) {
            if (!utils.types.anchor.isConform(input)) { throw new Error(`Invalid anchor: ${input}`); }
            if (!this.transactionByAnchor[input]) { continue; } // no collision

            return this.transactionByAnchor[input];
        }

        return false;
    }
    /**
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     */
    async pushTransaction(utxosByAnchor, transaction) {
        const timings = { start: Date.now(), first: 0, second: 0 };

        // First control format of : amount, address, rule, version, TxID, available UTXOs
        TxValidation.isConformTransaction(utxosByAnchor, transaction, false);

        const identicalIDTransaction = this.transactionsByID[transaction.id];
        const collidingTx = identicalIDTransaction ? identicalIDTransaction : this.#caughtTransactionsAnchorsCollision(transaction);
        if (collidingTx) { // reject the transaction if it collides with the mempool
            throw new Error(`Conflicting UTXOs with: ${collidingTx.id}`);
            // TODO: replace the transaction if the new one has a higher fee
            //if (transaction.feePerByte <= collidingTx.feePerByte) { throw new Error('New transaction fee is not higher than the existing one'); }
        }

        // Second control : input > output
        const fee = TxValidation.calculateRemainingAmount(utxosByAnchor, transaction);

        // Calculate fee per byte
        transaction.byteWeight = Transaction_Builder.getTxWeight(transaction);
        transaction.feePerByte = (fee / transaction.byteWeight).toFixed(6);

        timings.first = Date.now() - timings.start;

        // Fourth validation: low computation cost.
        await TxValidation.controlTransactionOutputsRulesConditions(transaction);

        // Fifth validation: medium computation cost.
        await TxValidation.controlAllWitnessesSignatures(transaction);

        // Sixth validation: high computation cost. | this.knownPubKeysAddresses will be filled with new known pubKeys:address
        await TxValidation.addressOwnershipConfirmation(utxosByAnchor, transaction, this.knownPubKeysAddresses, this.useDevArgon2);
        timings.second = Date.now() - timings.start;
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${timings.second}ms (first: ${timings.first}ms)`);

        this.#addMempoolTransaction(transaction, collidingTx);
        //console.log(`[MEMPOOL] transaction: ${transaction.id} accepted in ${Date.now() - startTime}ms`);
    }
}