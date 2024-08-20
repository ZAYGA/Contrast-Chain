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
 * @property {string} address
 * @property {string} script
 * @property {number} version
 * @property {number | undefined} index
 * @property {string | undefined} TxID
 */
/** Transaction Input/Output data structure
 * @param {number} amount
 * @param {string} address
 * @param {string} script
 * @param {number} version  
 * @param {string | undefined} TxID
 * @returns {TransactionIO}
 **/
const TransactionIO = (amount, script, version, address = undefined, TxID = undefined, blockIndex = undefined) => {
    return {
        amount,
        script,
        version,
        address,
        TxID,
        blockIndex
    };
}
export class TxIO_Builder {
    /**
     * @param {"input" | "output"} type
     * @param {number} amount
     * @param {string} address - output only
     * @param {string} script
     * @param {number} version
     * @param {string | undefined} TxID - input only
     * @param {number | undefined} blockIndex - input only
     */
    static newIO(type, amount, script, version, address, TxID, blockIndex) {
        const TxIO_Script = TxIO_Builder.getAssociatedScript(script);
        if (!TxIO_Script) { 
            throw new Error('Invalid script'); }

        const newTxIO = TransactionIO(amount, script, version, address, TxID, blockIndex);
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

        const txIDs = TxIOs.map(TxIO => TxIO.TxID);
        if (txIDs.includes(undefined)) { throw new Error('One UTXO has no TxID'); }
        if (TxIO_Scripts.arrayIncludeDuplicates(txIDs)) { throw new Error('Duplicate TxID in UTXOs'); }
    }
    /** @param {TransactionIO[]} TxIOs */
    static cloneTxIO(TxIO) {
        const TxIOJSON = JSON.stringify(TxIO);
        return JSON.parse(TxIOJSON);
    }
}