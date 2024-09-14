import { Transaction, UTXO, Transaction_Builder, TxIO_Builder } from './transaction.mjs';
import { BlockMiningData } from './block.mjs';
import utils from './utils.mjs';
import { TxValidation } from './validation.mjs';

/**
* @typedef {import("./block.mjs").BlockData} BlockData
*/

export class UtxoCache { // Used to store, addresses's UTXOs and balance.
    constructor(addressesUTXOs = {}, addressesBalances = {}, utxosByAnchor = {}, blockMiningData = []) {
        this.bypassValidation = false;
        /** @type {Object<string, UTXO[]>} */
        this.addressesUTXOs = addressesUTXOs; // this object contain an array of UTXOs for each address that can be sent to the network
        /** @type {Object<string, number>} */
        this.addressesBalances = addressesBalances;
        /** @type {Object<string, UTXO>} */
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
        if (Transaction_Builder.isMinerOrValidatorTx(transaction, TxIndexInTheBlock)) { return }

        for (const input of transaction.inputs) {
            const anchor = input;
            if (!utils.types.anchor.isConform(anchor)) { throw new Error('Invalid anchor'); }
            
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
            TxValidation.isConformOutput(output); // throw if invalid

            const { address, amount, rule } = output;
            const anchor = `${blockIndex}:${TxID}:${i}`
            if (!utils.types.anchor.isConform(anchor)) { throw new Error(`Invalid UTXO anchor: ${anchor}`); }

            const utxo = TxIO_Builder.newUTXO(anchor, amount, rule, address);
            if (!utxo) { throw new Error('Invalid UTXO'); }

            if (rule === "sigOrSlash") {
                if (i !== 0) { throw new Error('sigOrSlash must be the first output'); }
                const remainingAmount = TxValidation.calculateRemainingAmount(this.utxosByAnchor, transaction);
                if (remainingAmount < output.amount) { throw new Error('SigOrSlash requires fee > amount'); }
                newStakesOutputs.push(utxo); // for now we only create new range
            }

            if (this.addressesUTXOs[address] === undefined) { this.addressesUTXOs[address] = []; }
            this.addressesUTXOs[address].push(utxo);
            this.utxosByAnchor[anchor] = utxo;
            this.#changeBalance(address, amount);
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
            const newStakesOutputsFromTx = this.#digestTransactionOutputs(blockIndex, transaction);
            this.#digestTransactionInputs(transaction, i);
            newStakesOutputs.push(...newStakesOutputsFromTx);
        }

        return newStakesOutputs;
    }

    // Public methods
    /** @param {BlockData[]} blocksData */
    async digestFinalizedBlocks(blocksData) {
        try {
            const newStakesOutputs = [];
            for (const blockData of blocksData) {
                const Txs = blockData.Txs;
                const newStakesOutputsFromBlock = this.#digestFinalizedBlockTransactions(blockData.index, Txs);

                const supplyFromBlock = blockData.supply;
                const coinBase = blockData.coinBase;
                const totalSupply = supplyFromBlock + coinBase;
                const totalOfBalances = this.#calculateTotalOfBalances();

                if (totalOfBalances !== totalSupply && this.bypassValidation === false) {
                    console.warn(`digestPowProposal rejected: blockIndex: ${blockData.index} | legitimacy: ${blockData.legitimacy} | supplyFromBlock+coinBase: ${utils.convert.number.formatNumberAsCurrency(totalSupply)} - totalOfBalances: ${utils.convert.number.formatNumberAsCurrency(totalOfBalances)}`);
                    console.warn(`INVALID TOTAL SUPPLY !== TOTAL OF BALANCES`);
                    console.warn(`INVALID TOTAL SUPPLY !== TOTAL OF BALANCES`);
                    console.warn(`INVALID TOTAL SUPPLY !== TOTAL OF BALANCES`);
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
        /** @type {UTXO[]} */
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