import { HashFunctions } from './conCrypto.mjs';
import { Transaction_Builder } from './Transaction.mjs';
import utils from './utils.mjs';
import { TxIO_Builder } from './TxIO.mjs';

/**
 * An object that associates TxID to arrays of TransactionIO.
 * @typedef {{ [TxID: string]: TransactionIO[] }} ReferencedUTXOs
 */

export class Validation {
    /** ==> First validation, low computation cost.
     * 
     * - control format of : amount, address, script, version, TxID
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

        if (typeof TxIO.script !== 'string') { throw new Error('Invalid script !== string'); }
        if (typeof TxIO.version !== 'number') { throw new Error('Invalid version !== number'); }
        if (TxIO.version <= 0) { throw new Error('Invalid version value: <= 0'); }

        if (type === 'input' && typeof TxIO.utxoBlockHeight !== 'number') { throw new Error('Invalid utxoBlockHeight !== number'); }
        if (type === 'input' && TxIO.utxoBlockHeight < 0) { throw new Error('Invalid utxoBlockHeight value: < 0'); }
        if (type === 'input' && TxIO.utxoBlockHeight % 1 !== 0) { throw new Error('Invalid utxoBlockHeight value: not integer'); }
        if (type === 'input' && typeof TxIO.utxoTxID !== 'string') { throw new Error('Invalid utxoTxID !== string'); }
        if (type === 'input' && TxIO.utxoTxID.length !== 8) { throw new Error('Invalid utxoTxID length !== 8'); }

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
        // 288 921 831 007
        // 288 920 831 007 + 1 000 000
        const fee = inputsAmount - outputsAmount;
        if (fee < 0) { throw new Error('Negative transaction'); }
        if (isCoinBaseOrFeeTx && fee !== 0) { throw new Error('Invalid coinbase transaction'); }
        if (!isCoinBaseOrFeeTx && fee === 0) {
            throw new Error('Invalid transaction: fee = 0'); }
        if (fee % 1 !== 0) { throw new Error('Invalid fee: not integer'); }

        return fee;
    }

    /** ==> Third validation, medium computation cost.
     * 
     * - control the transaction hash (SHA256)
     * @param {Transaction} transaction
     */
    static async controlTransactionHash(transaction) {
        const expectedID = await Transaction_Builder.hashTxToGetID(transaction);
        if (expectedID !== transaction.id) { throw new Error('Invalid transaction hash'); }
    }

    /** ==> Fourth validation, medium computation cost.
     * 
     * - control the signature of the inputs
     * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
     * @param {Transaction} transaction
     */
    static async executeTransactionInputsScripts(referencedUTXOsByBlock, transaction) {
        // TODO: ADAPT THE LOGIC FOR MULTI WITNESS
        const opAlreadyPassed = [];
        const witnessParts = transaction.witnesses[0].split(':');
        const signature = witnessParts[0];
        const pubKeyHex = witnessParts[1];

        for (let i = 0; i < transaction.inputs.length; i++) {
            const { utxoBlockHeight, utxoTxID, vout, script } = transaction.inputs[i];
            if (utxoBlockHeight === undefined || utxoTxID === undefined || vout === undefined || script === undefined) { throw new Error('Invalid input'); }

            const referencedUTXO = referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }

            const address = referencedUTXO.address;
            const operation = `${address}${script}`;
            if (opAlreadyPassed.includes(operation)) {
                continue; }

            utils.addressUtils.conformityCheck(address);
            await utils.addressUtils.securityCheck(address, pubKeyHex);
            
            const message = Transaction_Builder.getTransactionStringToHash(transaction);
            Validation.executeTransactionInputScripts(script, signature, message, pubKeyHex);

            opAlreadyPassed.push(operation);
        }
    }
    /** // TODO: TRANSFORM SCRIPT LOGIC TO HUMAN READABLE LOGIC -> INPUT LOOKS LIKE : BY:ADDRESS-SIG:SIGNATURE-PUB:pubKeyHex ?
     * @param {string} script
     * @param {string} address
     * @param {string} signature
     * @param {string} pubKeyHex
     */
    static executeTransactionInputScripts(script, signature, message, pubKeyHex) {
        const scriptFunction = TxIO_Builder.getAssociatedScript(script);
        if (!scriptFunction) { throw new Error('Invalid script'); }

        const addressOwnedByPubKey = scriptFunction(signature, message, pubKeyHex);
        if (!addressOwnedByPubKey) { throw new Error('Invalid signature<->pubKey correspancy'); }
    }

    /** ==> Fifth validation, high computation cost.
     * 
     * - control the address/pubKey correspondence
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
            const { utxoBlockHeight, utxoTxID, vout } = transaction.inputs[i];
            if (utxoBlockHeight === undefined || utxoTxID === undefined || vout === undefined) { throw new Error('Invalid input'); }

            const referencedUTXO = referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];
            if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }
            if (witnessesAddresses.includes(referencedUTXO.address) === false) { throw new Error(`Witness missing for address: ${utils.addressUtils.formatAddress(referencedUTXO.address)}`); }
        }
    }
}