import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
//import { Account, TransactionIO, TxIO_Builder, Block, TxIO_Scripts } from './index.mjs';
import { Account } from './Account.mjs';
import { Block } from './Block.mjs';
import { TransactionIO, TxIO_Builder, TxIO_Scripts } from './TxIO.mjs';

/**
 * @typedef {Object} Transaction
 * @property {TransactionIO[]} inputs
 * @property {TransactionIO[]} outputs
 * @property {string} id
 * @property {string[]} witnesses
 * @property {number | undefined} feePerByte - only in mempool
 * @property {number | undefined} byteWeight - only in mempool
 */
/** Transaction data structure
 * @param {TransactionIO[]} inputs
 * @param {TransactionIO[]} outputs
 * @param {string} id
 * @param {string[]} witnesses
 * @returns {Transaction}
 */
export const Transaction = (inputs, outputs, id = '', witnesses = []) => {
    return {
        id,
        witnesses,
        inputs,
        outputs
    };
}
export class Transaction_Builder {
    /**
     * @param {string} nonceHex
     * @param {string} address 
     * @param {number} amount
     */
    static createCoinbaseTransaction(nonceHex, address, amount) {
        if (typeof nonceHex !== 'string') { throw new Error('Invalid nonceHex'); }
        if (typeof address !== 'string') { throw new Error('Invalid address'); }
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }

        const coinbaseOutput = TxIO_Builder.newIO('output', amount, 'sig_v1', 1, address);
        const inputs = [ nonceHex ];
        const outputs = [ coinbaseOutput ];

