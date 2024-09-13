import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import { Transaction, TxOutput, TxInput, UTXO, Transaction_Builder } from './transaction.mjs';
import { BlockUtils } from './block.mjs';
import utils from './utils.mjs';

/**
 * @typedef {import("./block.mjs").BlockData} BlockData
 */

export class TxValidation {
    /** ==> First validation, low computation cost.
     * 
     * - control format of : amount, address, rule, version, TxID, available UTXOs
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
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

            const anchor = transaction.inputs[i];
            if (!utils.types.anchor.isConform(anchor)) { throw new Error('Invalid anchor'); }
            if (!utxosByAnchor[anchor]) { throw new Error(`Invalid transaction: UTXO not found in utxoCache: ${anchor}`); }
        }

        for (let i = 0; i < transaction.outputs.length; i++) {
            const output = transaction.outputs[i];
            TxValidation.isConformOutput(output);

            if (output.rule === "sigOrSlash") {
                if (i !== 0) { throw new Error('sigOrSlash must be the first output'); }
                if (this.calculateRemainingAmount(utxosByAnchor, transaction) < output.amount) { throw new Error('SigOrSlash requires fee > amount'); }
            }
        }
    }
    /** @param {TxOutput} txOutput */
    static isConformOutput(txOutput) {
        if (typeof txOutput.amount !== 'number') { throw new Error('Invalid amount !== number'); }
        if (txOutput.amount <= 0) { throw new Error('Invalid amount value: <= 0'); }
        if (txOutput.amount % 1 !== 0) { throw new Error('Invalid amount value: not integer'); }

        if (typeof txOutput.rule !== 'string') { throw new Error('Invalid rule !== string'); }
        if (utils.UTXO_RULES_GLOSSARY[txOutput.rule] === undefined) { throw new Error(`Invalid rule name: ${txOutput.rule}`); }

        if (typeof txOutput.address !== 'string') { throw new Error('Invalid address !== string'); }
        utils.addressUtils.conformityCheck(txOutput.address);
    }
    /** @param {UTXO} utxo */
    static isConformUTXO(utxo) {
        if (typeof utxo.amount !== 'number') { throw new Error('Invalid amount !== number'); }
        if (utxo.amount <= 0) { throw new Error('Invalid amount value: <= 0'); }
        if (utxo.amount % 1 !== 0) { throw new Error('Invalid amount value: not integer'); }

        if (typeof utxo.rule !== 'string') { throw new Error('Invalid rule !== string'); }
        if (utils.UTXO_RULES_GLOSSARY[utxo.rule] === undefined) { throw new Error(`Invalid rule name: ${utxo.rule}`); }

        if (typeof utxo.address !== 'string') { throw new Error('Invalid address !== string'); }
        utils.addressUtils.conformityCheck(utxo.address);

        if (!utils.types.anchor.isConform(utxo.anchor)) { throw new Error('Invalid anchor'); }
    }

    /** ==> Second validation, low computation cost.
     * 
     * --- ONLY PASS CONFORM TRANSACTION ---
     * 
     * --- NO COINBASE OR FEE TRANSACTION ---
     * - control : input > output
     * - control the fee > 0 or = 0 for miner's txs
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
     * @param {Transaction} transaction
     * @returns {number} - the fee
     */
    static calculateRemainingAmount(utxosByAnchor, transaction) {
        // AT THIS STAGE WE HAVE ENSURED THAT THE TRANSACTION IS CONFORM

        //const utxosAmounts = transaction.inputs.map(anchor => utxosByAnchor[anchor].amount); // throw if not found
        const utxosAmounts = [];
        for (let i = 0; i < transaction.inputs.length; i++) {
            const utxo = utxosByAnchor[transaction.inputs[i]];
            if (!utxo) { 
                throw new Error('UTXO not found in utxoCache, already spent?'); }
            utxosAmounts.push(utxo.amount);
        }
        const inputsAmount = utxosAmounts.reduce((a, b) => a + b, 0);
        const outputsAmount = transaction.outputs.reduce((a, b) => a + b.amount, 0);

        const fee = inputsAmount - outputsAmount;
        if (fee <= 0) { throw new Error('Negative or zero fee transaction'); }
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
            
        const TxID = await Transaction_Builder.hashId(transaction);
        if (TxID !== transaction.id) { throw new Error('Invalid transaction hash'); }
        for (let i = 0; i < transaction.witnesses.length; i++) {
            const { signature, pubKeyHex } = TxValidation.#decomposeWitnessOrThrow(transaction.witnesses[i]);
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
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
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
            const referencedUTXO = utxosByAnchor[transaction.inputs[i]];
            //if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }
            const addressToVerify = referencedUTXO ? referencedUTXO.address : transaction.inputs[i].split(':')[0];
            if (!addressToVerify) { throw new Error('addressToVerify not found'); }

            if (!transactionWitnessesAddresses.includes(addressToVerify)) {
                console.log(`UTXO address: ${utils.addressUtils.formatAddress(addressToVerify)}`);
                throw new Error(`Witness missing for address: ${utils.addressUtils.formatAddress(addressToVerify)}`);
            }
        }

        //console.log(`[VALIDATION] .addressOwnershipConfirmation() took ${Date.now() - startTime} ms`);
    }

