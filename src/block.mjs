import utils from './utils.mjs';
import { HashFunctions } from './conCrypto.mjs';
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
* @property {number} legitimacy - The legitimacy of the validator who created the block candidate
* @property {string} prevHash - The hash of the previous block
* @property {Transaction[]} Txs - The transactions in the block
* @property {number} posTimestamp - The timestamp of the block creation
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
export const BlockData = (index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce) => {
    return {
        index,
        supply,
        coinBase,
        difficulty,
        legitimacy,
        prevHash,

        // Proof of stake dependent
        posTimestamp, // timestamp of the block's creation
        
        // Proof of work dependent
        timestamp, // timestamp of the block's confirmation
        hash,
        nonce,
        
        Txs
    };
}
export class Block {
    /** 
     * @param {BlockData} blockData
     * @param {boolean} excludeCoinbaseAndPos
     */
    static async getBlockTxsHash(blockData, excludeCoinbaseAndPos = false) {
        const txsIDStrArray = blockData.Txs.map(tx => tx.id).filter(id => id);

        let firstTxIsCoinbase = blockData.Txs[0] ? Transaction_Builder.isCoinBaseOrFeeTransaction(blockData.Txs[0], 0) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }
        firstTxIsCoinbase = blockData.Txs[0] ? Transaction_Builder.isCoinBaseOrFeeTransaction(blockData.Txs[0], 0) : false;
        if (excludeCoinbaseAndPos && firstTxIsCoinbase) { txsIDStrArray.shift(); }

        const txsIDStr = txsIDStrArray.join('');
        return await HashFunctions.SHA256(txsIDStr);
    };
    /**
     * @param {BlockData} blockData
     * @param {boolean} isPosHash - if true, exclude coinbase/pos Txs and blockTimestamp
     * @returns {Promise<string>} signature Hex
     */
    static async getBlockSignature(blockData, isPosHash = false) {
        const txsHash = await Block.getBlockTxsHash(blockData, isPosHash);
        const { index, supply, coinBase, difficulty, legitimacy, prevHash, posTimestamp } = blockData;
        let signatureStr = `${index}${supply}${coinBase}${difficulty}${legitimacy}${prevHash}${posTimestamp}${txsHash}`;
        if (!isPosHash) { signatureStr += blockData.timestamp; }

        return await HashFunctions.SHA256(signatureStr);
    }
    /** @param {BlockData} blockData */
    static async getMinerHash(blockData, devmode = false) {
        if (typeof blockData.Txs[0].inputs[0] !== 'string') { throw new Error('Invalid coinbase nonce'); }
        const signatureHex = await Block.getBlockSignature(blockData);

        const headerNonce = blockData.nonce;
        const coinbaseNonce = blockData.Txs[0].inputs[0];
        const nonce = `${headerNonce}${coinbaseNonce}`;

        const argon2Fnc = devmode ? HashFunctions.devArgon2 : HashFunctions.Argon2;
        const blockHash = await utils.mining.hashBlockSignature(argon2Fnc, signatureHex, nonce);
        if (!blockHash) { throw new Error('Invalid block hash'); }

        return { hex: blockHash.hex, bitsArrayAsString: blockHash.bitsArray.join('') };
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
        const { index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce } = parsed;
        /** @type {BlockData} */
        const blockData = BlockData(index, supply, coinBase, difficulty, legitimacy, prevHash, Txs, posTimestamp, timestamp, hash, nonce);
        
        return blockData;
    }
    /** @param {BlockData} blockData */
    static cloneBlockData(blockData) {
        const JSON = Block.dataAsJSON(blockData);
        return Block.blockDataFromJSON(JSON);
    }
}