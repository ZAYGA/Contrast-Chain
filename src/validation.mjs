import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import { Transaction, TransactionIO, Transaction_Builder } from './transaction.mjs';
import { BlockUtils } from './block.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./block.mjs").BlockData} BlockData
 */

export class txValidation {
    /** ==> First validation, low computation cost.
     * 
     * - control format of : amount, address, rule, version, TxID, available UTXOs
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     * @param {boolean} isCoinBase
     */
    static isConformTransaction(utxosByAnchor, transaction, isCoinBase) {
        if (!transaction) { throw new Error('Invalid transaction'); }
        if (typeof transaction.id !== 'string') { throw new Error('Invalid transaction ID'); }
        if (typeof transaction.version !== 'number') { throw new Error('Invalid version !== number'); }
        if (transaction.version <= 0) { throw new Error('Invalid version value: <= 0'); }

        if (!Array.isArray(transaction.inputs)) { throw new Error('Invalid transaction inputs'); }
        if (!Array.isArray(transaction.outputs)) { throw new Error('Invalid transaction outputs'); }
        if (!Array.isArray(transaction.witnesses)) { throw new Error('Invalid transaction witnesses'); }
        if (isCoinBase && transaction.inputs.length !== 1) { throw new Error(`Invalid coinbase transaction: ${transaction.inputs.length} inputs`); }
        if (isCoinBase && transaction.outputs.length !== 1) { throw new Error(`Invalid coinbase transaction: ${transaction.outputs.length} outputs`); }

        for (let i = 0; i < transaction.inputs.length; i++) {
            if (isCoinBase && typeof transaction.inputs[i] !== 'string') { throw new Error('Invalid coinbase input'); }
            if (isCoinBase) { continue; }
            txValidation.isValidTransactionIO(transaction.inputs[i], 'input');
            /** @type {TransactionIO} */
            const correspondingUtxo = utxosByAnchor[transaction.inputs[i].anchor];
            if (!correspondingUtxo) { 
                throw new Error(`Invalid transaction: UTXO not found in utxoCache: ${transaction.inputs[i].anchor}`); }
            if (correspondingUtxo.amount !== transaction.inputs[i].amount) { 
                throw new Error(`Invalid input/utxo amount: ${correspondingUtxo.amount} !== ${transaction.inputs[i].amount}`); }
        }

        for (let i = 0; i < transaction.outputs.length; i++) {
            const output = transaction.outputs[i];
            txValidation.isValidTransactionIO(output, 'output');

            if (output.rule === "sigOrSlash") {
                if (i !== 0) { throw new Error('sigOrSlash must be the first output'); }
                if (this.calculateRemainingAmount(transaction) < output.amount) { throw new Error('SigOrSlash requires fee > amount'); }
            }
        }
    }
    /**
     * @param {TransactionIO} TxIO - transaction input/output
     * @param {string} type - 'input' | 'output'
     */
    static isValidTransactionIO(TxIO, type) { // type: 'input' | 'output'
        if (typeof TxIO.amount !== 'number') { throw new Error('Invalid amount !== number'); }

        if (TxIO.amount < 0) { throw new Error('Invalid amount value: < 0'); }
        if (type === 'input' && TxIO.amount === 0) { throw new Error('Invalid amount value: = 0'); }
        if (TxIO.amount % 1 !== 0) { throw new Error('Invalid amount value: not integer'); }

        if (typeof TxIO.rule !== 'string') { throw new Error('Invalid rule !== string'); }
        const ruleName = TxIO.rule.split('_')[0]; // rule format : 'ruleName_version'
        if (utils.UTXO_RULES_GLOSSARY[ruleName] === undefined) { throw new Error(`Invalid rule name: ${ruleName}`); }

        if (type === 'input' && !utils.anchor.isValid(TxIO.anchor)) { throw new Error('Invalid anchor'); }

        if (type === 'output' && typeof TxIO.address !== 'string') { throw new Error('Invalid address !== string'); }
        if (type === 'output') { utils.addressUtils.conformityCheck(TxIO.address) }
    }

