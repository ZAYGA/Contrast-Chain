import { Transaction, TransactionIO, Transaction_Builder, TxIO_Builder } from './transaction.mjs';
import { BlockMiningData } from './block.mjs';
import utils from './utils.mjs';
import { txValidation } from './validation.mjs';

/**
* @typedef {import("./block.mjs").BlockData} BlockData
*/

export class UtxoCache { // Used to store, addresses's UTXOs and balance.
    constructor(addressesUTXOs = {}, addressesBalances = {}, utxosByAnchor = {}, blockMiningData = []) {
        this.bypassValidation = false;
        /** @type {Object<string, TransactionIO[]>} */
        this.addressesUTXOs = addressesUTXOs;
        /** @type {Object<string, number>} */
        this.addressesBalances = addressesBalances;
        /** @type {Object<string, TransactionIO>} */
        this.utxosByAnchor = utxosByAnchor; // UTXO by anchor

        /** @type {BlockMiningData[]} */
        this.blockMiningData = blockMiningData; // .csv mining datas research
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
        if (Transaction_Builder.isCoinBaseOrFeeTransaction(transaction, TxIndexInTheBlock)) { return } // coinbase -> no input

        const TxInputs = transaction.inputs;
        TxIO_Builder.checkMalformedAnchors(TxInputs);
        TxIO_Builder.checkDuplicateAnchors(TxInputs);

        for (let i = 0; i < TxInputs.length; i++) {
            const anchor = TxInputs[i].anchor;
            const { address, amount } = this.utxosByAnchor[anchor];

            this.#removeUTXO(address, anchor);
            this.#changeBalance(address, -amount);
        }

        return true;
    }
    /**
     * @param {string} address
     * @param {string} anchor
     */
    #removeUTXO(address, anchor) {
        // remove from addressesUTXOs
        if (this.addressesUTXOs[address] === undefined) { throw new Error(`${address} has no UTXOs`); }

        const addressUtxoIndex = this.addressesUTXOs[address].findIndex(utxoInArray => utxoInArray.anchor === anchor);
        if (addressUtxoIndex === -1) { throw new Error(`${address} isn't owning UTXO: ${anchor}`); }

        this.addressesUTXOs[address].splice(addressUtxoIndex, 1);
        if (this.addressesUTXOs[address].length === 0) { delete this.addressesUTXOs[address]; }

        delete this.utxosByAnchor[anchor];
        // console.log(`[utxoCache]=> UTXO removed: ${utxoBlockHeight} - ${utxoTxID} - ${vout} | owner: ${address}`);
    }
    /**
     * @param {number} blockIndex
     * @param {Transaction} transaction
     */
    #digestTransactionOutputs(blockIndex, transaction) {
        const newStakesOutputs = [];
        const TxID = transaction.id;
        const TxOutputs = transaction.outputs;
        for (let i = 0; i < TxOutputs.length; i++) {
            const output = TxOutputs[i];
            const { address, amount } = output;
            if (amount === 0) { continue; } // no need to add UTXO with 0 amount

            // UXTO would be used as input, then we set (blockIndex, utxoTxID, and vout) => anchor
            const anchor = utils.anchor.fromReferences(blockIndex, TxID, i);
            if (!utils.anchor.isValid(anchor)) { throw new Error(`Invalid UTXO anchor: ${anchor}`); }

            output.anchor = anchor;

            if (this.addressesUTXOs[address] === undefined) { this.addressesUTXOs[address] = []; }
            this.addressesUTXOs[address].push(output);
            this.utxosByAnchor[anchor] = output;
            this.#changeBalance(address, amount);

            if (output.rule === "sigOrSlash") {
                if (i !== 0) { throw new Error('sigOrSlash must be the first output'); }
                if (txValidation.calculateRemainingAmount(transaction) < output.amount) { throw new Error('SigOrSlash requires fee > amount'); }
                newStakesOutputs.push(output); // for now we only create new range
            }
        }

        return newStakesOutputs;
    }
    /**
    * @param {number} blockIndex
    * @param {Transaction[]} Txs
    */
    #digestFinalizedBlockTransactions(blockIndex, Txs) {
        if (!Array.isArray(Txs)) { throw new Error('Txs is not an array'); }
        //console.log(`Digesting block ${blockIndex} with ${Txs.length} transactions`);
        const newStakesOutputs = [];

        for (let i = 0; i < Txs.length; i++) {
            const transaction = Txs[i];
            this.#digestTransactionInputs(transaction, i); // Reverse function's call ?
            const newStakesOutputsFromTx = this.#digestTransactionOutputs(blockIndex, transaction);
            newStakesOutputs.push(...newStakesOutputsFromTx);
        }

        return newStakesOutputs;
    }

    // Public methods
    /** @param {BlockData[]} blocksData */
    async digestFinalizedBlocks(blocksData) {
        try {
            const newStakesOutputs = [];
            for (let i = 0; i < blocksData.length; i++) {
                const blockData = blocksData[i];
                const Txs = blockData.Txs;
                const newStakesOutputsFromBlock = this.#digestFinalizedBlockTransactions(blockData.index, Txs);

                const supplyFromBlock = blockData.supply;
                const coinBase = blockData.coinBase;
                const totalSupply = supplyFromBlock + coinBase;
                const totalOfBalances = this.#calculateTotalOfBalances();

                if (totalOfBalances !== totalSupply && this.bypassValidation === false) {
                    console.warn(`digestPowProposal rejected: blockIndex: ${blockData.index} | legitimacy: ${blockData.legitimacy}`);
                    return false;
                }
                //console.info(`supplyFromBlock+coinBase: ${utils.convert.number.formatNumberAsCurrency(totalSupply)} - totalOfBalances: ${utils.convert.number.formatNumberAsCurrency(totalOfBalances)}`);

                this.blockMiningData.push({ index: blockData.index, difficulty: blockData.difficulty, timestamp: blockData.timestamp, posTimestamp: blockData.posTimestamp });
                newStakesOutputs.push(...newStakesOutputsFromBlock);
            }

            return newStakesOutputs;
        } catch (error) {
            console.error(error);
            return false;
        }

    }
    /** @param {string} address */
    getBalanceAndUTXOs(address) {
        // clone values to avoid modification
        /** @type {number} */
        const balance = this.addressesBalances[address] ? JSON.parse(JSON.stringify(this.addressesBalances[address])) : 0;
        const UTXOs = [];
        if (this.addressesUTXOs[address]) {
            for (let i = 0; i < this.addressesUTXOs[address].length; i++) {
                const clone = TxIO_Builder.cloneTxIO(this.addressesUTXOs[address][i]);
                delete clone.address; // if you wanna keep the address, comment this line
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
            const rule = UTXOs[i].rule;
            if (rule === "sigOrSlash") {
                spendableBalance -= UTXOs[i].amount;
                UTXOs.splice(i, 1);
                i--;
            }
        }

        return { spendableBalance, balance, UTXOs };
    }
}