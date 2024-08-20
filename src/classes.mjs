'use strict';

import { HashFunctions, AsymetricFunctions } from './conCrypto.mjs';
import storage from "./storage.mjs";
import utils from './utils.mjs';

export class AddressTypeInfo {
    name = '';
    description = '';
    zeroBits = 0;
    nbOfSigners = 1;
}

/**
* @typedef {Object} BlockData
* @property {number} index - The index of the block
* @property {number} supply - The total supply before the coinbase reward
* @property {number} coinBase - The coinbase reward
* @property {number} difficulty - The difficulty of the block
* @property {string} prevHash - The hash of the previous block
* @property {Transaction[]} Txs - The transactions in the block
* @property {number | undefined} timestamp - The timestamp of the block
* @property {string | undefined} hash - The hash of the block
* @property {number | undefined} nonce - The nonce of the block
*/
/**
 * @param {number} index - The index of the block
 * @param {number} supply - The total supply before the coinbase reward
 * @param {number} coinBase - The coinbase reward
 * @param {number} difficulty - The difficulty of the block
 * @param {string} prevHash - The hash of the previous block
 * @param {Transaction[]} Txs - The transactions in the block
 * @param {number | undefined} timestamp - The timestamp of the block
 * @param {string | undefined} hash - The hash of the block
 * @param {number | undefined} nonce - The nonce of the block
 * @returns {BlockData}
 */

/**
 * @typedef {Object} TransactionIO
 * @property {number} amount
 * @property {string} address - output only
 * @property {string} script
 * @property {number} version
 * @property {string | undefined} TxID - input only
 * @property {number | undefined} blockIndex - input only
 */
/** Transaction Input/Output data structure
 * @param {number} amount
 * @param {string} address - output only
 * @param {string} script
 * @param {number} version  
 * @param {string | undefined} TxID - input only
 * @param {number | undefined} blockIndex - input only
 * @returns {TransactionIO}
 **/

/**
 * @typedef {Object} Transaction
 * @property {TransactionIO[]} inputs
 * @property {TransactionIO[]} outputs
 * @property {string} id
 * @property {string[]} witnesses
 */
/** Transaction data structure
 * @param {TransactionIO[]} inputs
 * @param {TransactionIO[]} outputs
 * @param {string} id
 * @param {string[]} witnesses
 * @returns {Transaction}
 */