    /** ==> Second validation, low computation cost.
     * 
     * - control : input > output
     * 
     * - control the fee > 0 or = 0 for miner's txs
     * @param {Transaction} transaction
     * @param {boolean} isCoinBaseOrFeeTx
     * @returns {number} - the fee
     */
    static calculateRemainingAmount(transaction, isCoinBaseOrFeeTx) {
        const inputsAmount = transaction.inputs.reduce((a, b) => a + b.amount, 0);
        const outputsAmount = transaction.outputs.reduce((a, b) => a + b.amount, 0);
        if (isCoinBaseOrFeeTx && !isNaN(inputsAmount)) { throw new Error('Invalid coinbase transaction'); }
        if (isCoinBaseOrFeeTx) { return 0; }

        const fee = inputsAmount - outputsAmount;
        if (fee < 0) { throw new Error('Negative transaction'); }
        if (!isCoinBaseOrFeeTx && fee === 0) {
            throw new Error('Invalid transaction: fee = 0'); }
        if (fee % 1 !== 0) { throw new Error('Invalid fee: not integer'); }

        return fee;
    }

    /** ==> Fourth validation, low computation cost.
     * 
     * - control the right to create outputs using the rule
     * @param {Transaction} transaction
     */
    static async controlTransactionOutputsRulesConditions(transaction) { // NOT SURE IF WE CONSERVE THIS
        for (let i = 0; i < transaction.outputs.length; i++) {
            const inRule = transaction.inputs[i] ? transaction.inputs[i].rule : undefined;
            const inAmount = transaction.inputs[i] ? transaction.inputs[i].amount : undefined;
            const inAddress = transaction.inputs[i] ? transaction.inputs[i].address : undefined;

            const outRule = transaction.outputs[i] ? transaction.outputs[i].rule : undefined;
            const outAmount = transaction.outputs[i] ? transaction.outputs[i].amount : undefined;
            const outAddress = transaction.outputs[i] ? transaction.outputs[i].address : undefined;
        }
    } // NOT SURE IF WE CONSERVE THIS

    /** ==> Fifth validation, medium computation cost.
     * 
     * - control the signature of the inputs
     * @param {Transaction} transaction
     */
    static async controlAllWitnessesSignatures(transaction) {
        const startTime = Date.now();
        if (!Array.isArray(transaction.witnesses)) { throw new Error(`Invalid witnesses: ${transaction.witnesses} !== array`); }
            
        const TxID = await Transaction_Builder.hashTxToGetID(transaction);
        if (TxID !== transaction.id) { throw new Error('Invalid transaction hash'); }
        for (let i = 0; i < transaction.witnesses.length; i++) {
            const { signature, pubKeyHex } = txValidation.#decomposeWitnessOrThrow(transaction.witnesses[i]);
            AsymetricFunctions.verifySignature(signature, TxID, pubKeyHex); // will throw an error if the signature is invalid
        }

        //console.log(`[VALIDATION] .controlAllWitnessesSignatures() took ${Date.now() - startTime} ms`);
    }
    /** @param {string} witness */
    static #decomposeWitnessOrThrow(witness) {
        if (typeof witness !== 'string') { throw new Error(`Invalid witness: ${witness} !== string`); }
        const witnessParts = witness.split(':');
        if (witnessParts.length !== 2) { throw new Error('Invalid witness'); }

        const signature = witnessParts[0];
        const pubKeyHex = witnessParts[1];

        if (!utils.typeValidation.hex(signature)) { throw new Error(`Invalid signature: ${signature} !== hex`); }
        if (!utils.typeValidation.hex(pubKeyHex)) { throw new Error(`Invalid pubKey: ${pubKeyHex} !== hex`); }

