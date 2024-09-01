import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
import { Account } from './account.mjs';
import { Block } from './block.mjs';
import { Validation } from './validation.mjs';

export const uxtoRulesGlossary = {
    sig: { description: 'Simple signature verification' },
    sigOrSlash: { description: "Open right to slash the UTXO if validator's fraud proof is provided", withdrawLockBlocks: 144 },
    lockUntilBlock: { description: 'UTXO locked until block height', lockUntilBlock: 0 },
    multiSigCreate: { description: 'Multi-signature creation' },
    p2pExchange: { description: 'Peer-to-peer exchange' }
}

/**
 * @typedef {Object} TransactionIO
 * @property {number} amount - the amount of microConts
 * @property {string | undefined} address - output only
 * @property {string} rule - the unlocking rule
 * @property {number} version - the transaction version
 * @property {string | undefined} anchor - input only - the path to the UTXO blockHeight:txID:vout
 */
/** Transaction Input/Output data structure
 * @param {number} amount - the amount of microConts
 * @param {string | undefined} address - output only
 * @param {string} rule - the unlocking rule
 * @param {number} version - the transaction version
 * @param {string | undefined} anchor - input only - the path to the UTXO blockHeight:txID:vout
 * @returns {TransactionIO}
 **/
export const TransactionIO = (amount, rule, version, address, anchor) => {
    return {
        amount,
        rule,
        version,
        address,
        anchor
    };
}
export class TxIO_Builder {
    /**
     * @param {"input" | "output"} type
     * @param {number} amount
     * @param {string | undefined} address - output only
     * @param {string} rule
     * @param {number} version
     * @param {number | undefined} utxoBlockHeight - input only
     * @param {string | undefined} utxoTxID - input only
     * @param {number | undefined} vout - input only
     */
    static newIO(type, amount, rule, version, address, utxoBlockHeight, utxoTxID, vout) {
        const ruleName = rule.split('_')[0];
        if (uxtoRulesGlossary[ruleName] === undefined) { throw new Error('Invalid rule name'); }

        const anchor = utils.anchor.from_TransactionInputReferences(utxoBlockHeight, utxoTxID, vout);
        const newTxIO = TransactionIO(amount, rule, version, address, anchor);
        Validation.isValidTransactionIO(newTxIO, type);

        // delte all undefined properties
        for (const key in newTxIO) {
            if (newTxIO[key] === undefined) {
                delete newTxIO[key];
            }
        }
        
        return newTxIO;
    }
    /** @param {TransactionIO[]} TxIOs */
    static checkMalformedAnchors(TxIOs) {
        for (let i = 0; i < TxIOs.length; i++) {
            if (!utils.anchor.isValid(TxIOs[i].anchor)) {
                throw new Error(`UTXO anchor malformed in UTXO ${i}: ${TxIOs[i].anchor}`);
            }
        }
    }
    /** @param {TransactionIO[]} TxIOs */
    static checkDuplicateAnchors(TxIOs) {
        if (TxIOs.length === 0) { throw new Error('No UTXO to check'); }

        const anchors = TxIOs.map(TxIO => TxIO.anchor);
        if (utils.conditionnals.arrayIncludeDuplicates(anchors)) { throw new Error('Duplicate UTXO anchors in UTXOs'); }
    }
    /**
     * @param {TransactionIO[]} TxIOs
     * @returns {TransactionIO[]}
     */
    static cloneTxIO(TxIO) {
        const TxIOJSON = JSON.stringify(TxIO);
        return JSON.parse(TxIOJSON);
    }
}

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
    static async createCoinbaseTransaction(nonceHex, address, amount) {
        if (typeof nonceHex !== 'string') { throw new Error('Invalid nonceHex'); }
        if (typeof address !== 'string') { throw new Error('Invalid address'); }
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }

        const coinbaseOutput = TxIO_Builder.newIO('output', amount, 'sig_v1', 1, address);
        const inputs = [ nonceHex ];
        const outputs = [ coinbaseOutput ];

        return await this.newTransaction(inputs, outputs);
    }
    /**
     * @param {BlockData} blockCandidate
     * @param {string} address - who will receive the reward
     * @param {string} posStakedAddress - who will be slashed if fraud proof is provided
     */
    static async createPosRewardTransaction(blockCandidate, address, posStakedAddress) {
        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        const blockFees = Block.calculateTxsTotalFees(blockCandidate.Txs);
        if (typeof blockFees !== 'number') { throw new Error('Invalid blockFees'); }

        const posHashHex = await Block.getBlockSignature(blockCandidate, true);
        const posInput = `${posStakedAddress}:${posHashHex}`;
        const inputs = [ posInput ];
        const posOutput = TxIO_Builder.newIO('output', blockFees, 'sig_v1', 1, address);
        const outputs = [ posOutput ];

        return await this.newTransaction(inputs, outputs);
    }
    /** 
     * @param {Account} senderAccount
     * @param {{recipientAddress: string, amount: number}[]} transfers
     * @param {number} feePerByte // RANDOM IS TEMPORARY
     */
    static async createTransferTransaction(senderAccount, transfers, feePerByte = Math.round(Math.random() * 10) + 1 ) {
        const senderAddress = senderAccount.address;
        const UTXOs = senderAccount.UTXOs;
        if (UTXOs.length === 0) { throw new Error('No UTXO to spend'); }
        if (transfers.length === 0) { throw new Error('No transfer to make'); }
        
        TxIO_Builder.checkDuplicateAnchors(UTXOs);
        TxIO_Builder.checkMalformedAnchors(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom(transfers, 'sig_v1', 1);
        const estimatedWeight = Transaction_Builder.simulateTransactionToEstimateWeight(UTXOs, outputs);
        const { fee, change } = Transaction_Builder.calculateFeeAndChange(UTXOs, totalSpent, estimatedWeight, feePerByte);
        //console.log(`[TRANSACTION] fee: ${fee} microCont`);

        if (change !== 0) {
            const changeOutput = TxIO_Builder.newIO("output", change, 'sig_v1', 1, senderAddress);
            outputs.push(changeOutput);
        }

        if (utils.conditionnals.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return await this.newTransaction(UTXOs, outputs);
    }
    /** Create a transaction to stake new VSS - fee should be => amount to be staked
     * @param {Account} senderAccount
     * @param {string} stakingAddress
     * @param {number} amount
     * @param {number} feePerByte // RANDOM IS TEMPORARY
     */
    static async createStakingNewVssTransaction(senderAccount, stakingAddress, amount, feePerByte = Math.round(Math.random() * 10) + 1) {
        const senderAddress = senderAccount.address;
        const UTXOs = senderAccount.UTXOs;
        if (UTXOs.length === 0) { throw new Error('No UTXO to spend'); }

        TxIO_Builder.checkMalformedAnchors(UTXOs);
        TxIO_Builder.checkDuplicateAnchors(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom([{recipientAddress: stakingAddress, amount}], 'sigOrSlash', 1);
        const estimatedWeight = Transaction_Builder.simulateTransactionToEstimateWeight(UTXOs, outputs);

        const { fee, change } = Transaction_Builder.calculateFeeAndChange(UTXOs, totalSpent, estimatedWeight, feePerByte, amount);
        //console.log(`[TRANSACTION] fee: ${fee} microCont`);

        if (change !== 0) {
            const changeOutput = TxIO_Builder.newIO("output", change, 'sig_v1', 1, senderAddress);
            outputs.push(changeOutput);
        }

        if (utils.conditionnals.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return await this.newTransaction(UTXOs, outputs);
    }
    /**
     * @param {TransactionIO[]} inputs
     * @param {TransactionIO[]} outputs
     */
    static async newTransaction(inputs, outputs) {
        const transaction = Transaction(inputs, outputs);
        transaction.id = await Transaction_Builder.hashTxToGetID(transaction);
        return transaction;
    }
    /**
     * @param {TransactionIO[]} UTXOs
     * @param {TransactionIO[]} outputs
     */
    static simulateTransactionToEstimateWeight(UTXOs, outputs) {
        const change = 26_152_659_654_321;
        const changeOutput = TxIO_Builder.newIO("output", change, 'sig_v1', 1, 'Cv6XXKBTALRPSCzuU6k4');
        const outputsClone = TxIO_Builder.cloneTxIO(outputs);
        outputsClone.push(changeOutput);
        
        const transaction = Transaction(UTXOs, outputsClone, '0360bb18', ["6a6e432aaba4c7f241f9dcc9ea1c7df94e2533b53974182b86d3acd83029667cc940ce6eea166c97953789d169af562a54d6c96028a5ca7dba95047a15bfd20c:846a6a7c422c4b9a7e8600d3a14750c736b6ee6e7905a245eaa6c2c63ff93a5b"]);
        
        return Transaction_Builder.getWeightOfTransaction(transaction);
    }
    /** @param {Transaction} transaction */
    static getWeightOfTransaction(transaction) {
        const clone = Transaction_Builder.cloneTransaction(transaction);
        const compressedTx = utils.compression.msgpack_Zlib.transaction.toBinary_v1(clone);
        const transactionWeight = compressedTx.byteLength;
        return transactionWeight;
    }
    /**
     * @param {{recipientAddress: string, amount: number}[]} transfers
     * @param {string} rule
     * @param {number} version
     */
    static buildOutputsFrom(transfers = [{recipientAddress: 'recipientAddress', amount: 1}], rule = 'sig_v1', version = 1) {
        const outputs = [];
        let totalSpent = 0;

        for (let i = 0; i < transfers.length; i++) {
            const { recipientAddress, amount} = transfers[i];
            const output = TxIO_Builder.newIO('output', amount, rule, version, recipientAddress);
            outputs.push(output);
            totalSpent += amount;
        }

        return { outputs, totalSpent };
    }
    /**
     * @param {TransactionIO[]} UTXOs
     * @param {number} totalSpent
     * @param {number} estimatedWeight
     * @param {number} feePerByte
     * @param {number} feeSupplement
     */
    static calculateFeeAndChange(UTXOs, totalSpent, estimatedWeight, feePerByte, feeSupplement = 0) {
        if (feePerByte < utils.blockchainSettings.minTransactionFeePerByte) { throw new Error(`Invalid feePerByte: ${feePerByte}`); }
        const totalInputAmount = UTXOs.reduce((a, b) => a + b.amount, 0);

        const remainingAmount = totalInputAmount - totalSpent;
        if (remainingAmount <= 0) { throw new Error(`Not enough funds: ${totalInputAmount} - ${totalSpent} = ${remainingAmount}`); }

        const fee = (feePerByte * estimatedWeight) + feeSupplement;
        if (fee % 1 !== 0) {
            throw new Error('Invalid fee: not integer'); }
        if (fee <= 0) {
            throw new Error(`Invalid fee: ${fee} <= 0`); }

        const change = remainingAmount - fee;
        
        // Tx will consume all funds, then fee is the remaining amount, and change is 0
        if (change <= 0) { return { fee: remainingAmount, change: 0 }; }
        //if (change <= 0) { throw new Error('(change <= 0) not enough funds'); }

        return { fee, change };
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
    static getTransactionJSON(transaction) { // DEPRECATED
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

    // Faster methods
    /**
     * @param {Account} senderAccount
     * @param {number} amount
     * @param {string} recipientAddress
     */
    static async createAndSignTransferTransaction(senderAccount, amount, recipientAddress) {
        try {
            const transfer = { recipientAddress, amount };
            const transaction = await Transaction_Builder.createTransferTransaction(senderAccount, [transfer]);
            const signedTx = await senderAccount.signTransaction(transaction);
    
            return { signedTx, error: false };
        } catch (error) {
            /** @type {string} */
            const errorMessage = error.stack;
            return { signedTx: false, error: errorMessage };
        }
    }
}