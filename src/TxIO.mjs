import { AsymetricFunctions } from './conCrypto.mjs';
import { Validation } from './index.mjs';
import { Transaction, Transaction_Builder } from './Transaction.mjs';
import utils from './utils.mjs';

/**
 * An object that associates TxID to arrays of TransactionIO.
 * @typedef {{ [TxID: string]: TransactionIO[] }} ReferencedUTXOs
 */

/** The conditions of a script usage when creating a UTXO
 * @typedef {Object} scriptConditions
 * @property {boolean} inputAddressEqualOuputAddress
 * @property {number} maxTransactionInputs
 * @property {boolean} allInputsSameAddress
 * @property {string[]} requiredParams
*/

/** @type {Object<string, scriptConditions>} */
export const UTXO_Creation_Conditions = {
    sig: {
        inputAddressEqualOuputAddress: false,
        maxTransactionInputs: 100,
        allInputsSameAddress: true,
        requiredParams: [],
    },

    sigOrSlash: {
        inputAddressEqualOuputAddress: true,
        maxTransactionInputs: 2,
        allInputsSameAddress: true,
        requiredParams: ['fraudProof'],
    },

    multiSigCreate: {
        inputAddressEqualOuputAddress: false,
        maxTransactionInputs: 10,
        allInputsSameAddress: false,
        requiredParams: ['nbOfSigners'],
    }
}
export class TxIO_Scripts {
    static lock = {
        sig: {
            /** Simple signature verification
             * @param {Object} scriptMemory
             * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
             * @param {Transaction} transaction
             * @param {number} scriptInputIndex
             * @param {string[] | undefined} scriptParams
             */
            v1: async (scriptMemory, referencedUTXOsByBlock, transaction, scriptInputIndex, scriptParams) => {
                const input = transaction.inputs[scriptInputIndex];
                const { utxoBlockHeight, utxoTxID, vout, script } = input;
                if (scriptMemory[script] === 'verified') { return scriptMemory; } // already verified all witnesses's signatures
                
                const referencedUTXO = referencedUTXOsByBlock[utxoBlockHeight][utxoTxID][vout];
                if (!referencedUTXO) { throw new Error('referencedUTXO not found'); }
                
                for (let i = 0; i < transaction.witnesses.length; i++) {
                    const witnessParts = transaction.witnesses[0].split(':');
                    const signature = witnessParts[0];
                    const pubKeyHex = witnessParts[1];
                    const message = Transaction_Builder.getTransactionStringToHash(transaction);
                    AsymetricFunctions.verifySignature(signature, message, pubKeyHex);
                }

                scriptMemory[script] = 'verified';
                return scriptMemory;
            }
        },
        sigOrSlash: {
            /** Open right to slash the UTXO if validator's fraud proof is provided
             * @param {Object} scriptMemory
             * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
             * @param {Transaction} transaction
             * @param {number} scriptInputIndex
             * @param {string[] | undefined} scriptParams
             */
            v1: async (scriptMemory, referencedUTXOsByBlock, transaction, scriptInputIndex, scriptParams) => {
                if (scriptMemory['sig'] === 'verified') { return scriptMemory; } // already verified all witnesses's signatures
                this.lock.sig.v1(scriptMemory, referencedUTXOsByBlock, transaction, scriptInputIndex, scriptParams);

                //TODO: check fraud proof
            }
        },
        delegateUTXO: {
            /** Delegate signature verification
             * @param {Object} scriptMemory
             * @param {ReferencedUTXOs[]} referencedUTXOsByBlock
             * @param {Transaction} transaction
             * @param {number} scriptInputIndex
             * @param {string[] | undefined} scriptParams
             */
            v1: async (scriptMemory, referencedUTXOsByBlock, transaction, scriptInputIndex, scriptParams) => {
                return AsymetricFunctions.verifySignature(signature, message, pubKeyHex);
            }
        }
    }

    /** @param {string} script */
    static decomposeScriptString(script) {
        const scriptName = script.split('_')[0];
        const scriptVersion = script.split('_')[1];
        const scriptParams = script.split('_')[2] ? script.split('_')[2].split(':') : undefined;

        return { scriptName, scriptVersion, scriptParams };
    }
    /**
     * @param {string} scriptName
     * @param {string} scriptVersion
     */
    static getAssociatedScript(scriptName, scriptVersion) {
        if (TxIO_Scripts.lock[scriptName] === undefined) {
            throw new Error('Invalid script name'); }
        if (TxIO_Scripts.lock[scriptName][scriptVersion] === undefined) { throw new Error('Invalid script version'); }

        return TxIO_Scripts.lock[scriptName][scriptVersion];
    }
}

/**
 * @typedef {Object} TransactionIO
 * @property {number} amount
 * @property {string | undefined} address - output only || script's condition
 * @property {string} script
 * @property {number} version
 * @property {number | undefined} utxoBlockHeight - input only
 * @property {string | undefined} utxoTxID - input only
 * @property {number | undefined} vout - input only
 */
/** Transaction Input/Output data structure
 * @param {number} amount
 * @param {string | undefined} address - output only || script's condition
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
        const { scriptName, scriptVersion, scriptParams } = TxIO_Scripts.decomposeScriptString(script);
        const TxIO_Script = TxIO_Scripts.getAssociatedScript(scriptName, scriptVersion);
        if (!TxIO_Script) { 
            throw new Error('Invalid script'); }

        const newTxIO = TransactionIO(amount, script, version, address, utxoBlockHeight, utxoTxID, vout);
        Validation.isValidTransactionIO(newTxIO, type);
        
        return newTxIO;
    }
    /** @param {TransactionIO[]} TxIOs */
    static checkMissingTxID(TxIOs) {
        if (TxIOs.length === 0) { throw new Error('No UTXO to check'); }

        const txIDs = TxIOs.map(TxIO => TxIO.utxoTxID);
        if (txIDs.includes(undefined)) { throw new Error('One UTXO has no utxoTxID'); }
        if (utils.conditionnals.arrayIncludeDuplicates(txIDs)) { throw new Error('Duplicate utxoTxID in UTXOs'); }
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