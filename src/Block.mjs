import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
//import { Transaction_Builder, Validation } from './index.mjs';
import { Transaction_Builder } from './transaction.mjs';
import { Validation } from './validation.mjs';

/**
* @typedef {Object} BlockMiningData
* @property {number} index - The block height
* @property {number} difficulty - The difficulty of the block
* @property {number} timestamp - The timestamp of the block
*/
/**
* @param {number} index - The block height
* @param {number} difficulty - The difficulty of the block
* @param {number} timestamp - The timestamp of the block
* @returns {BlockMiningData}
 */
export const BlockMiningData = (index, difficulty, timestamp) => {
    return {
        index,
        difficulty,
        timestamp
    };
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
export const BlockData = (index, supply, coinBase, difficulty, prevHash, Txs, timestamp, hash, nonce) => {
    return {
        index,
        supply,
        coinBase,
        difficulty,
        prevHash,
        
        // Proof of work dependent
        timestamp,
        hash,
        nonce,

        Txs
    };
}
export class Block {
    /** @param {BlockData} blockData */
    static getBlockStringToHash(blockData) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);
        const txsIDStr = txsIDStrArray.join('');

        const signatureStr = `${blockData.prevHash}${blockData.index}${blockData.supply}${blockData.difficulty}${txsIDStr}${blockData.coinBase}`;
        return utils.convert.string.toHex(signatureStr);
    }
    /** @param {BlockData} blockData */
    static async calculateHash(blockData) {
        if (typeof blockData.Txs[0].inputs[0] !== 'string') { throw new Error('Invalid coinbase nonce'); }
        const blockSignatureHex = Block.getBlockStringToHash(blockData);
        const headerNonce = blockData.nonce;
        const coinbaseNonce = blockData.Txs[0].inputs[0];
        
        const nonce = `${headerNonce.Hex}${coinbaseNonce.Hex}`;
        const newBlockHash = await utils.mining.hashBlockSignature(HashFunctions.Argon2, blockSignatureHex, nonce);
        if (!newBlockHash) { throw new Error('Invalid block hash'); }


        return { hex: newBlockHash.hex, bitsArrayAsString: newBlockHash.bitsArray.join('') };
    }
    /** @param {BlockData} blockData */
    static async calculateValidatorHash(blockData) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);
        const txsIDStr = txsIDStrArray.join('');

        const signatureStr = `${blockData.prevHash}${blockData.index}${blockData.supply}${blockData.difficulty}${txsIDStr}${blockData.coinBase}`;
        const signatureHex = utils.convert.string.toHex(signatureStr);

        const validatorHash = await HashFunctions.SHA256(signatureHex);
        return validatorHash;
    }
    /**
     * @param {BlockData} blockData
     * @param {Transaction} coinbaseTx
     */
    static setCoinbaseTransaction(blockData, coinbaseTx) {
        if (Transaction_Builder.isCoinBaseOrFeeTransaction(coinbaseTx, 0) === false) { console.error('Invalid coinbase transaction'); return false; }

        Block.removeExistingCoinbaseTransaction(blockData);
        blockData.Txs.unshift(coinbaseTx);
    }
    /** @param {BlockData} blockData */
    static removeExistingCoinbaseTransaction(blockData) {
        if (blockData.Txs.length === 0) { return; }

        const secondTx = blockData.Txs[1]; // if second tx isn't fee Tx : there is no coinbase
        if (!secondTx || !Transaction_Builder.isCoinBaseOrFeeTransaction(secondTx, 1)) { return; }

        const firstTx = blockData.Txs[0];
        if (firstTx && Transaction_Builder.isCoinBaseOrFeeTransaction(firstTx, 0)) { blockData.Txs.shift(); }
    }
    /** @param {BlockData} blockData - undefined if genesis block */
    static calculateNextCoinbaseReward(blockData) {
        if (!blockData) { throw new Error('Invalid blockData'); }

        const halvings = Math.floor( (blockData.index + 1) / utils.blockchainSettings.halvingInterval );
        const coinBase = Math.max( utils.blockchainSettings.blockReward / Math.pow(2, halvings), utils.blockchainSettings.minBlockReward );

        const maxSupplyWillBeReached = blockData.supply + coinBase >= utils.blockchainSettings.maxSupply;
        return maxSupplyWillBeReached ? utils.blockchainSettings.maxSupply - blockData.supply : coinBase;
    }
    /** @param {Transaction[]} Txs */
    static calculateTxsTotalFees(Txs) {
        // TODO - calculate the fee
        const fees = [];
        for (let i = 0; i < Txs.length; i++) {
            const Tx = Txs[i];
            const fee = Validation.calculateRemainingAmount(Tx, Transaction_Builder.isCoinBaseOrFeeTransaction(Tx, i));

            fees.push(fee);
        }

        const totalFees = fees.reduce((a, b) => a + b, 0);
        return totalFees;
    }
    /** @param {BlockData} blockData */
    static dataAsJSON(blockData) {
        return JSON.stringify(blockData);
    }
    /** @param {string} blockDataJSON */
    static blockDataFromJSON(blockDataJSON) {
        const parsed = JSON.parse(blockDataJSON);
        //const Txs = Block.TransactionsFromJSON(parsed.Txs);
        /** @type {BlockData} */
        return BlockData(parsed.index, parsed.supply, parsed.coinBase, parsed.difficulty, parsed.prevHash, parsed.Txs, parsed.timestamp, parsed.hash, parsed.nonce);
    }
    /** @param {BlockData} blockData */
    static cloneBlockData(blockData) {
        const JSON = Block.dataAsJSON(blockData);
        return Block.blockDataFromJSON(JSON);
    }
}