        return { signature, pubKeyHex };
    }

    /** ==> Sixth validation, high computation cost.
     * 
     * - control the inputAddresses/witnessesPubKeys correspondence
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     * @param {Object<string, string>} witnessesPubKeysAddress - will be filled
     * @param {boolean} useDevArgon2
     */
    static async addressOwnershipConfirmation(utxosByAnchor, transaction, knownPubKeysAddresses = {}, useDevArgon2 = false) {
        //const startTime = Date.now();
        const transactionWitnessesPubKey = [];
        const transactionWitnessesAddresses = [];

        // derive witnesses addresses
        for (let i = 0; i < transaction.witnesses.length; i++) {
            const witnessParts = transaction.witnesses[i].split(':');
            const pubKeyHex = witnessParts[1];
            
            if (transactionWitnessesPubKey.includes(pubKeyHex)) { throw new Error('Duplicate witness'); }
            transactionWitnessesPubKey.push(pubKeyHex);

            if (knownPubKeysAddresses[pubKeyHex]) { // If the address is already derived, use it and skip the derivation
                transactionWitnessesAddresses.push(knownPubKeysAddresses[pubKeyHex]);
                continue;
            }

            const argon2Fnc = useDevArgon2 ? HashFunctions.devArgon2 : HashFunctions.Argon2;
            const derivedAddressBase58 = await utils.addressUtils.deriveAddress(argon2Fnc, pubKeyHex);
            if (!derivedAddressBase58) { throw new Error('Invalid derived address'); }
            
            transactionWitnessesAddresses.push(derivedAddressBase58);
            knownPubKeysAddresses[pubKeyHex] = derivedAddressBase58; // store the derived address for future use
        }

        // control the input's(UTXOs) addresses presence in the witnesses
        for (let i = 0; i < transaction.inputs.length; i++) {
            const anchor = transaction.inputs[i].anchor;
            if (!utils.anchor.isValid(anchor)) { throw new Error('Invalid anchor'); }

            const referencedUTXO = utxosByAnchor[anchor];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }

            if (!transactionWitnessesAddresses.includes(referencedUTXO.address)) {
                console.log(`UTXO address: ${utils.addressUtils.formatAddress(referencedUTXO.address)}`);
                throw new Error(`Witness missing for address: ${utils.addressUtils.formatAddress(referencedUTXO.address)}`);
            }
        }

        //console.log(`[VALIDATION] .addressOwnershipConfirmation() took ${Date.now() - startTime} ms`);
    }

    /** ==> Sequencially call the full set of validations
     * @param {Object<string, TransactionIO>} utxosByAnchor - from utxoCache
     * @param {Object<string, string>} knownPubKeysAddresses - will be filled
     * @param {Transaction} transaction
     * @param {boolean} isCoinBase
     */
    static async fullTransactionValidation(utxosByAnchor, knownPubKeysAddresses, transaction, isCoinBase, useDevArgon2 = false) {
        txValidation.isConformTransaction(utxosByAnchor, transaction, isCoinBase);
        const fee = txValidation.calculateRemainingAmount(transaction, isCoinBase);
        await txValidation.controlAllWitnessesSignatures(transaction);
        if (isCoinBase) { return { fee, success: true }; }
        
        await txValidation.addressOwnershipConfirmation(utxosByAnchor, transaction, knownPubKeysAddresses, useDevArgon2);

        return { fee, success: true };
    }

    /** - control the transaction hash (SHA256)
     * @param {Transaction} transaction
     */
    static async controlTransactionHash(transaction) {
        const expectedID = await Transaction_Builder.hashTxToGetID(transaction);
        if (expectedID !== transaction.id) { throw new Error('Invalid transaction hash'); }
    }
}

export class blockValidation {
    /**
     * @param {BlockData} blockData
     * @param {BlockData} prevBlockData
     */
    static isTimestampsValid(blockData, prevBlockData) {
        if (blockData.posTimestamp <= prevBlockData.timestamp) { throw new Error(`Invalid PoS timestamp: ${blockData.posTimestamp} <= ${prevBlockData.timestamp}`); }
        if (blockData.timestamp > Date.now()) { throw new Error('Invalid timestamp'); }
    }
    /** @param {BlockData} blockData */
    static areExpectedRewards(blockData) {
        const { powReward, posReward } = BlockUtils.calculateBlockReward(blockData);
        if (blockData.Txs[0].outputs[0].amount !== powReward) { throw new Error(`Invalid PoW reward: ${blockData.Txs[0].outputs[0].amount} - expected: ${powReward}`); }
        if (blockData.Txs[1].outputs[0].amount !== posReward) { throw new Error(`Invalid PoS reward: ${blockData.Txs[0].outputs[0].amount} - expected: ${posReward}`); }
    }

    /**
     * @param {Object<string, TransactionIO>} utxosByAnchor
     * @param {BlockData} blockData
     */
    static isFinalizedBlockDoubleSpending(utxosByAnchor, blockData) {
        const utxoSpent = {};
        for (let i = 0; i < blockData.Txs.length; i++) {
            if (i === 0 || i === 1) { continue; } // coinbase Tx / validator Tx
            
            const Tx = blockData.Txs[i];
            const utxoSpentInTx = {};
            for (let j = 0; j < Tx.inputs.length; j++) {
                const anchor = Tx.inputs[j].anchor;
    
                if (utxoSpentInTx[anchor]) { continue; } // we can see the same anchor multiple times in the same Tx
                utxoSpentInTx[anchor] = true;
    
                if (utxoSpent[anchor]) { throw new Error('Double spending'); }
                if (!utxosByAnchor[anchor]) { throw new Error('UTXO not found in utxoCache, already spent?'); }
                if (utxosByAnchor[anchor].amount !== Tx.inputs[j].amount) { throw new Error('Invalid amount'); }
                utxoSpent[anchor] = true;
            }
        }
    }
}