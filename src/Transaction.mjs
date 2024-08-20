import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
import { Account,TxIO_Builder,Block } from './index.mjs';

const Transaction = (inputs, outputs, id = '', witnesses = []) => {
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

        const coinbaseOutput = TxIO_Builder.newIO('output', amount, 'signature_v1', 1, address);
        const inputs = [ nonceHex ];
        const outputs = [ coinbaseOutput ];

        return Transaction(inputs, outputs);
    }
    /**
     * @param {BlockData} blockCandidate
     * @param {string} address
     */
    static async createPosRewardTransaction(blockCandidate, address) {
        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        const blockFees = Block.calculateTxsTotalFees(blockCandidate.Txs);
        if (typeof blockFees !== 'number') { throw new Error('Invalid blockFees'); }

        const posInput = await Block.calculateValidatorHash(blockCandidate);
        const inputs = [ posInput ];
        const posOutput = TxIO_Builder.newIO('output', blockFees, 'signature_v1', 1, address);
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

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom(transfers, 'signature_v1', 1);
        const totalInputAmount = UTXOs.reduce((a, b) => a + b.amount, 0);

        const fee = 1_000_000; // TODO: calculate the fee
        const change = totalInputAmount - totalSpent - fee;
        if (change < 0) { 
            throw new Error('Negative change => not enough funds'); 
        } else if (change > 0) {
            const changeOutput = TxIO_Builder.newIO("output", change, 'signature_v1', 1, senderAddress);
            outputs.push(changeOutput);
        }

        if (TxIO_Scripts.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return Transaction(UTXOs, outputs);
    }
    /**
     * @param {{recipientAddress: string, amount: number}[]} transfers
     * @param {string} script
     * @param {number} version
     */
    static buildOutputsFrom(transfers = [{recipientAddress: 'recipientAddress', amount: 1,}], script = 'signature_v1', version = 1) {
        const outputs = [];
        const totalAmount = [];

        for (let i = 0; i < transfers.length; i++) {
            const { recipientAddress, amount} = transfers[i];
            const output = TxIO_Builder.newIO('output', amount, script, version, recipientAddress);
            outputs.push(output);
            totalAmount.push(amount);
        }

        const totalSpent = totalAmount.reduce((a, b) => a + b, 0);

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
    static transactionFromJSON(transactionJSON) {
        return JSON.parse(transactionJSON);
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