import { Transaction, TransactionIO, Transaction_Builder, TxIO_Builder } from './transaction.mjs';
import { BlockMiningData } from './block.mjs';
import utils from './utils.mjs';

export class UtxoCache { // Used to store, addresses's UTXOs and balance.
    constructor() {
        /** @type {Object<string, TransactionIO[]>} */
        this.addressesUTXOs = {};
        /** @type {Object<string, number>} */
        this.addressesBalances = {};
        /** @type {Object<string, TransactionIO>} */
        this.UTXOsByPath = {};

        /** @type {Object<string, object>} */
        this.branches = {};

        /** @type {BlockMiningData[]} */
        this.blockMiningData = []; // just for .csv mining datas research
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
        // console.log(`[utxoCache]=> UTXO removed: ${utxoBlockHeight} - ${utxoTxID} - ${vout} | owner: ${address}`);
    }
    /**
     * @param {number} blockIndex
     * @param {Transaction} transaction
     */
    #digestTransactionOutputs(blockIndex, transaction) {
        const newStakeOutputs = [];
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
                newStakeOutputs.push(TxOutputs[i]); // for now we only create new range
            }
        }

        return newStakeOutputs;
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
            const newStakeOutputs = this.#digestTransactionOutputs(blockIndex, transaction);
            if (newStakeOutputs.length > 0) { this.vss.newStake(TxOutputs[i]); }
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