    /** ==> Sequencially call the full set of validations
     * @param {Object<string, UTXO>} utxosByAnchor - from utxoCache
     * @param {Object<string, string>} knownPubKeysAddresses - will be filled
     * @param {Transaction} transaction
     * @param {boolean} isCoinBase
     */
    static async fullTransactionValidation(utxosByAnchor, knownPubKeysAddresses, transaction, specialTx, useDevArgon2 = false) {
        const result = { fee: 0, success: false };
        TxValidation.isConformTransaction(utxosByAnchor, transaction, specialTx);
        await TxValidation.controlAllWitnessesSignatures(transaction);
        if (specialTx === 'miner') { return { fee: 0, success: true }; }
        
        if (!specialTx) { result.fee = TxValidation.calculateRemainingAmount(utxosByAnchor, transaction); }
        await TxValidation.addressOwnershipConfirmation(utxosByAnchor, transaction, knownPubKeysAddresses, useDevArgon2);

        result.success = true;
        return result;
    }

    /** - control the transaction hash (SHA256)
     * @param {Transaction} transaction
     */
    static async controlTransactionHash(transaction) {
        const expectedID = await Transaction_Builder.hashId(transaction);
        if (expectedID !== transaction.id) { throw new Error('Invalid transaction hash'); }
    }
}

export class BlockValidation {
    /**
     * @param {BlockData} blockData
     * @param {BlockData} prevBlockData
     */
    static isTimestampsValid(blockData, prevBlockData) {
        if (blockData.posTimestamp <= prevBlockData.timestamp) { throw new Error(`Invalid PoS timestamp: ${blockData.posTimestamp} <= ${prevBlockData.timestamp}`); }
        if (blockData.timestamp > Date.now()) { throw new Error('Invalid timestamp'); }
    }
    /** 
     * @param {Object<string, UTXO>} utxosByAnchor
     * @param {BlockData} blockData
     */
    static areExpectedRewards(utxosByAnchor, blockData) {
        const { powReward, posReward } = BlockUtils.calculateBlockReward(utxosByAnchor, blockData);
        if (blockData.Txs[0].outputs[0].amount !== powReward) { throw new Error(`Invalid PoW reward: ${blockData.Txs[0].outputs[0].amount} - expected: ${powReward}`); }
        if (blockData.Txs[1].outputs[0].amount !== posReward) { throw new Error(`Invalid PoS reward: ${blockData.Txs[0].outputs[0].amount} - expected: ${posReward}`); }
    }

    /**
     * @param {Object<string, UTXO>} utxosByAnchor
     * @param {BlockData} blockData
     */
    static isFinalizedBlockDoubleSpending(utxosByAnchor, blockData) {
        const utxoSpent = {};
        for (let i = 0; i < blockData.Txs.length; i++) {
            if (i === 0 || i === 1) { continue; } // coinbase Tx / validator Tx
            
            const Tx = blockData.Txs[i];
            const utxoSpentInTx = {};
            for (const input of Tx.inputs) {
                const anchor = input;

                if (utxoSpentInTx[anchor]) { continue; } // we can see the same anchor multiple times in the same Tx
                utxoSpentInTx[anchor] = true;
                if (utxoSpent[anchor]) { throw new Error('Double spending'); }

                const utxo = utxosByAnchor[anchor];
                if (!utxo) { throw new Error('UTXO not found in utxoCache, already spent?'); }
                utxoSpent[anchor] = true;
            }
        }
    }
}