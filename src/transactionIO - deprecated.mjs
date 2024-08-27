import { AsymetricFunctions } from './conCrypto.mjs';
import { Validation } from './index.mjs';
import { Transaction, Transaction_Builder } from './transaction.mjs';
import utils from './utils.mjs';

/**
 * An object that associates TxID to arrays of TransactionIO.
 * @typedef {{ [TxID: string]: TransactionIO[] }} ReferencedUTXOs
 */

/** The conditions of a script usage when creating a UTXO - DEPRECATED
 * @typedef {Object} scriptConditions
 * @property {boolean} inputAddressEqualOuputAddress
 * @property {number} maxTransactionInputs
 * @property {boolean} allInputsSameAddress
 * @property {string[]} requiredParams
*/
export const scriptConditions = { // DEPRECATED
    inputAddressEqualOuputAddress: false,
    maxTransactionInputs: 1000,
    allInputsSameAddress: true,
    requiredParams: [],
}

/** @type {Object<string, scriptConditions>} */
export const UTXO_Creation_Conditions = { // useless to ;) DEPRECATED
    sig: {
        inputAddressEqualOuputAddress: false, // useless !
        maxTransactionInputs: 1000, // useless !
        allInputsSameAddress: true, // useless !
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
export class TxIO_Scripts { // DEPRECATED
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