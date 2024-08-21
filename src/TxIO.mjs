import { AsymetricFunctions } from './conCrypto.mjs';
import { Validation } from './index.mjs';

export class TxIO_Scripts {
    static lock = {
        signature: {
            /**
             * @param {string} signature
             * @param {string} message
             * @param {string} pubKeyHex
             */
            v1: (signature, message, pubKeyHex) => {
                return AsymetricFunctions.verifySignature(signature, message, pubKeyHex);
            }
        }
    }

    static arrayIncludeDuplicates(array) { // is it used ? - preferable to delete
        return (new Set(array)).size !== array.length;
    }

    static decomposeScriptString(script) {
    }
}

/**
 * @typedef {Object} TransactionIO
 * @property {number} amount
 * @property {string | undefined} address - output only
 * @property {string} script
 * @property {number} version
 * @property {number | undefined} utxoBlockHeight - input only
 * @property {string | undefined} utxoTxID - input only
 * @property {number | undefined} vout - input only
 */
/** Transaction Input/Output data structure
 * @param {number} amount
 * @param {string | undefined} address - output only
 * @param {string} script
 * @param {number} version  
 * @param {number | undefined} utxoBlockHeight - input only
 * @param {string | undefined} utxoTxID - input only
 * @param {number | undefined} vout - input only
 * @returns {TransactionIO}
 **/
export const TransactionIO = (amount, script, version, address, utxoBlockHeight, utxoTxID, vout) => {
    return {
        amount,
        script,
        version,
        address,
        utxoBlockHeight,
        utxoTxID,
        vout
    };
}

export class TxIO_Builder {
    /**
     * @param {"input" | "output"} type
     * @param {number} amount
     * @param {string} address - output only
     * @param {string} script
     * @param {number} version
     * @param {number | undefined} utxoBlockHeight - input only
     * @param {string | undefined} utxoTxID - input only
     * @param {number | undefined} vout - input only
     */
    static newIO(type, amount, script, version, address, utxoBlockHeight, utxoTxID, vout) {
        const TxIO_Script = TxIO_Builder.getAssociatedScript(script);
        if (!TxIO_Script) { 
            throw new Error('Invalid script'); }

        const newTxIO = TransactionIO(amount, script, version, address, utxoBlockHeight, utxoTxID, vout);
        Validation.isValidTransactionIO(newTxIO, type);
        
        return newTxIO;
    }
    /**
     * @param {string} script
     * @param {string} type - 'lock' or 'unlock'
     */
    static getAssociatedScript(script) {
        const scriptName = script.split('_')[0];
        const scriptVersion = script.split('_')[1];

        if (TxIO_Scripts.lock[scriptName] === undefined) {
            throw new Error('Invalid script name'); }
        if (TxIO_Scripts.lock[scriptName][scriptVersion] === undefined) { throw new Error('Invalid script version'); }

        return TxIO_Scripts.lock[scriptName][scriptVersion];
    }
    /** @param {TransactionIO[]} TxIOs */
    static checkMissingTxID(TxIOs) {
        if (TxIOs.length === 0) { throw new Error('No UTXO to check'); }

        const txIDs = TxIOs.map(TxIO => TxIO.utxoTxID);
        if (txIDs.includes(undefined)) { throw new Error('One UTXO has no utxoTxID'); }
        if (TxIO_Scripts.arrayIncludeDuplicates(txIDs)) { throw new Error('Duplicate utxoTxID in UTXOs'); }
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