        return Transaction(inputs, outputs);
    }
    /**
     * @param {BlockData} blockCandidate
     * @param {string} address
     */
    static async createPosRewardTransaction(blockCandidate, address, posStakedAddress) {
        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        const blockFees = Block.calculateTxsTotalFees(blockCandidate.Txs);
        if (typeof blockFees !== 'number') { throw new Error('Invalid blockFees'); }

        const validatorHash = await Block.calculateValidatorHash(blockCandidate);
        const posInput = `${posStakedAddress}:${validatorHash}`;
        const inputs = [ posInput ];
        const posOutput = TxIO_Builder.newIO('output', blockFees, 'sig_v1', 1, address);
        const outputs = [ posOutput ];

        return Transaction(inputs, outputs);
    }
    /** @param {Account} senderAccount */
    static createTransferTransaction(
        senderAccount,
        transfers = [ { recipientAddress: 'recipientAddress', amount: 1 } ]
    ) {
        const senderAddress = senderAccount.address;
        const UTXOs = senderAccount.UTXOs;
        if (UTXOs.length === 0) { throw new Error('No UTXO to spend'); }
        if (transfers.length === 0) { throw new Error('No transfer to make'); }
        
        TxIO_Builder.checkMissingTxID(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom(transfers, 'sig_v1', 1);
        const totalInputAmount = UTXOs.reduce((a, b) => a + b.amount, 0);

        const remainingAmount = totalInputAmount - totalSpent;
        if (remainingAmount <= 0) { 
            throw new Error(`Not enough funds: ${totalInputAmount} - ${totalSpent} = ${remainingAmount}`); }

        // logic of fee estimation will be removed in the future
        const estimatedWeight = Transaction_Builder.simulateTransactionToEstimateWeight(UTXOs, outputs);
        const feePerByte = Math.round(Math.random() * 10) + 1; // temporary
        const fee = feePerByte * estimatedWeight;
        if (fee % 1 !== 0) {
            throw new Error('Invalid fee: not integer'); }
        if (fee <= 0) {
            throw new Error(`Invalid fee: ${fee} <= 0`); }
        
        console.log(`[TRANSACTION] fee: ${fee} microCont`);

        const change = remainingAmount - fee;
        if (change <= 0) {
            throw new Error('(change <= 0) not enough funds');
        } else if (change > 0) {
            const changeOutput = TxIO_Builder.newIO("output", change, 'sig_v1', 1, senderAddress);
            outputs.push(changeOutput);
        }

        if (utils.conditionnals.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return Transaction(UTXOs, outputs);
    }
    /** @param {TransactionIO[]} UTXOs */
    static getTotalUTXOsAmount(UTXOs) { // DEPRECATED ??
        let totalAmount = 0;
        for (let i = 0; i < UTXOs.length; i++) {
            totalAmount += UTXOs[i].amount;
        }
        return totalAmount;
    }
    static simulateTransactionToEstimateWeight(UTXOs, outputs) {
        const change = 26_152_659_654_321;
        const changeOutput = TxIO_Builder.newIO("output", change, 'sig_v1', 1, 'Cv6XXKBTALRPSCzuU6k4');
        const outputsClone = TxIO_Builder.cloneTxIO(outputs);
        outputsClone.push(changeOutput);
        
        const transaction = Transaction(UTXOs, outputsClone, '0360bb18', ["6a6e432aaba4c7f241f9dcc9ea1c7df94e2533b53974182b86d3acd83029667cc940ce6eea166c97953789d169af562a54d6c96028a5ca7dba95047a15bfd20c:846a6a7c422c4b9a7e8600d3a14750c736b6ee6e7905a245eaa6c2c63ff93a5b"]);
        
        return Transaction_Builder.getWeightOfTransaction(transaction);
    }
    static getWeightOfTransaction(transaction) {
        const clone = Transaction_Builder.cloneTransaction(transaction);
        const compressedTx = utils.compression.transaction.toBinary_v1(clone);
        const transactionWeight = compressedTx.byteLength;
        console.log(`[TRANSACTION] weight: ${transactionWeight} bytes`);
        return transactionWeight;
    }
    /**
     * @param {{recipientAddress: string, amount: number}[]} transfers
     * @param {string} script
     * @param {number} version
     */
    static buildOutputsFrom(transfers = [{recipientAddress: 'recipientAddress', amount: 1}], script = 'sig_v1', version = 1) {
        const outputs = [];
        let totalSpent = 0;

        for (let i = 0; i < transfers.length; i++) {
            const { recipientAddress, amount} = transfers[i];
            const output = TxIO_Builder.newIO('output', amount, script, version, recipientAddress);
            outputs.push(output);
            totalSpent += amount;
        }

        return { outputs, totalSpent };
    }
    /** @param {Transaction} transaction */
    static async hashTxToGetID(transaction, hashHexLength = 8) {
        const message = Transaction_Builder.getTransactionStringToHash(transaction);
        const hashHex = await HashFunctions.SHA256(message);
        return hashHex.slice(0, hashHexLength);
    }
    /** @param {Transaction} transaction */
    static getTransactionStringToHash(transaction) {
        const inputsStr = JSON.stringify(transaction.inputs);
        const outputsStr = JSON.stringify(transaction.outputs);
        
        const stringHex = utils.convert.string.toHex(`${inputsStr}${outputsStr}`);
        return stringHex;
    }
    /** 
     * @param {Transaction} transaction
     * @param {number} TxIndexInTheBlock
     */
    static isCoinBaseOrFeeTransaction(transaction, TxIndexInTheBlock) {
        if (transaction.inputs.length !== 1) { return false; }
        if (TxIndexInTheBlock !== 0 && TxIndexInTheBlock !== 1) { return false; }
        
        return typeof transaction.inputs[0] === 'string';
    }
    /** @param {Transaction} transaction */
    static isIncriptionTransaction(transaction) {
        if (transaction.outputs.length !== 1) { return false; }
        return typeof transaction.outputs[0] === 'string';
    }
    /** @param {Transaction} transaction */
    static getTransactionJSON(transaction) {
        return JSON.stringify(transaction)
    }
    /** @param {string} transactionJSON */
    static transactionFromJSON(transactionJSON) {
        /** @type {Transaction} */
        const transaction = JSON.parse(transactionJSON);
        return transaction;
    }
    /** @param {Transaction} transaction */
    static cloneTransaction(transaction) {
        const inputs = TxIO_Builder.cloneTxIO(transaction.inputs);
        const outputs = TxIO_Builder.cloneTxIO(transaction.outputs);
        const witnesses = transaction.witnesses.slice();

        return Transaction(inputs, outputs, transaction.id, witnesses);
    }

    /**
     * @param {Account} senderAccount
     * @param {number} amount
     * @param {string} recipientAddress
     * @returns promise {{signedTxJSON: string | false, error: false | string}}
     */
    static async createAndSignTransferTransaction(senderAccount, amount, recipientAddress) {
        try {
            const transfer = { recipientAddress, amount };
            const transaction = Transaction_Builder.createTransferTransaction(senderAccount, [transfer]);
            const signedTx = await senderAccount.signAndReturnTransaction(transaction);
            signedTx.id = await Transaction_Builder.hashTxToGetID(signedTx);
    
            return { signedTxJSON: Transaction_Builder.getTransactionJSON(signedTx), error: false };
        } catch (error) {
            /** @type {string} */
            const errorMessage = error.stack;
            return { signedTxJSON: false, error: errorMessage };
        }
    }
}