import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
import { TxValidation } from './validation.mjs';
import { BlockUtils } from './block.mjs';

/**
 * @typedef {import('./account.mjs').Account} Account
 * @typedef {import('./block.mjs').BlockData} BlockData
 */

export class TxIO_Builder {
    /**
     * @param {number} amount
     * @param {string} address
     * @param {string} rule
     */
    static newOutput(amount, rule, address) {
        const txOutput = TxOutput(amount, rule, address);
        TxValidation.isValidTxOutput(txOutput);
        
        return txOutput;
    }
    /** @param {string} anchor */
    static newInput(anchor) {
        const txInput = TxInput(anchor);
        return txInput;
    }
    /**
     * @param {string} anchor
     * @param {number} amount
     * @param {string} rule
     * @param {string} address
     */
    static newUTXO(anchor, amount, rule, address) {
        const newUtxo = UTXO(anchor, amount, rule, address);
        // UTXO can't have undefined amount, rule and address
        for (const key in newUtxo) { if (newUtxo[key] === undefined) { 
            console.log(`invalid UTXO key: ${key}`); return false } }
        
        return newUtxo;
    }
    /** @param {TxOutput | TxInput | UTXO | TxOutput[] | TxInput[] | UTXO[]} TxIO */
    static cloneTxIO(TxIO) {
        const TxIOJSON = JSON.stringify(TxIO);
        /** @type {TxOutput | TxInput | UTXO | TxOutput[] | TxInput[] | UTXO[]} */
        const clone = JSON.parse(TxIOJSON);
        return clone;
    }
}

/**
 * @typedef {Object} TxOutput
 * @property {number} amount - the amount of microConts
 * @property {string} address - output only
 * @property {string} rule - the unlocking rule
 */
/** Transaction Input/Output data structure
 * @param {number} amount - the amount of microConts
 * @param {string} address - output only
 * @param {string} rule - the unlocking rule
 * @returns {TxOutput}
 **/
export const TxOutput = (amount, rule, address) => {
    return {
        amount,
        rule,
        address
    };
}
/** @typedef {string} TxInput - the path to the UTXO blockHeight:txID:vout */
/** @param {string} anchor - the path to the UTXO blockHeight:txID:vout */
export const TxInput = (anchor) => { return anchor; }
/**
 * @typedef {Object} UTXO
 * @property {string} anchor - the path to the UTXO blockHeight:txID:vout
 * @property {number} amount - the amount of microConts
 * @property {string} rule - the unlocking rule
 * @property {string} address - the address of the recipient
 * @returns {UTXO}
 */
/** Unspent Transaction Output data structure
 * @param {string} anchor - the path to the UTXO blockHeight:txID:vout
 * @param {number} amount - the amount of microConts
 * @param {string} rule - the unlocking rule
 * @param {string} address - the address of the recipient
 * @returns {UTXO}
 */
export const UTXO = (anchor, amount, rule, address) => {
    return { anchor, amount, rule, address };
}

/**
 * @typedef {Object} Transaction
 * @property {string} id
 * @property {string[]} witnesses
 * @property {number} version
 * @property {TxInput[]} inputs
 * @property {TxOutput[]} outputs
 * @property {number | undefined} feePerByte - only in mempool
 * @property {number | undefined} byteWeight - only in mempool
 */
/** Transaction data structure
 * @param {TxInput[]} inputs
 * @param {TxOutput[]} outputs
 * @param {string} id
 * @param {string[]} witnesses
 * @param {number} version
 * @returns {Transaction}
 */
