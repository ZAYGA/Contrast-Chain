import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import { Transaction, TransactionIO, Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * An object that associates TxID to arrays of TransactionIO.
 * @typedef {{ [TxID: string]: TransactionIO[] }} ReferencedUTXOs
 */

export class Validation {
    /** ==> First validation, low computation cost.
     * 
     * - control format of : amount, address, rule, version, TxID
     * @param {Transaction} transaction
     * @param {boolean} isCoinBase
     */
    static isConformTransaction(transaction, isCoinBase) {
        if (!transaction) { throw new Error('Invalid transaction'); }
        if (typeof transaction.id !== 'string') { throw new Error('Invalid transaction ID'); }
        if (!Array.isArray(transaction.inputs)) { throw new Error('Invalid transaction inputs'); }
        if (!Array.isArray(transaction.outputs)) { throw new Error('Invalid transaction outputs'); }
        if (!Array.isArray(transaction.witnesses)) { throw new Error('Invalid transaction witnesses'); }

        for (let i = 0; i < transaction.inputs.length; i++) {
            if (isCoinBase && typeof transaction.inputs[i] !== 'string') { throw new Error('Invalid coinbase input'); }
            if (isCoinBase) { continue; }
            Validation.isValidTransactionIO(transaction.inputs[i], 'input');
        }

        for (let i = 0; i < transaction.outputs.length; i++) {
            Validation.isValidTransactionIO(transaction.outputs[i], 'output');
        }
    }
    /** Used by isConformTransaction()
     * @param {TransactionIO} TxIO - transaction input/output
     * @param {string} type - 'input' | 'output'
     */
    static isValidTransactionIO(TxIO, type) { // type: 'input' | 'output'
        if (typeof TxIO.amount !== 'number') { throw new Error('Invalid amount !== number'); }

        if (TxIO.amount < 0) { throw new Error('Invalid amount value: < 0'); }
        if (type === 'input' && TxIO.amount === 0) { throw new Error('Invalid amount value: = 0'); }
        if (TxIO.amount % 1 !== 0) { throw new Error('Invalid amount value: not integer'); }

        if (typeof TxIO.rule !== 'string') { 
            throw new Error('Invalid rule !== string'); }
        if (typeof TxIO.version !== 'number') { throw new Error('Invalid version !== number'); }
        if (TxIO.version <= 0) { throw new Error('Invalid version value: <= 0'); }

        if (type === 'input' && !utils.pointer.isValidPointer(TxIO.pointer)) { throw new Error('Invalid pointer'); }

        if (type === 'output' && typeof TxIO.address !== 'string') { throw new Error('Invalid address !== string'); }
        if (type === 'output') { utils.addressUtils.conformityCheck(TxIO.address) }
    }

    /** ==> Second validation, low computation cost.
     * 
     * - control : input > output
     * 
     * - control the fee > 0 or = 0 for coinbase
     * @param {Transaction} transaction
     * @param {boolean} isCoinBaseOrFeeTx
     * @returns {number} - the fee
     */
    static calculateRemainingAmount(transaction, isCoinBaseOrFeeTx) {
        const inputsAmount = transaction.inputs.reduce((a, b) => a + b.amount, 0);
        const outputsAmount = transaction.outputs.reduce((a, b) => a + b.amount, 0);
        const fee = inputsAmount - outputsAmount;
        if (fee < 0) { throw new Error('Negative transaction'); }
        if (isCoinBaseOrFeeTx && fee !== 0) { throw new Error('Invalid coinbase transaction'); }
        if (!isCoinBaseOrFeeTx && fee === 0) {
            throw new Error('Invalid transaction: fee = 0'); }
        if (fee % 1 !== 0) { throw new Error('Invalid fee: not integer'); }

        return fee;
    }

    /** ==> Third validation, low computation cost.
     * 
     * - control the transaction hash (SHA256)
     * @param {Transaction} transaction
     */
    static async controlTransactionHash(transaction) {
        const expectedID = await Transaction_Builder.hashTxToGetID(transaction);
        if (expectedID !== transaction.id) { throw new Error('Invalid transaction hash'); }
    } // WILL BE REDONDANT WITH THE FIFTH VALIDATION

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

        if (!Array.isArray(transaction.witnesses)) { 
            throw new Error('Invalid witnesses'); }

        for (let i = 0; i < transaction.witnesses.length; i++) {
            const witnessParts = transaction.witnesses[0].split(':');
            const signature = witnessParts[0];
            const pubKeyHex = witnessParts[1];
            const message = await Transaction_Builder.hashTxToGetID(transaction);

            // will throw an error if the signature is invalid
            AsymetricFunctions.verifySignature(signature, message, pubKeyHex);
        }

        //console.log(`[VALIDATION] .controlAllWitnessesSignatures() took ${Date.now() - startTime} ms`);
    }

    /** ==> Sixth validation, high computation cost.
     * 
     * - control the inputAddresses/witnessesPubKeys correspondence
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
     * @param {Transaction} transaction
     */
    static async addressOwnershipConfirmation(referencedUTXOsByBlock, transaction) {
        const witnessesAddresses = [];

        // derive witnesses addresses
        for (let i = 0; i < transaction.witnesses.length; i++) {
            const witnessParts = transaction.witnesses[i].split(':');
            const pubKeyHex = witnessParts[1];
            const derivedAddressBase58 = await utils.addressUtils.deriveAddress(HashFunctions.Argon2, pubKeyHex);
            if (witnessesAddresses.includes(derivedAddressBase58)) { throw new Error('Duplicate witness'); }

            witnessesAddresses.push(derivedAddressBase58);
        }

        // control the input's(UTXOs) addresses presence in the witnesses
        for (let i = 0; i < transaction.inputs.length; i++) {
            const pointer = transaction.inputs[i].pointer;
            if (!utils.pointer.isValidPointer(pointer)) { throw new Error('Invalid pointer'); }
            const { utxoBlockHeight, utxoTxID, vout } = utils.pointer.to_height_utxoTxID_vout(pointer);

            const referencedUTXO = referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }
            if (witnessesAddresses.includes(referencedUTXO.address) === false) { 
                throw new Error(`Witness missing for address: ${utils.addressUtils.formatAddress(referencedUTXO.address)}`); }
        }
    }
}