export const Transaction = (inputs, outputs, id = '', witnesses = [], version = 1) => {
    return {
        id,
        witnesses,
        version,
        inputs,
        outputs
    };
}
export class Transaction_Builder {
    /** @param {UTXO[]} utxos */
    static checkMalformedAnchorsInUtxosArray(utxos) {
        for (const utxo of utxos) {
            if (!utils.types.anchor.isConform(utxo.anchor)) { throw new Error(`UTXO anchor malformed in UTXO: ${utxo.anchor}`); }
        }
    }
    /** @param {UTXO[]} utxos */
    static checkDuplicateAnchorsInUtxosArray(utxos) {
        if (utxos.length === 0) { throw new Error('No UTXO to check'); }

        const anchors = utxos.map(utxo => utxo.anchor);
        if (utils.conditionnals.arrayIncludeDuplicates(anchors)) { throw new Error('Duplicate UTXO anchors in UTXOs'); }
    }
    /**
     * @param {string} nonceHex
     * @param {string} address 
     * @param {number} amount
     */
    static async createCoinbaseTransaction(nonceHex, address, amount) {
        if (typeof nonceHex !== 'string') { throw new Error('Invalid nonceHex'); }
        if (typeof address !== 'string') { throw new Error('Invalid address'); }
        if (typeof amount !== 'number') { throw new Error('Invalid amount'); }

        const coinbaseOutput = TxIO_Builder.newOutput(amount, 'sig_v1', address);
        const inputs = [ nonceHex ];
        const outputs = [ coinbaseOutput ];

        const transaction = Transaction(inputs, outputs);
        transaction.id = await Transaction_Builder.hashTxToGetID(transaction);

        return transaction;
    }
    /**
     * @param {Object<string, UTXO>} utxosByAnchor
     * @param {number} posReward
     * @param {BlockData} blockCandidate
     * @param {string} address - who will receive the reward
     * @param {string} posStakedAddress - who will be slashed if fraud proof is provided
     */
    static async createPosRewardTransaction(posReward, blockCandidate, address, posStakedAddress) {
        if (typeof address !== 'string') { throw new Error('Invalid address'); }

        const posHashHex = await BlockUtils.getBlockSignature(blockCandidate, true);
        const posInput = `${posStakedAddress}:${posHashHex}`;
        const inputs = [ posInput ];
        const posOutput = TxIO_Builder.newOutput(posReward, 'sig_v1', address);
        const outputs = [ posOutput ];

        const transaction = Transaction(inputs, outputs);
        transaction.id = await Transaction_Builder.hashTxToGetID(transaction);

        return transaction;
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
        
        this.checkMalformedAnchorsInUtxosArray(UTXOs);
        this.checkDuplicateAnchorsInUtxosArray(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom(transfers, 'sig_v1', 1);
        const estimatedWeight = Transaction_Builder.simulateTransactionToEstimateWeight(UTXOs, outputs);
        const { fee, change } = Transaction_Builder.calculateFeeAndChange(UTXOs, totalSpent, estimatedWeight, feePerByte);
        //console.log(`[TRANSACTION] fee: ${fee} microCont`);

        if (change !== 0) {
            const changeOutput = TxIO_Builder.newOutput(change, 'sig_v1', senderAddress);
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

        this.checkMalformedAnchorsInUtxosArray(UTXOs);
        this.checkDuplicateAnchorsInUtxosArray(UTXOs);

        const { outputs, totalSpent } = Transaction_Builder.buildOutputsFrom([{recipientAddress: stakingAddress, amount}], 'sigOrSlash', 1);
        const estimatedWeight = Transaction_Builder.simulateTransactionToEstimateWeight(UTXOs, outputs);

        const { fee, change } = Transaction_Builder.calculateFeeAndChange(UTXOs, totalSpent, estimatedWeight, feePerByte, amount);
        //console.log(`[TRANSACTION] fee: ${fee} microCont`);

        if (change !== 0) {
            const changeOutput = TxIO_Builder.newOutput(change, 'sig_v1', senderAddress);
            outputs.push(changeOutput);
        }

        if (utils.conditionnals.arrayIncludeDuplicates(outputs)) { throw new Error('Duplicate outputs'); }
        
        return await this.newTransaction(UTXOs, outputs);
    }
    /**
     * @param {UTXO[]} utxos
     * @param {TxOutput[]} outputs
     */
    static async newTransaction(utxos, outputs) {
        const inputs = utxos.map(utxo => utxo.anchor);
        const transaction = Transaction(inputs, outputs);
        transaction.id = await Transaction_Builder.hashTxToGetID(transaction);

        return transaction;
    }
    /**
     * @param {UTXO[]} utxos
     * @param {TxOutput[]} outputs
     */
    static simulateTransactionToEstimateWeight(utxos, outputs, nbOfSigners = 1) {
        const change = 26_152_659_654_321;
        const changeOutput = TxIO_Builder.newOutput(change, 'sig_v1', 'Cv6XXKBTALRPSCzuU6k4');
        const outputsClone = TxIO_Builder.cloneTxIO(outputs);
        outputsClone.push(changeOutput);
        
        const inputs = utxos.map(utxo => utxo.anchor);
        const witnesses = [];
        for (let i = 0; i < nbOfSigners; i++) { witnesses.push("6a6e432aaba4c7f241f9dcc9ea1c7df94e2533b53974182b86d3acd83029667cc940ce6eea166c97953789d169af562a54d6c96028a5ca7dba95047a15bfd20c:846a6a7c422c4b9a7e8600d3a14750c736b6ee6e7905a245eaa6c2c63ff93a5b"); }
        const transaction = Transaction(inputs, outputsClone, '0360bb18', witnesses);
        
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
    static buildOutputsFrom(transfers = [{recipientAddress: 'recipientAddress', amount: 1}], rule = 'sig_v1') {
        const outputs = [];
        let totalSpent = 0;

        for (let i = 0; i < transfers.length; i++) {
            const { recipientAddress, amount} = transfers[i];
            const output = TxIO_Builder.newOutput(amount, rule, recipientAddress);
            outputs.push(output);
            totalSpent += amount;
        }

        return { outputs, totalSpent };
    }
    /**
     * @param {UTXO[]} utxos
     * @param {number} totalSpent
     * @param {number} estimatedWeight
     * @param {number} feePerByte
     * @param {number} feeSupplement
     */
    static calculateFeeAndChange(utxos, totalSpent, estimatedWeight, feePerByte, feeSupplement = 0) {
        if (feePerByte < utils.SETTINGS.minTransactionFeePerByte) { throw new Error(`Invalid feePerByte: ${feePerByte}`); }
        const totalInputAmount = utxos.reduce((a, b) => a + b.amount, 0);

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
        const inputsStr = JSON.stringify(transaction.inputs);
        const outputsStr = JSON.stringify(transaction.outputs);
        const versionStr = JSON.stringify(transaction.version);

        //const message = utils.convert.string.toHex(`${inputsStr}${outputsStr}`);
        //const hashHex = await HashFunctions.SHA256(message);
        const hashHex = await HashFunctions.SHA256(`${inputsStr}${outputsStr}${versionStr}`);
        return hashHex.slice(0, hashHexLength);
    }
    /** @param {Transaction} transaction */
    static isMinerOrValidatorTx(transaction) {
        if (transaction.inputs.length !== 1) { return false; }
        if (transaction.inputs[0].length === 8) { return true; } // nonce length is 8
        if (transaction.inputs[0].length === 20 + 1 + 64) { return true; } // address length 20 + : + posHash length is 64

        return false;
    }
    /** @param {Transaction} transaction */
    static isIncriptionTransaction(transaction) {
        if (transaction.outputs.length !== 1) { return false; }
        return typeof transaction.outputs[0] === 'string';
    }
    /** @param {Transaction} transaction */
    static cloneTransaction(transaction) {
        //const inputs = TxIO_Builder.cloneTxIO(transaction.inputs); // heavy JSON parsing
        const inputs = transaction.inputs.slice();
        const outputs = TxIO_Builder.cloneTxIO(transaction.outputs);
        const witnesses = transaction.witnesses.slice();

        return Transaction(inputs, outputs, transaction.id, witnesses, transaction.version);
    }

    // Multi-functions methods
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